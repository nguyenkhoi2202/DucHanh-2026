import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { DentalRecord, PlanItem, PaymentRequest } from '../src/types';

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'duchanh.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

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

// Databases created before the remaining column existed
const treatmentColumns = db.prepare('PRAGMA table_info(treatments)').all() as { name: string }[];
if (!treatmentColumns.some((c) => c.name === 'remaining')) {
  db.exec('ALTER TABLE treatments ADD COLUMN remaining INTEGER NOT NULL DEFAULT 0');
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

export function listRecords(): DentalRecord[] {
  const patients = db.prepare('SELECT * FROM patients ORDER BY id').all() as PatientRow[];
  const treatments = db
    .prepare('SELECT * FROM treatments ORDER BY patient_id, position')
    .all() as TreatmentRow[];

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

export function getRecord(id: number): DentalRecord | undefined {
  return listRecords().find((r) => r.id === id);
}

const insertPatient = db.prepare(`
  INSERT INTO patients (id, name, phone, address, age, visit_date, appointment, created_at, updated_at)
  VALUES (:id, :name, :phone, :address, :age, :visit_date, :appointment, :now, :now)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, phone = excluded.phone, address = excluded.address,
    age = excluded.age, visit_date = excluded.visit_date,
    appointment = excluded.appointment, updated_at = excluded.updated_at
`);
const deleteTreatments = db.prepare('DELETE FROM treatments WHERE patient_id = ?');
const insertTreatment = db.prepare(`
  INSERT INTO treatments (patient_id, position, date, tooth, treatment, cost, paid, remaining, doctor)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function writeRecord(input: Partial<DentalRecord>, id: number) {
  insertPatient.run({
    id,
    name: str(input.name),
    phone: str(input.phone),
    address: str(input.address),
    age: str(input.dob),
    visit_date: str(input.visitDate),
    appointment: str(input.appointment),
    now: Date.now(),
  });
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

export function saveRecord(input: Partial<DentalRecord>, id?: number): DentalRecord {
  if (!str(input.name)) throw new Error('Thiếu họ tên bệnh nhân');
  const recordId = id ?? nextPatientId();
  transaction(() => writeRecord(input, recordId));
  return getRecord(recordId)!;
}

export function deleteRecord(id: number): boolean {
  return db.prepare('DELETE FROM patients WHERE id = ?').run(id).changes > 0;
}

// Imports legacy JSON backups (same shape as the old localStorage data).
// Records are upserted by id, so importing the same file twice is harmless.
export function importRecords(records: Partial<DentalRecord>[]): number {
  return transaction(() => {
    let count = 0;
    for (const rec of records) {
      if (!str(rec.name)) continue;
      const id = Number(rec.id) > 0 ? Number(rec.id) : nextPatientId();
      writeRecord(rec, id);
      count++;
    }
    return count;
  });
}

function nextPatientId(): number {
  // Keep the old millisecond-timestamp style ids so imported and new records never collide.
  const row = db.prepare('SELECT MAX(id) AS maxId FROM patients').get() as { maxId: number | null };
  return Math.max(Date.now(), (row.maxId ?? 0) + 1);
}

export function countRecords(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM patients').get() as { c: number }).c;
}

// ==========================================
// SESSIONS
// ==========================================
export function createSession(token: string, expiresAt: number) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt);
}

export function isSessionValid(token: string): boolean {
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token) as
    | { expires_at: number }
    | undefined;
  return !!row && row.expires_at > Date.now();
}

export function deleteSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ==========================================
// PAYMENTS (SePay)
// ==========================================
type PaymentRequestRow = {
  id: number; code: string; patient_id: number | null; amount: number;
  status: 'pending' | 'paid'; created_at: number; paid_at: number | null;
  patient_name?: string | null; paid_amount?: number | null; bank_reference?: string | null;
};

function rowToRequest(r: PaymentRequestRow): PaymentRequest {
  return {
    id: r.id,
    code: r.code,
    patientId: r.patient_id,
    patientName: r.patient_name ?? null,
    amount: r.amount,
    status: r.status,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    paidAmount: r.paid_amount ?? null,
    bankReference: r.bank_reference ?? null,
  };
}

export function createPaymentRequest(code: string, amount: number, patientId: number | null): PaymentRequest {
  const info = db
    .prepare('INSERT INTO payment_requests (code, patient_id, amount, created_at) VALUES (?, ?, ?, ?)')
    .run(code, patientId, amount, Date.now());
  return getPaymentRequest(Number(info.lastInsertRowid))!;
}

export function getPaymentRequest(id: number): PaymentRequest | undefined {
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
  return row && rowToRequest(row);
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
