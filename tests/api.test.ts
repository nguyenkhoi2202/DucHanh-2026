// End-to-end API tests against a real server process on a throwaway database.
// Run: npm test
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'duchanh-test-'));
const ENV = {
  ...process.env,
  NODE_ENV: 'production', // API only: no Vite dev server
  PORT: String(PORT),
  DB_PATH: path.join(TMP, 'test.db'),
  APP_USERNAME: 'bt',
  APP_PASSWORD: 'binhthuan-pass',
  SEPAY_API_KEY: 'test-key',
  BANK_ACCOUNT_NO: '123',
  BANK_ACCOUNT_NAME: 'TEST',
};

let server: ChildProcess;

// ---- tiny HTTP client with a cookie jar per user
class Client {
  cookie = '';
  async call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  get = (url: string) => this.call('GET', url);
  post = (url: string, body?: unknown) => this.call('POST', url, body ?? {});
  put = (url: string, body: unknown) => this.call('PUT', url, body);
  del = (url: string) => this.call('DELETE', url);
}

const bt = new Client(); // Nha Khoa Bình Thuận
const cb = new Client(); // Nha Khoa Cư Bao

const webhook = (body: Record<string, unknown>, key = 'test-key') =>
  new Client().call('POST', '/api/sepay/webhook', body, { Authorization: `Apikey ${key}` });

before(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: ENV, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/me`)).ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  execFileSync(process.execPath, ['--import', 'tsx', 'server/user.ts', 'set', 'cb', 'cubao-pass', 'cu-bao'], { env: ENV, stdio: 'ignore' });
  assert.equal((await bt.post('/api/login', { username: 'bt', password: 'binhthuan-pass' })).status, 200);
  assert.equal((await cb.post('/api/login', { username: 'cb', password: 'cubao-pass' })).status, 200);
});

after(() => {
  server?.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const patient = (name: string, cost = 1000, paid = 0) => ({
  name, phone: '0900', address: '', dob: '30', visitDate: '2026-10-01', appointment: '',
  plan: [{ date: '2026-10-01', tooth: '', treatment: 'Bọc sứ', cost, paid, remaining: cost - paid, doctor: 'My' }],
});

describe('hai nha khoa độc lập', () => {
  test('mỗi nha khoa chỉ thấy bệnh nhân của mình', async () => {
    const a = await bt.post('/api/records', patient('BT 1'));
    const b = await cb.post('/api/records', patient('CB 1'));
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const btList = (await bt.get('/api/records')).data as { name: string }[];
    const cbList = (await cb.get('/api/records')).data as { name: string }[];
    assert.deepEqual(btList.map((r) => r.name), ['BT 1']);
    assert.deepEqual(cbList.map((r) => r.name), ['CB 1']);
  });

  test('không sửa, xoá được hồ sơ của nha khoa kia', async () => {
    const btId = ((await bt.get('/api/records')).data as { id: number }[])[0].id;
    assert.equal((await cb.put(`/api/records/${btId}`, patient('hack'))).status, 404);
    assert.equal((await cb.del(`/api/records/${btId}`)).status, 404);
    const still = ((await bt.get('/api/records')).data as { name: string }[])[0];
    assert.equal(still.name, 'BT 1');
  });

  test('nhập file chứa hồ sơ của nha khoa kia: bỏ qua, không sao chép sang', async () => {
    const btRecords = (await bt.get('/api/records')).data as { id: number }[];
    const res = await cb.post('/api/records/import', [
      { ...patient('copy of BT'), id: btRecords[0].id },
      { ...patient('CB from file'), id: 1700000000001 },
    ]);
    assert.equal(res.status, 200);
    assert.equal(res.data.imported, 1);
    assert.equal(res.data.skippedOtherClinic, 1);
    const names = ((await cb.get('/api/records')).data as { name: string }[]).map((r) => r.name).sort();
    assert.deepEqual(names, ['CB 1', 'CB from file']);
    assert.equal(((await bt.get('/api/records')).data as unknown[]).length, 1);
  });

  test('bảng giá riêng cho từng nha khoa, trùng tên không phân biệt dấu', async () => {
    assert.equal((await bt.post('/api/services', { name: 'Bọc Sứ Zico', price: 3000 })).status, 201);
    assert.equal((await bt.post('/api/services', { name: 'boc su  zico', price: 1 })).status, 400);
    assert.equal((await cb.post('/api/services', { name: 'Bọc Sứ Zico', price: 2800 })).status, 201);
    const btSvc = (await bt.get('/api/services')).data as { id: number; price: number }[];
    const cbSvc = (await cb.get('/api/services')).data as { id: number; price: number }[];
    assert.deepEqual([btSvc.length, btSvc[0].price, cbSvc.length, cbSvc[0].price], [1, 3000, 1, 2800]);
    assert.equal((await cb.put(`/api/services/${btSvc[0].id}`, { name: 'x', price: 1 })).status, 404);
  });

  test('Cư Bao không dùng QR; Bình Thuận không gắn QR vào bệnh nhân Cư Bao', async () => {
    assert.equal((await cb.post('/api/payment-requests', { amount: 50000 })).status, 403);
    assert.equal((await cb.get('/api/me')).data.bank, null);
    const cbId = ((await cb.get('/api/records')).data as { id: number }[])[0].id;
    const pr = await bt.post('/api/payment-requests', { amount: 50000, patientId: cbId });
    assert.equal(pr.status, 201);
    assert.equal(pr.data.patientId, null);
    assert.equal((await cb.get(`/api/payment-requests/${pr.data.id}`)).status, 404);
  });
});

describe('thanh toán SePay', () => {
  test('sai API key bị từ chối', async () => {
    assert.equal((await webhook({ id: 1, transferType: 'in', transferAmount: 1, content: '' }, 'wrong')).status, 401);
  });

  test('chuyển 2 lần đủ tiền thì thành công; tiền không có mã bị bỏ qua; ghi nhật ký một lần', async () => {
    const id = ((await bt.get('/api/records')).data as { id: number }[])[0].id;
    const pr = (await bt.post('/api/payment-requests', { amount: 1_000_000, patientId: id })).data;
    await webhook({ id: 100, transferType: 'in', transferAmount: 5_000_000, content: 'ME CHUYEN TIEN' });
    await webhook({ id: 101, transferType: 'in', transferAmount: 400_000, content: `abc ${pr.code.toLowerCase()} xyz` });
    let state = (await bt.get(`/api/payment-requests/${pr.id}`)).data;
    assert.deepEqual([state.status, state.paidAmount], ['pending', 400_000]);
    await webhook({ id: 102, transferType: 'in', transferAmount: 600_000, content: pr.code });
    await webhook({ id: 102, transferType: 'in', transferAmount: 600_000, content: pr.code }); // SePay retry
    state = (await bt.get(`/api/payment-requests/${pr.id}`)).data;
    assert.deepEqual([state.status, state.paidAmount], ['paid', 1_000_000]);

    const recorded = await bt.post(`/api/payment-requests/${pr.id}/record`);
    assert.equal(recorded.status, 200);
    const debt = (recorded.data.plan as { remaining: number }[]).reduce((s, p) => s + p.remaining, 0);
    assert.equal(debt, 0); // 1000k treatment - 1000k payment
    assert.equal((await bt.post(`/api/payment-requests/${pr.id}/record`)).status, 400);
  });
});

describe('dữ liệu', () => {
  test('hai máy cùng sửa một hồ sơ: máy lưu sau với bản cũ bị chặn (409)', async () => {
    const rec = ((await bt.get('/api/records')).data as { id: number; updatedAt: number }[])[0];
    const first = await bt.put(`/api/records/${rec.id}`, { ...patient('máy A'), updatedAt: rec.updatedAt });
    assert.equal(first.status, 200);
    const stale = await bt.put(`/api/records/${rec.id}`, { ...patient('máy B'), updatedAt: rec.updatedAt });
    assert.equal(stale.status, 409);
    const fresh = await bt.put(`/api/records/${rec.id}`, { ...patient('máy B'), updatedAt: first.data.updatedAt });
    assert.equal(fresh.status, 200);
  });

  test('số tiền "1.200" được hiểu là 1200 (nghìn đồng)', async () => {
    const res = await cb.post('/api/records', { ...patient('dots'), plan: [{ date: '', treatment: 'x', cost: '1.200', paid: '200', remaining: '', doctor: '' }] });
    assert.deepEqual([res.data.plan[0].cost, res.data.plan[0].remaining], [1200, 1000]);
  });
});

describe('đăng nhập', () => {
  test('khoá tài khoản sau 10 lần sai, kể cả khi đổi IP', async () => {
    const attacker = new Client();
    for (let i = 0; i < 10; i++) {
      await attacker.call('POST', '/api/login', { username: 'cb', password: 'wrong' }, { 'X-Forwarded-For': `203.0.113.${i}` });
    }
    const locked = await attacker.call('POST', '/api/login', { username: 'cb', password: 'cubao-pass' }, { 'X-Forwarded-For': '198.51.100.7' });
    assert.equal(locked.status, 429);
  });

  test('đăng xuất thì không truy cập được dữ liệu', async () => {
    const c = new Client();
    await c.post('/api/login', { username: 'bt', password: 'binhthuan-pass' });
    assert.equal((await c.get('/api/records')).status, 200);
    await c.post('/api/logout');
    assert.equal((await c.get('/api/records')).status, 401);
  });
});
