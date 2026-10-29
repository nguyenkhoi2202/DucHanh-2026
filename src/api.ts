import type { BankConfig, DentalRecord, DentalRecordInput, PaymentRequest } from './types';

export class UnauthorizedError extends Error {}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new UnauthorizedError(data.error || 'Chưa đăng nhập');
  if (!res.ok) throw new Error(data.error || `Lỗi máy chủ (${res.status})`);
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>('/api/logout', { method: 'POST' }),
  me: async () => {
    const res = await request<{ loggedIn: boolean; config?: BankConfig }>('/api/me');
    if (!res.loggedIn || !res.config) throw new UnauthorizedError('Chưa đăng nhập');
    return res.config;
  },

  listRecords: () => request<DentalRecord[]>('/api/records'),
  createRecord: (data: DentalRecordInput) =>
    request<DentalRecord>('/api/records', { method: 'POST', body: JSON.stringify(data) }),
  updateRecord: (id: number, data: DentalRecordInput) =>
    request<DentalRecord>(`/api/records/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecord: (id: number) => request<{ ok: true }>(`/api/records/${id}`, { method: 'DELETE' }),
  importRecords: (records: unknown[]) =>
    request<{ imported: number; total: number }>('/api/records/import', {
      method: 'POST',
      body: JSON.stringify(records),
    }),

  createPaymentRequest: (amount: number, patientId: number | null) =>
    request<PaymentRequest>('/api/payment-requests', {
      method: 'POST',
      body: JSON.stringify({ amount, patientId }),
    }),
  getPaymentRequest: (id: number) => request<PaymentRequest>(`/api/payment-requests/${id}`),
};

/** Builds the SePay QR image URL (free, no API key needed). */
export function buildQrUrl(config: BankConfig, amount: number, note: string): string {
  const params = new URLSearchParams({
    acc: config.accountNo,
    bank: config.bankCode,
    amount: String(amount),
    des: note,
    template: 'compact',
  });
  return `https://qr.sepay.vn/img?${params}`;
}
