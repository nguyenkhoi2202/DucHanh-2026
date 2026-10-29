// Sends a fake SePay webhook to the local server, as if a customer had paid.
// Usage: npm run sepay:simulate -- <PAYMENT_CODE> <AMOUNT_VND> [server URL]
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const [code, amountArg, url = `http://localhost:${process.env.PORT || 3000}`] = process.argv.slice(2);
const amount = Number(amountArg);
if (!code || !Number.isFinite(amount) || amount <= 0) {
  console.error('Cách dùng: npm run sepay:simulate -- DH1A2B3C4D5E 450000');
  process.exit(1);
}
if (!process.env.SEPAY_API_KEY) {
  console.error('Chưa đặt SEPAY_API_KEY trong .env');
  process.exit(1);
}

const id = Date.now();
const res = await fetch(`${url}/api/sepay/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${process.env.SEPAY_API_KEY}` },
  body: JSON.stringify({
    id,
    gateway: 'Simulator',
    transactionDate: new Date().toISOString().replace('T', ' ').slice(0, 19),
    accountNumber: process.env.BANK_ACCOUNT_NO,
    code: null,
    content: `${code} TT NHA KHOA`,
    transferType: 'in',
    transferAmount: amount,
    accumulated: 0,
    subAccount: null,
    referenceCode: `SIM${id}`,
    description: `Giả lập chuyển khoản ${code}`,
  }),
});
console.log(res.status, await res.text());
