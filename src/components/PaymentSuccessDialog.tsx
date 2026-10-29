import React, { useEffect, useState } from 'react';
import { CheckCircle2, NotebookPen } from 'lucide-react';
import type { PaymentRequest } from '../types';

interface PaymentSuccessDialogProps {
  payment: PaymentRequest | null;
  queued: number; // further confirmed payments waiting behind this one
  onClose: () => void;
  onRecord: (payment: PaymentRequest) => Promise<boolean>; // adds the payment row to the treatment log
}

// Short two-note chime so the front desk hears the payment arrive
function playChime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch (err) {
    console.error('Chime failed', err);
  }
}

function formatTime(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default function PaymentSuccessDialog({ payment, queued, onClose, onRecord }: PaymentSuccessDialogProps) {
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    if (payment) playChime();
    setRecorded(!!payment?.recordedAt);
  }, [payment?.id]);

  async function handleRecord() {
    if (!payment) return;
    setRecording(true);
    if (await onRecord(payment)) setRecorded(true);
    setRecording(false);
  }

  if (!payment) return null;

  const received = payment.paidAmount ?? payment.amount;

  return (
    <div id="payment_success_overlay" className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div id="payment_success" className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden border border-emerald-100">
        <div className="bg-gradient-to-b from-emerald-500 to-emerald-600 text-white px-6 pt-8 pb-6 flex flex-col items-center text-center">
          <CheckCircle2 size={72} strokeWidth={1.75} className="mb-3" />
          <h3 className="text-2xl font-black tracking-tight">Thanh toán thành công</h3>
          {payment.patientName && <p className="mt-1 text-sm text-emerald-50">{payment.patientName}</p>}
          <p className="mt-4 text-3xl font-black font-mono">{received.toLocaleString('vi-VN')} đ</p>
        </div>

        <div className="p-6 space-y-2 text-xs text-slate-500">
          {received > payment.amount && (
            <p className="p-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-100">
              Khách chuyển dư {(received - payment.amount).toLocaleString('vi-VN')} đ so với yêu cầu{' '}
              {payment.amount.toLocaleString('vi-VN')} đ.
            </p>
          )}
          <div className="flex justify-between">
            <span className="font-semibold">Thời gian nhận:</span>
            <span className="text-slate-700 font-mono">{formatTime(payment.paidAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">Mã thanh toán:</span>
            <span className="text-slate-700 font-mono font-bold">{payment.code}</span>
          </div>
          {payment.bankReference && (
            <div className="flex justify-between">
              <span className="font-semibold">Mã giao dịch ngân hàng:</span>
              <span className="text-slate-700 font-mono">{payment.bankReference}</span>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 space-y-2">
          {payment.patientId ? (
            <button
              id="payment_record_btn"
              onClick={handleRecord}
              disabled={recording || recorded}
              className="w-full py-2.5 flex items-center justify-center gap-1.5 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-emerald-800 font-bold text-sm rounded-xl transition-colors cursor-pointer disabled:cursor-default"
            >
              <NotebookPen size={15} />
              {recorded ? 'Đã ghi vào nhật ký điều trị' : recording ? 'Đang ghi...' : 'Ghi vào nhật ký điều trị'}
            </button>
          ) : (
            <p className="text-[11px] text-slate-400 text-center">
              Mã QR này không gắn với hồ sơ nào: nhớ ghi số tiền vào nhật ký điều trị của bệnh nhân.
            </p>
          )}
          <button
            id="payment_success_close_btn"
            onClick={onClose}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl transition-colors cursor-pointer"
          >
            {queued > 0 ? `Tiếp (${queued} thanh toán nữa)` : 'Hoàn tất'}
          </button>
        </div>
      </div>
    </div>
  );
}
