import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const {
  ConflictError,
  NotFoundError,
  authenticate,
  countRecords,
  countUsers,
  createPaymentRequest,
  createServices,
  deleteService,
  listServices,
  updateService,
  createSession,
  deleteRecord,
  deleteSession,
  getClinic,
  getPaymentRequest,
  getSession,
  importRecords,
  listRecords,
  recordBankTransaction,
  recordPaymentToLog,
  saveRecord,
  setUser,
  snapshotDatabase,
} = await import('./db');
import type { Session } from './db';
import type { BankConfig, SessionInfo } from '../src/types';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const SEPAY_API_KEY = process.env.SEPAY_API_KEY || '';

// Bank account shown on QR codes (only clinics with QR enabled use it)
const bankConfig: BankConfig = {
  bankCode: process.env.BANK_CODE || '970403',
  bankName: process.env.BANK_NAME || 'Sacombank',
  accountNo: process.env.BANK_ACCOUNT_NO || '',
  accountName: process.env.BANK_ACCOUNT_NAME || '',
  sepayEnabled: !!SEPAY_API_KEY,
};

// First start: create the Bình Thuận login from .env so the existing setup keeps working.
// Further accounts are managed with: node dist-server/user.js (see README)
if (countUsers() === 0) {
  const username = process.env.APP_USERNAME || 'duchanh';
  const password = process.env.APP_PASSWORD || '';
  if (password.length < (IS_PROD ? 8 : 1)) {
    console.error('Chưa có tài khoản nào: đặt APP_USERNAME / APP_PASSWORD (≥ 8 ký tự) trong .env để tạo tài khoản đầu tiên.');
    process.exit(1);
  }
  setUser(username, password, 'binh-thuan');
  console.log(`Đã tạo tài khoản "${username}" cho Nha Khoa Bình Thuận`);
}

const app = express();
// Behind Cloudflare Tunnel (same machine or a sibling Docker container): trust its
// X-Forwarded-* headers so req.ip is the real visitor and req.secure reflects HTTPS
app.set('trust proxy', 'loopback, uniquelocal');
app.use(express.json({ limit: '20mb' }));

// ==========================================
// REALTIME SYNC (Server-Sent Events)
// ==========================================
// Every open browser tab keeps one connection here; after any change the
// server pushes an event to the tabs of that clinic, which reload their data.
const sseClients = new Map<Response, { clinicId: number; token: string }>();

function broadcast(clinicId: number, event: string, data: unknown = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [res, client] of sseClients) {
    if (client.clinicId === clinicId) res.write(msg);
  }
}

function closeStreams(predicate: (token: string) => boolean) {
  for (const [res, client] of sseClients) {
    if (predicate(client.token)) {
      sseClients.delete(res);
      res.end();
    }
  }
}

setInterval(() => {
  // Drop streams whose session expired or was logged out elsewhere
  closeStreams((token) => !getSession(token));
  for (const res of sseClients.keys()) res.write(': ping\n\n');
  // Forget brute-force counters whose window has passed
  const now = Date.now();
  for (const [ip, a] of failedLogins) if (a.resetAt <= now) failedLogins.delete(ip);
}, 25_000);

// ==========================================
// AUTH
// ==========================================
const SESSION_COOKIE = 'dh_session';

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function currentSession(req: Request): Session | undefined {
  const token = readCookie(req, SESSION_COOKIE);
  return token ? getSession(token) : undefined;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = currentSession(req);
  if (!session) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
  res.locals.session = session;
  next();
}

function clinicOf(res: Response): number {
  return (res.locals.session as Session).clinicId;
}

// Simple brute-force guard: 10 failed logins per IP per 15 minutes
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

// Counted both per IP and per username, so rotating IP addresses doesn't help an attacker
function isLocked(key: string, now: number): boolean {
  const a = failedLogins.get(key);
  return !!a && a.resetAt > now && a.count >= 10;
}

function countFailure(key: string, now: number) {
  const a = failedLogins.get(key);
  const fresh = !a || a.resetAt <= now;
  failedLogins.set(key, { count: fresh ? 1 : a.count + 1, resetAt: fresh ? now + LOGIN_WINDOW_MS : a.resetAt });
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const ipKey = `ip:${req.ip ?? 'unknown'}`;
  const userKey = `user:${String(username ?? '').trim().toLowerCase()}`;
  const now = Date.now();
  if (isLocked(ipKey, now) || isLocked(userKey, now)) {
    return res.status(429).json({ error: 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút' });
  }

  const userId = await authenticate(String(username ?? ''), String(password ?? ''));
  if (!userId) {
    countFailure(ipKey, now);
    countFailure(userKey, now);
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  }
  failedLogins.delete(ipKey);
  failedLogins.delete(userKey);

  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_HOURS * 3600 * 1000;
  createSession(token, userId, Date.now() + maxAge);
  // secure only over HTTPS, so logging in over plain http://<LAN-IP>:3000 still works
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    deleteSession(token);
    closeStreams((t) => t === token);
  }
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const session = currentSession(req);
  const clinic = session && getClinic(session.clinicId);
  if (!session || !clinic) return res.json({ loggedIn: false });
  const info: SessionInfo = {
    username: session.username,
    clinic,
    bank: clinic.qrEnabled ? bankConfig : null,
  };
  res.json({ loggedIn: true, ...info });
});

// ==========================================
// SEPAY WEBHOOK (called by SePay, not by the browser)
// ==========================================
app.post('/api/sepay/webhook', (req, res) => {
  if (!SEPAY_API_KEY) return res.status(503).json({ success: false, error: 'SePay chưa được cấu hình' });
  if (!safeEqual(req.headers.authorization ?? '', `Apikey ${SEPAY_API_KEY}`)) {
    return res.status(401).json({ success: false });
  }

  const body = req.body;
  if (typeof body?.id !== 'number' || typeof body?.transferAmount !== 'number') {
    return res.status(400).json({ success: false, error: 'Payload không hợp lệ' });
  }

  const paid = recordBankTransaction(body);
  if (paid) broadcast(paid.clinicId, 'payment', paid);
  res.json({ success: true });
});

// ==========================================
// RECORDS API (everything below requires login, scoped to the user's clinic)
// ==========================================
app.use('/api', requireAuth);

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  sseClients.set(res, { clinicId: clinicOf(res), token: readCookie(req, SESSION_COOKIE)! });
  res.on('close', () => sseClients.delete(res));
});

app.get('/api/records', (_req, res) => {
  res.json(listRecords(clinicOf(res)));
});

function sendSaveError(res: Response, err: unknown) {
  const status = err instanceof NotFoundError ? 404 : err instanceof ConflictError ? 409 : 400;
  res.status(status).json({ error: (err as Error).message });
}

app.post('/api/records', (req, res) => {
  try {
    const record = saveRecord(clinicOf(res), req.body);
    broadcast(clinicOf(res), 'records');
    res.status(201).json(record);
  } catch (err) {
    sendSaveError(res, err);
  }
});

app.put('/api/records/:id', (req, res) => {
  try {
    const record = saveRecord(clinicOf(res), req.body, Number(req.params.id));
    broadcast(clinicOf(res), 'records');
    res.json(record);
  } catch (err) {
    sendSaveError(res, err);
  }
});

app.delete('/api/records/:id', (req, res) => {
  if (!deleteRecord(clinicOf(res), Number(req.params.id))) {
    return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
  }
  broadcast(clinicOf(res), 'records');
  res.json({ ok: true });
});

app.post('/api/records/import', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'File backup phải là một mảng hồ sơ' });
  try {
    // Import overwrites matching records; keep a copy of the DB to roll back to
    const snapshot = await snapshotDatabase('truoc-khi-nhap-file');
    const result = importRecords(clinicOf(res), req.body);
    broadcast(clinicOf(res), 'records');
    res.json({ ...result, total: countRecords(clinicOf(res)), snapshot: path.basename(snapshot) });
  } catch (err) {
    sendSaveError(res, err);
  }
});

// ---- Price list (Cài đặt > Bảng giá dịch vụ)
app.get('/api/services', (_req, res) => {
  res.json(listServices(clinicOf(res)));
});

app.post('/api/services', (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    if (items.length === 0 || items.length > 500) return res.status(400).json({ error: 'Danh sách dịch vụ không hợp lệ' });
    createServices(clinicOf(res), items);
    broadcast(clinicOf(res), 'services');
    res.status(201).json(listServices(clinicOf(res)));
  } catch (err) {
    sendSaveError(res, err);
  }
});

app.put('/api/services/:id', (req, res) => {
  try {
    const service = updateService(clinicOf(res), Number(req.params.id), req.body ?? {});
    broadcast(clinicOf(res), 'services');
    res.json(service);
  } catch (err) {
    sendSaveError(res, err);
  }
});

app.delete('/api/services/:id', (req, res) => {
  if (!deleteService(clinicOf(res), Number(req.params.id))) {
    return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
  }
  broadcast(clinicOf(res), 'services');
  res.json({ ok: true });
});

app.post('/api/payment-requests', (req, res) => {
  if (!getClinic(clinicOf(res))?.qrEnabled) {
    return res.status(403).json({ error: 'Nha khoa này không dùng chức năng thanh toán QR' });
  }
  const amount = Math.round(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < 1000) {
    return res.status(400).json({ error: 'Số tiền phải từ 1.000 VND trở lên' });
  }
  const patientId = Number(req.body?.patientId) || null;
  const code = 'DH' + crypto.randomBytes(5).toString('hex').toUpperCase();
  res.status(201).json(createPaymentRequest(clinicOf(res), code, amount, patientId));
});

app.post('/api/payment-requests/:id/record', (req, res) => {
  try {
    const record = recordPaymentToLog(clinicOf(res), Number(req.params.id));
    broadcast(clinicOf(res), 'records');
    res.json(record);
  } catch (err) {
    sendSaveError(res, err);
  }
});

app.get('/api/payment-requests/:id', (req, res) => {
  const request = getPaymentRequest(Number(req.params.id), clinicOf(res));
  if (!request) return res.status(404).json({ error: 'Không tìm thấy yêu cầu thanh toán' });
  res.json(request);
});

// ==========================================
// FRONTEND (Vite in dev, built files in production)
// ==========================================
if (IS_PROD) {
  const dist = path.resolve(process.cwd(), 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hệ thống quản lý nha khoa đang chạy tại http://localhost:${PORT} (${countRecords()} hồ sơ)`);
});
