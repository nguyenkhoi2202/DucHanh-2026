import type { DentalRecord, PlanItem, ServiceItem } from '../types';

// Money in records is in thousands of VND ("220" = 220.000đ)
export function toNum(v: unknown): number {
  return parseFloat(String(v ?? '')) || 0;
}

// "Nguyễn Văn Đức" -> "nguyen van duc", so searches and grouping ignore diacritics/case
export function foldVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function todayStr(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + days));
}

function addMonths(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * What the patient still owes, in thousands of VND. Summed over the whole log:
 * a later payment row (cost 0, paid X, remaining -X) cancels an earlier debt.
 */
export function patientDebt(rec: DentalRecord): number {
  return (rec.plan || []).reduce((sum, p) => sum + toNum(p.remaining), 0);
}

/** Most recent day the patient was seen (visit date or any treatment row). */
export function lastVisit(rec: DentalRecord): string {
  return (rec.plan || []).reduce((max, p) => (p.date && p.date > max ? p.date : max), rec.visitDate || '');
}

function sumPlans(plans: PlanItem[]) {
  return plans.reduce(
    (acc, p) => ({ cost: acc.cost + toNum(p.cost), paid: acc.paid + toNum(p.paid) }),
    { cost: 0, paid: 0 }
  );
}

// ==========================================
// DASHBOARD
// ==========================================
export interface MonthPoint {
  month: string; // YYYY-MM
  cost: number;
  paid: number;
}

export interface DoctorRow {
  name: string;
  cost: number;
  paid: number;
  visits: number;
}

export interface DashboardStats {
  thisMonth: { cost: number; paid: number; newPatients: number };
  lastMonth: { cost: number; paid: number; newPatients: number };
  treatedToday: number;
  totalDebt: number;
  debtorCount: number;
  topDebtors: { record: DentalRecord; debt: number }[];
  months: MonthPoint[]; // last 12 months, oldest first
  doctors: DoctorRow[]; // this month
}

export function computeDashboard(records: DentalRecord[], today = todayStr()): DashboardStats {
  const month = today.slice(0, 7);
  const prevMonth = addMonths(month, -1);
  const allPlans = records.flatMap((r) => r.plan || []);
  const plansIn = (ym: string) => allPlans.filter((p) => p.date?.startsWith(ym) && p.date <= today);
  const newPatientsIn = (ym: string) => records.filter((r) => r.visitDate?.startsWith(ym)).length;

  const months: MonthPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const ym = addMonths(month, -i);
    months.push({ month: ym, ...sumPlans(plansIn(ym)) });
  }

  const debts = records
    .map((record) => ({ record, debt: patientDebt(record) }))
    .filter((d) => d.debt > 0)
    .sort((a, b) => b.debt - a.debt);

  // Doctor names are typed by hand ("Hạnh", "hanh"): group on the folded name,
  // show the spelling used most often
  const doctorGroups = new Map<string, { spellings: Map<string, number>; cost: number; paid: number; visits: number }>();
  for (const p of plansIn(month)) {
    const raw = (p.doctor || '').trim() || 'Chưa ghi';
    const key = foldVietnamese(raw);
    const g = doctorGroups.get(key) ?? { spellings: new Map(), cost: 0, paid: 0, visits: 0 };
    g.spellings.set(raw, (g.spellings.get(raw) ?? 0) + 1);
    g.cost += toNum(p.cost);
    g.paid += toNum(p.paid);
    g.visits += 1;
    doctorGroups.set(key, g);
  }
  const doctors = [...doctorGroups.values()]
    .map((g) => ({
      name: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
      cost: g.cost,
      paid: g.paid,
      visits: g.visits,
    }))
    .sort((a, b) => b.paid - a.paid);

  return {
    thisMonth: { ...sumPlans(plansIn(month)), newPatients: newPatientsIn(month) },
    lastMonth: { ...sumPlans(plansIn(prevMonth)), newPatients: newPatientsIn(prevMonth) },
    treatedToday: records.filter((r) => (r.plan || []).some((p) => p.date === today)).length,
    totalDebt: debts.reduce((s, d) => s + d.debt, 0),
    debtorCount: debts.length,
    topDebtors: debts.slice(0, 6),
    months,
    doctors,
  };
}

// ==========================================
// APPOINTMENTS
// ==========================================
export interface AppointmentItem {
  record: DentalRecord;
  date: string;
  arrived: boolean; // seen on or after the appointment day
}

export interface AppointmentGroups {
  today: AppointmentItem[];
  upcoming: AppointmentItem[]; // next 7 days
  missed: AppointmentItem[]; // last 60 days, not seen since
}

export function computeAppointments(records: DentalRecord[], today = todayStr()): AppointmentGroups {
  const weekAhead = addDays(today, 7);
  const lookBack = addDays(today, -60);
  const groups: AppointmentGroups = { today: [], upcoming: [], missed: [] };

  for (const record of records) {
    const date = record.appointment;
    if (!date) continue;
    const arrived = lastVisit(record) >= date;
    const item = { record, date, arrived };
    if (date === today) groups.today.push(item);
    else if (date > today && date <= weekAhead) groups.upcoming.push(item);
    else if (date < today && date >= lookBack && !arrived) groups.missed.push(item);
  }

  groups.today.sort((a, b) => Number(a.arrived) - Number(b.arrived));
  groups.upcoming.sort((a, b) => a.date.localeCompare(b.date));
  groups.missed.sort((a, b) => b.date.localeCompare(a.date));
  return groups;
}

// ==========================================
// PRICE LIST
// ==========================================
export interface ServiceSuggestion {
  name: string; // most common spelling
  count: number; // how many treatment rows used it
  price: number; // most common non-zero cost, thousands of VND
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Treatments typed often in the log that are not in the price list yet. */
export function suggestServices(records: DentalRecord[], services: ServiceItem[], limit = 40): ServiceSuggestion[] {
  const known = new Set(services.map((s) => foldVietnamese(s.name)));
  const groups = new Map<string, { spellings: string[]; costs: number[] }>();
  for (const p of records.flatMap((r) => r.plan || [])) {
    const name = (p.treatment || '').trim().replace(/\s+/g, ' ');
    const key = foldVietnamese(name);
    // Skip empty rows and payment rows ("Thanh toán chuyển khoản (DH...)")
    if (key.length < 3 || key.startsWith('thanh toan') || known.has(key)) continue;
    const g = groups.get(key) ?? { spellings: [], costs: [] };
    g.spellings.push(name);
    if (toNum(p.cost) > 0) g.costs.push(toNum(p.cost));
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.spellings.length >= 3)
    .map((g) => ({ name: mostCommon(g.spellings)!, count: g.spellings.length, price: mostCommon(g.costs) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface ServiceRevenueRow {
  name: string;
  count: number;
  cost: number;
}

/** This month's treatment revenue grouped by price-list service; free text goes to "Khác". */
export function serviceBreakdown(records: DentalRecord[], services: ServiceItem[], today = todayStr()): ServiceRevenueRow[] {
  const month = today.slice(0, 7);
  const byKey = new Map(services.map((s) => [foldVietnamese(s.name), s.name]));
  const rows = new Map<string, ServiceRevenueRow>();
  for (const p of records.flatMap((r) => r.plan || [])) {
    if (!p.date?.startsWith(month) || p.date > today || toNum(p.cost) <= 0) continue;
    const name = byKey.get(foldVietnamese(p.treatment || '')) ?? 'Khác (ghi tự do)';
    const row = rows.get(name) ?? { name, count: 0, cost: 0 };
    row.count += 1;
    row.cost += toNum(p.cost);
    rows.set(name, row);
  }
  return [...rows.values()].sort((a, b) => b.cost - a.cost);
}
