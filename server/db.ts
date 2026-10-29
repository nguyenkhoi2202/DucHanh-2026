import { DatabaseSync, backup } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ClinicInfo, DentalRecord, PlanItem, PaymentRequest, ServiceItem } from '../src/types';

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'duchanh.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- Each clinic only ever sees its own patients and payments
  CREATE TABLE IF NOT EXISTS clinics (
    id         INTEGER PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    hotlines   TEXT NOT NULL DEFAULT '[]',  -- JSON: [{"label": "...", "phone": "..."}]
    qr_enabled INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    clinic_id     INTEGER NOT NULL REFERENCES clinics(id)
  );

  CREATE TABLE IF NOT EXISTS patients (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL DEFAULT '',
    address     TEXT NOT NULL DEFAULT '',
    age         TEXT NOT NULL DEFAULT '',
    visit_date  TEXT NOT NULL DEFAULT '',
    appointment TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
  CREATE INDEX IF NOT EXISTS idx_patients_appointment ON patients(appointment);

  CREATE TABLE IF NOT EXISTS treatments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    date       TEXT NOT NULL DEFAULT '',
    tooth      TEXT NOT NULL DEFAULT '',
    treatment  TEXT NOT NULL DEFAULT '',
    cost       INTEGER NOT NULL DEFAULT 0,
    paid       INTEGER NOT NULL DEFAULT 0,
    remaining  INTEGER NOT NULL DEFAULT 0,
    doctor     TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_treatments_patient ON treatments(patient_id);
  CREATE INDEX IF NOT EXISTS idx_treatments_date ON treatments(date);

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- One row per QR code shown to a patient; the code is put in the transfer note
  -- so the SePay webhook can match the incoming transfer back to it.
  CREATE TABLE IF NOT EXISTS payment_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL UNIQUE,
    patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
    amount     INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    paid_at    INTEGER
  );

  -- Raw incoming transfers from SePay; sepay_id is UNIQUE because SePay may retry.
  CREATE TABLE IF NOT EXISTS bank_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    sepay_id         INTEGER NOT NULL UNIQUE,
    request_id       INTEGER REFERENCES payment_requests(id),
    amount           INTEGER NOT NULL,
    content          TEXT NOT NULL DEFAULT '',
    reference_code   TEXT,
    transaction_date TEXT,
    received_at      INTEGER NOT NULL,
    raw              TEXT NOT NULL
  );
`);

// ==========================================
// MIGRATIONS for databases created by earlier versions
// ==========================================
function hasColumn(table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}

if (!hasColumn('treatments', 'remaining')) {
  db.exec('ALTER TABLE treatments ADD COLUMN remaining INTEGER NOT NULL DEFAULT 0');
}

// Single-clinic version: sessions had no user; recreate (everyone logs in again once)
if (!hasColumn('sessions', 'user_id')) {
  db.exec(`
    DROP TABLE sessions;
    CREATE TABLE sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);
}

const BINH_THUAN_ID = 1;
const CU_BAO_ID = 2;
db.prepare(`INSERT OR IGNORE INTO clinics (id, slug, name, hotlines, qr_enabled) VALUES (?, ?, ?, ?, ?)`).run(
  BINH_THUAN_ID, 'binh-thuan', 'Nha Khoa Bình Thuận',
  JSON.stringify([
    { label: 'Đức Hạnh', phone: '0947 137 139' },
    { label: 'Hà My', phone: '0888 974 974' },
  ]),
  1,
);
db.prepare(`INSERT OR IGNORE INTO clinics (id, slug, name, hotlines, qr_enabled) VALUES (?, ?, ?, ?, ?)`).run(
  CU_BAO_ID, 'cu-bao', 'Nha Khoa Cư Bao', '[]', 0,
);

// Everything that existed before multi-clinic support belongs to Bình Thuận.
// SQLite only allows adding a REFERENCES column with a non-NULL default while
// foreign key enforcement is off, so switch it off just for these statements.
for (const table of ['patients', 'payment_requests']) {
  if (!hasColumn(table, 'clinic_id')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ALTER TABLE ${table} ADD COLUMN clinic_id INTEGER NOT NULL DEFAULT ${BINH_THUAN_ID} REFERENCES clinics(id)`);
    db.exec('PRAGMA foreign_keys = ON');
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id)');

// Price list (per clinic). Treatment rows keep free text, so editing or deleting
// a service never changes past records.
db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id  INTEGER NOT NULL REFERENCES clinics(id),
    name       TEXT NOT NULL COLLATE NOCASE,
    price      INTEGER NOT NULL DEFAULT 0,  -- thousands of VND, like treatment rows
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    UNIQUE (clinic_id, name)
  );
`);

// When a confirmed QR payment was written into the patient's treatment log
if (!hasColumn('payment_requests', 'recorded_at')) {
  db.exec('ALTER TABLE payment_requests ADD COLUMN recorded_at INTEGER');
}

// Amounts are stored the way the clinic types them: in thousands of VND ("220" = 220.000đ).
function toInt(v: unknown): number {
  const n = Math.round(parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

// ==========================================
// PATIENT RECORDS
// ==========================================
type PatientRow = {
  id: number; name: string; phone: string; address: string; age: string;
  visit_date: string; appointment: string;
};
type TreatmentRow = {
  patient_id: number; date: string; tooth: string; treatment: string;
  cost: number; paid: number; remaining: number; doctor: string;
};

function rowToPlan(t: TreatmentRow): PlanItem {
  return {
    date: t.date,
    tooth: t.tooth,
    treatment: t.treatment,
    cost: t.cost,
    paid: t.paid,
    remaining: t.remaining,
    doctor: t.doctor,
  };
}

function loadRecords(where: string, ...params: number[]): DentalRecord[] {
  const patients = db.prepare(`SELECT * FROM patients WHERE ${where} ORDER BY id`).all(...params) as PatientRow[];
  const treatments = db
    .prepare(`
      SELECT t.* FROM treatments t JOIN patients p ON p.id = t.patient_id
      WHERE ${where.replace(/\b(clinic_id|id)\b/g, 'p.$1')}
      ORDER BY t.patient_id, t.position
    `)
    .all(...params) as TreatmentRow[];

  const plansByPatient = new Map<number, PlanItem[]>();
  for (const t of treatments) {
    const list = plansByPatient.get(t.patient_id) ?? [];
    list.push(rowToPlan(t));
    plansByPatient.set(t.patient_id, list);
  }

  return patients.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    address: p.address,
    dob: p.age,
    visitDate: p.visit_date,
    appointment: p.appointment,
    plan: plansByPatient.get(p.id) ?? [],
  }));
}

export function listRecords(clinicId: number): DentalRecord[] {
  return loadRecords('clinic_id = ?', clinicId);
}

export function getRecord(clinicId: number, id: number): DentalRecord | undefined {
  return loadRecords('clinic_id = ? AND id = ?', clinicId, id)[0];
}

function patientClinic(id: number): number | undefined {
  const row = db.prepare('SELECT clinic_id FROM patients WHERE id = ?').get(id) as { clinic_id: number } | undefined;
  return row?.clinic_id;
}

const insertPatient = db.prepare(`
  INSERT INTO patients (id, clinic_id, name, phone, address, age, visit_date, appointment, created_at, updated_at)
  VALUES (:id, :clinic_id, :name, :phone, :address, :age, :visit_date, :appointment, :now, :now)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, phone = excluded.phone, address = excluded.address,
    age = excluded.age, visit_date = excluded.visit_date,
    appointment = excluded.appointment, updated_at = excluded.updated_at
  WHERE patients.clinic_id = excluded.clinic_id
`);
const deleteTreatments = db.prepare('DELETE FROM treatments WHERE patient_id = ?');
const insertTreatment = db.prepare(`
  INSERT INTO treatments (patient_id, position, date, tooth, treatment, cost, paid, remaining, doctor)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function writeRecord(clinicId: number, input: Partial<DentalRecord>, id: number) {
  const written = insertPatient.run({
    id,
    clinic_id: clinicId,
    name: str(input.name),
    phone: str(input.phone),
    address: str(input.address),
    age: str(input.dob),
    visit_date: str(input.visitDate),
    appointment: str(input.appointment),
    now: Date.now(),
  });
  // The upsert skips rows owned by another clinic; never rewrite their treatments
  if (Number(written.changes) === 0) throw new Error(`Mã hồ sơ ${id} đang thuộc nha khoa khác`);
  deleteTreatments.run(id);
  (input.plan ?? []).forEach((p, idx) => {
    const cost = toInt(p.cost);
    const paid = toInt(p.paid);
    // Old data has a few hand-adjusted rows where remaining != cost - paid; keep them as entered.
    const remaining = str(p.remaining) === '' ? cost - paid : toInt(p.remaining);
    insertTreatment.run(
      id, idx, str(p.date), str(p.tooth), str(p.treatment),
      cost, paid, remaining, str(p.doctor),
    );
  });
}

function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export class NotFoundError extends Error {}

export function saveRecord(clinicId: number, input: Partial<DentalRecord>, id?: number): DentalRecord {
  if (!str(input.name)) throw new Error('Thiếu họ tên bệnh nhân');
  if (id !== undefined && patientClinic(id) !== clinicId) throw new NotFoundError('Không tìm thấy hồ sơ');
  const recordId = id ?? nextPatientId();
  transaction(() => writeRecord(clinicId, input, recordId));
  return getRecord(clinicId, recordId)!;
}

export function deleteRecord(clinicId: number, id: number): boolean {
  return db.prepare('DELETE FROM patients WHERE id = ? AND clinic_id = ?').run(id, clinicId).changes > 0;
}

// Imports legacy JSON backups (same shape as the old localStorage data).
// Records are upserted by id, so importing the same file twice is harmless.
// An id already used by the other clinic gets a fresh id instead of overwriting it.
export function importRecords(clinicId: number, records: Partial<DentalRecord>[]): number {
  return transaction(() => {
    let count = 0;
    for (const rec of records) {
      if (!str(rec.name)) continue;
      // Legacy ids are millisecond timestamps; anything else (huge, fractional, text) gets a new id
      const legacyId = Number(rec.id);
      let id = Number.isSafeInteger(legacyId) && legacyId > 0 && legacyId < MAX_PATIENT_ID ? legacyId : nextPatientId();
      const owner = patientClinic(id);
      if (owner !== undefined && owner !== clinicId) id = nextPatientId();
      writeRecord(clinicId, rec, id);
      count++;
    }
    return count;
  });
}

const MAX_PATIENT_ID = 1e14; // far beyond any timestamp id, well inside safe integers

function nextPatientId(): number {
  // Keep the old millisecond-timestamp style ids so imported and new records never collide.
  const row = db.prepare('SELECT MAX(id) AS maxId FROM patients').get() as { maxId: number | null };
  return Math.max(Date.now(), (row.maxId ?? 0) + 1);
}

export function countRecords(clinicId?: number): number {
  const row = clinicId === undefined
    ? db.prepare('SELECT COUNT(*) AS c FROM patients').get()
    : db.prepare('SELECT COUNT(*) AS c FROM patients WHERE clinic_id = ?').get(clinicId);
  return (row as { c: number }).c;
}

// ==========================================
// CLINICS & USERS
// ==========================================
type ClinicRow = { id: number; slug: string; name: string; hotlines: string; qr_enabled: number };

function rowToClinic(r: ClinicRow): ClinicInfo {
  return { id: r.id, slug: r.slug, name: r.name, hotlines: JSON.parse(r.hotlines), qrEnabled: !!r.qr_enabled };
}

export function getClinic(id: number): ClinicInfo | undefined {
  const row = db.prepare('SELECT * FROM clinics WHERE id = ?').get(id) as ClinicRow | undefined;
  return row && rowToClinic(row);
}

export function listClinics(): ClinicInfo[] {
  return (db.prepare('SELECT * FROM clinics ORDER BY id').all() as ClinicRow[]).map(rowToClinic);
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const DUMMY_HASH = hashPassword('not-a-real-password');

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
}

/** Creates the user, or changes its password and clinic if it already exists. */
export function setUser(username: string, password: string, clinicSlug: string) {
  const clinic = db.prepare('SELECT id FROM clinics WHERE slug = ?').get(clinicSlug) as { id: number } | undefined;
  if (!clinic) throw new Error(`Không có nha khoa "${clinicSlug}"`);
  db.prepare(`
    INSERT INTO users (username, password_hash, clinic_id) VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, clinic_id = excluded.clinic_id
  `).run(username.trim(), hashPassword(password), clinic.id);  // password kept exactly as typed
  // Changing a password logs that account out everywhere
  db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username.trim());
}

export function listUsers(): { username: string; clinic: string }[] {
  return db
    .prepare('SELECT u.username, c.name AS clinic FROM users u JOIN clinics c ON c.id = u.clinic_id ORDER BY c.id, u.username')
    .all() as { username: string; clinic: string }[];
}

/** Returns the user id when the credentials are right. */
export function authenticate(username: string, password: string): number | undefined {
  const row = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username.trim()) as
    | { id: number; password_hash: string }
    | undefined;
  // Verify against a dummy hash for unknown users so timing does not reveal which usernames exist
  const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  return row && ok ? row.id : undefined;
}

// ==========================================
// SESSIONS
// ==========================================
export function createSession(token: string, userId: number, expiresAt: number) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
}

export interface Session {
  username: string;
  clinicId: number;
}

export function getSession(token: string): Session | undefined {
  const row = db
    .prepare(`
      SELECT u.username, u.clinic_id FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?
    `)
    .get(token, Date.now()) as { username: string; clinic_id: number } | undefined;
  return row && { username: row.username, clinicId: row.clinic_id };
}

export function deleteSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ==========================================
// PAYMENTS (SePay)
// ==========================================
type PaymentRequestRow = {
  id: number; code: string; clinic_id: number; patient_id: number | null; amount: number;
  status: 'pending' | 'paid'; created_at: number; paid_at: number | null; recorded_at: number | null;
  patient_name?: string | null; paid_amount?: number | null; bank_reference?: string | null;
};

function rowToRequest(r: PaymentRequestRow): PaymentRequest {
  return {
    id: r.id,
    code: r.code,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    patientName: r.patient_name ?? null,
    amount: r.amount,
    status: r.status,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    recordedAt: r.recorded_at,
    paidAmount: r.paid_amount ?? null,
    bankReference: r.bank_reference ?? null,
  };
}

export function createPaymentRequest(
  clinicId: number, code: string, amount: number, patientId: number | null,
): PaymentRequest {
  // Only link patients of the same clinic
  const linkedPatient = patientId !== null && patientClinic(patientId) === clinicId ? patientId : null;
  const info = db
    .prepare('INSERT INTO payment_requests (code, clinic_id, patient_id, amount, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(code, clinicId, linkedPatient, amount, Date.now());
  return getPaymentRequest(Number(info.lastInsertRowid))!;
}

export function getPaymentRequest(id: number, clinicId?: number): PaymentRequest | undefined {
  const row = db
    .prepare(`
      SELECT r.*, p.name AS patient_name,
        (SELECT SUM(amount) FROM bank_transactions WHERE request_id = r.id) AS paid_amount,
        (SELECT reference_code FROM bank_transactions WHERE request_id = r.id ORDER BY id DESC LIMIT 1) AS bank_reference
      FROM payment_requests r
      LEFT JOIN patients p ON p.id = r.patient_id
      WHERE r.id = ?
    `)
    .get(id) as PaymentRequestRow | undefined;
  if (!row || (clinicId !== undefined && row.clinic_id !== clinicId)) return undefined;
  return rowToRequest(row);
}

export interface SepayWebhookBody {
  id: number;
  transferType: string;
  transferAmount: number;
  content?: string;
  code?: string | null;
  referenceCode?: string;
  transactionDate?: string;
}

/**
 * Handles an incoming SePay transfer. Transfers whose note does not contain one
 * of our pending payment codes (e.g. money from family) are ignored and not stored.
 * Transfers carrying a code are stored; once the transfers for that code add up
 * to the requested amount the request is marked paid and returned.
 */
export function recordBankTransaction(body: SepayWebhookBody): PaymentRequest | undefined {
  if (body.transferType !== 'in') return undefined;

  return transaction(() => {
    const already = db.prepare('SELECT 1 FROM bank_transactions WHERE sepay_id = ?').get(body.id);
    if (already) return undefined;

    const haystack = `${body.code ?? ''} ${body.content ?? ''}`.toUpperCase().replace(/\s+/g, '');
    const pending = db
      .prepare("SELECT * FROM payment_requests WHERE status = 'pending' ORDER BY id DESC")
      .all() as PaymentRequestRow[];
    const match = pending.find((r) => haystack.includes(r.code));
    if (!match) return undefined;

    db.prepare(`
      INSERT INTO bank_transactions
        (sepay_id, request_id, amount, content, reference_code, transaction_date, received_at, raw)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.id, match.id, toInt(body.transferAmount), str(body.content),
      body.referenceCode ?? null, body.transactionDate ?? null, Date.now(), JSON.stringify(body),
    );

    // A customer may pay one code in several transfers (e.g. short first, then the rest)
    const { total } = db
      .prepare('SELECT SUM(amount) AS total FROM bank_transactions WHERE request_id = ?')
      .get(match.id) as { total: number };
    if (total < match.amount) return undefined;

    db.prepare("UPDATE payment_requests SET status = 'paid', paid_at = ? WHERE id = ?").run(Date.now(), match.id);
    return getPaymentRequest(match.id);
  });
}

// Today's date at the clinic, whatever timezone the server runs in
function clinicToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

/**
 * Appends a confirmed QR payment to the linked patient's treatment log as a
 * payment row (cost 0, paid X, remaining -X), which lowers the patient's debt.
 * Each payment can be recorded once.
 */
export function recordPaymentToLog(clinicId: number, requestId: number): DentalRecord {
  return transaction(() => {
    const request = getPaymentRequest(requestId, clinicId);
    if (!request) throw new NotFoundError('Không tìm thấy yêu cầu thanh toán');
    if (request.status !== 'paid') throw new Error('Khoản thanh toán chưa được ngân hàng xác nhận');
    if (request.recordedAt) throw new Error('Khoản thanh toán này đã được ghi vào nhật ký');
    if (!request.patientId) throw new Error('Mã QR này không gắn với hồ sơ bệnh nhân nào');

    const paidK = Math.round((request.paidAmount ?? request.amount) / 1000); // log is in thousands of VND
    const { next } = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM treatments WHERE patient_id = ?')
      .get(request.patientId) as { next: number };
    insertTreatment.run(
      request.patientId, next, clinicToday(), '', `Thanh toán chuyển khoản (${request.code})`,
      0, paidK, -paidK, '',
    );
    db.prepare('UPDATE patients SET updated_at = ? WHERE id = ?').run(Date.now(), request.patientId);
    db.prepare('UPDATE payment_requests SET recorded_at = ? WHERE id = ?').run(Date.now(), requestId);
    return getRecord(clinicId, request.patientId)!;
  });
}

// ==========================================
// SERVICES (price list)
// ==========================================
type ServiceRow = { id: number; name: string; price: number; active: number };

function rowToService(r: ServiceRow): ServiceItem {
  return { id: r.id, name: r.name, price: r.price, active: !!r.active };
}

export function listServices(clinicId: number): ServiceItem[] {
  return (db
    .prepare('SELECT id, name, price, active FROM services WHERE clinic_id = ? ORDER BY active DESC, name')
    .all(clinicId) as ServiceRow[]).map(rowToService);
}

function validateService(input: Partial<ServiceItem>): { name: string; price: number; active: number } {
  const name = str(input.name).replace(/\s+/g, ' ');
  if (!name) throw new Error('Tên dịch vụ không được để trống');
  if (name.length > 120) throw new Error('Tên dịch vụ quá dài');
  const price = toInt(input.price);
  if (price < 0) throw new Error('Giá không được âm');
  return { name, price, active: input.active === false ? 0 : 1 };
}

function duplicateNameError(err: unknown): never {
  if (String((err as Error).message).includes('UNIQUE')) throw new Error('Đã có dịch vụ trùng tên');
  throw err;
}

/** Adds one service, or several at once (used by "suggestions from history"). */
export function createServices(clinicId: number, inputs: Partial<ServiceItem>[]): number {
  return transaction(() => {
    const insert = db.prepare('INSERT INTO services (clinic_id, name, price, active, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const input of inputs) {
      const s = validateService(input);
      try {
        insert.run(clinicId, s.name, s.price, s.active, Date.now());
      } catch (err) {
        duplicateNameError(err);
      }
    }
    return inputs.length;
  });
}

export function updateService(clinicId: number, id: number, input: Partial<ServiceItem>): ServiceItem {
  const s = validateService(input);
  let changes = 0;
  try {
    changes = Number(db
      .prepare('UPDATE services SET name = ?, price = ?, active = ? WHERE id = ? AND clinic_id = ?')
      .run(s.name, s.price, s.active, id, clinicId).changes);
  } catch (err) {
    duplicateNameError(err);
  }
  if (!changes) throw new NotFoundError('Không tìm thấy dịch vụ');
  return listServices(clinicId).find((x) => x.id === id)!;
}

export function deleteService(clinicId: number, id: number): boolean {
  return db.prepare('DELETE FROM services WHERE id = ? AND clinic_id = ?').run(id, clinicId).changes > 0;
}

// ==========================================
// SAFETY SNAPSHOTS
// ==========================================
const SNAPSHOT_KEEP = 10;

/**
 * Copies the whole database next to it before a risky bulk operation (file import),
 * keeping the most recent SNAPSHOT_KEEP copies.
 */
export async function snapshotDatabase(reason: string): Promise<string> {
  const dir = path.join(path.dirname(DB_PATH), 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${reason}.db`);
  await backup(db, file);
  const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().slice(0, -SNAPSHOT_KEEP);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
