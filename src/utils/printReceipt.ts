import type { ClinicInfo, DentalRecordInput } from '../types';
import { toNum } from './stats';

const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const vnd = (k: number) => `${Math.round(k * 1000).toLocaleString('vi-VN')} đ`;
// Dates are free text in old data, so escape them like everything else
const ddmm = (ymd: string) => escapeHtml(ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '');

/** Opens a printable A5 treatment & payment slip for the patient. */
export function printReceipt(clinic: ClinicInfo, record: DentalRecordInput) {
  const rows = (record.plan || []).filter((p) => p.treatment || toNum(p.cost) || toNum(p.paid) || toNum(p.remaining));
  const totalCost = rows.reduce((s, p) => s + toNum(p.cost), 0);
  const totalPaid = rows.reduce((s, p) => s + toNum(p.paid), 0);
  const debt = rows.reduce((s, p) => s + toNum(p.remaining), 0);
  const now = new Date();

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Phiếu điều trị - ${escapeHtml(record.name)}</title>
<style>
  @page { size: A5; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; font-size: 12px; margin: 0; }
  header { text-align: center; border-bottom: 2px solid #0d9488; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 18px; margin: 0; color: #0f766e; }
  .hotline { font-size: 11px; color: #475569; margin-top: 2px; }
  h2 { text-align: center; font-size: 15px; margin: 8px 0; letter-spacing: .5px; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 16px; margin-bottom: 10px; }
  .info b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-size: 11px; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; background: #f8fafc; }
  .debt { color: #be123c; }
  .sign { display: flex; justify-content: space-between; margin-top: 28px; text-align: center; }
  .sign div { width: 45%; }
  .sign small { color: #64748b; }
  footer { margin-top: 40px; text-align: center; font-size: 10px; color: #64748b; }
</style></head><body>
<header>
  <h1>${escapeHtml(clinic.name)}</h1>
  ${clinic.hotlines.length ? `<div class="hotline">Hotline: ${clinic.hotlines.map((h) => `${escapeHtml(h.phone)} (${escapeHtml(h.label)})`).join(' · ')}</div>` : ''}
</header>
<h2>PHIẾU ĐIỀU TRỊ &amp; THANH TOÁN</h2>
<div class="info">
  <div><b>Bệnh nhân:</b> ${escapeHtml(record.name)}</div>
  <div><b>Tuổi:</b> ${escapeHtml(record.dob)}</div>
  <div><b>Điện thoại:</b> ${escapeHtml(record.phone)}</div>
  <div><b>Ngày khám:</b> ${ddmm(record.visitDate)}</div>
  <div style="grid-column: 1 / -1"><b>Địa chỉ:</b> ${escapeHtml(record.address)}</div>
  ${record.appointment ? `<div><b>Hẹn tái khám:</b> ${ddmm(record.appointment)}</div>` : ''}
</div>
<table>
  <thead><tr><th>Ngày</th><th>Răng</th><th>Điều trị</th><th class="num">Chi phí</th><th class="num">Đã trả</th></tr></thead>
  <tbody>
    ${rows.map((p) => `<tr><td>${ddmm(p.date)}</td><td>${escapeHtml(p.tooth)}</td><td>${escapeHtml(p.treatment)}</td><td class="num">${vnd(toNum(p.cost))}</td><td class="num">${vnd(toNum(p.paid))}</td></tr>`).join('')}
  </tbody>
  <tfoot>
    <tr><td colspan="3">Tổng cộng</td><td class="num">${vnd(totalCost)}</td><td class="num">${vnd(totalPaid)}</td></tr>
    <tr><td colspan="3">Còn nợ</td><td class="num debt" colspan="2">${vnd(Math.max(0, debt))}</td></tr>
  </tfoot>
</table>
<div class="sign">
  <div><b>Bệnh nhân</b><br><small>(Ký, ghi rõ họ tên)</small></div>
  <div><b>Ngày ${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}</b><br><small>Người lập phiếu</small></div>
</div>
<footer>Cảm ơn quý khách đã tin tưởng ${escapeHtml(clinic.name)}!</footer>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const win = window.open('', '_blank', 'width=720,height=900');
  if (!win) {
    alert('Trình duyệt đã chặn cửa sổ in. Hãy cho phép popup cho trang này rồi thử lại.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
