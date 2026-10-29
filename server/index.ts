import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const {
  countRecords,
  createPaymentRequest,
  createSession,
  deleteRecord,
  deleteSession,
  getPaymentRequest,
  importRecords,
  isSessionValid,
  listRecords,
  recordBankTransaction,
  saveRecord,
} = await import('./db');
import type { BankConfig } from '../src/types';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const APP_USERNAME = process.env.APP_USERNAME || 'duchanh';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SEPAY_API_KEY = process.env.SEPAY_API_KEY || '';

const bankConfig: BankConfig = {
  bankCode: process.env.BANK_CODE || '970441',
  bankName: process.env.BANK_NAME || 'VIB',
  accountNo: process.env.BANK_ACCOUNT_NO || '888974974',
  accountName: process.env.BANK_ACCOUNT_NAME || 'TRAN THI HA MY',
  sepayEnabled: !!SEPAY_API_KEY,
};

if (!APP_PASSWORD) {
  console.error('Thiếu APP_PASSWORD trong file .env — xem .env.example');
  process.exit(1);
}

if (IS_PROD && APP_PASSWORD.length < 8) {
  console.error('APP_PASSWORD phải có ít nhất 8 ký tự khi chạy thật (máy chủ mở ra Internet cho SePay).');
  process.exit(1);
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
// server pushes an event and the tabs reload the data they show.
const sseClients = new Set<Response>();

function broadcast(event: string, data: unknown = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
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

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token && isSessionValid(token)) return next();
  res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
}

// Simple brute-force guard: 10 failed logins per IP per 15 minutes
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

app.post('/api/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const attempts = failedLogins.get(ip);
  if (attempts && attempts.resetAt > now && attempts.count >= 10) {
    return res.status(429).json({ error: 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút' });
  }

  const { username, password } = req.body ?? {};
  const ok =
    safeEqual(String(username ?? '').trim(), APP_USERNAME) &&
    safeEqual(String(password ?? '').trim(), APP_PASSWORD);
  if (!ok) {
    const fresh = !attempts || attempts.resetAt <= now;
    failedLogins.set(ip, { count: fresh ? 1 : attempts.count + 1, resetAt: fresh ? now + LOGIN_WINDOW_MS : attempts.resetAt });
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  }
  failedLogins.delete(ip);

  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_HOURS * 3600 * 1000;
  createSession(token, Date.now() + maxAge);
  // secure only over HTTPS, so logging in over plain http://<LAN-IP>:3000 still works
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) deleteSession(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || !isSessionValid(token)) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, config: bankConfig });
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
  if (paid) broadcast('payment', paid);
  res.json({ success: true });
});

// ==========================================
// RECORDS API (everything below requires login)
// ==========================================
app.use('/api', requireAuth);

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/records', (_req, res) => {
  res.json(listRecords());
});

app.post('/api/records', (req, res) => {
  try {
    const record = saveRecord(req.body);
    broadcast('records');
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put('/api/records/:id', (req, res) => {
  try {
    const record = saveRecord(req.body, Number(req.params.id));
    broadcast('records');
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/records/:id', (req, res) => {
  if (!deleteRecord(Number(req.params.id))) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
  broadcast('records');
  res.json({ ok: true });
});

app.post('/api/records/import', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'File backup phải là một mảng hồ sơ' });
  const imported = importRecords(req.body);
  broadcast('records');
  res.json({ imported, total: countRecords() });
});

app.post('/api/payment-requests', (req, res) => {
  const amount = Math.round(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < 1000) {
    return res.status(400).json({ error: 'Số tiền phải từ 1.000 VND trở lên' });
  }
  const patientId = Number(req.body?.patientId) || null;
  const code = 'DH' + crypto.randomBytes(5).toString('hex').toUpperCase();
  res.status(201).json(createPaymentRequest(code, amount, patientId));
});

app.get('/api/payment-requests/:id', (req, res) => {
  const request = getPaymentRequest(Number(req.params.id));
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
  console.log(`Nha Khoa Đức Hạnh đang chạy tại http://localhost:${PORT} (${countRecords()} hồ sơ)`);
});
