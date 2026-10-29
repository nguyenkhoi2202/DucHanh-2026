import React, { useEffect } from 'react';
import { X, Copy, Check, Loader2 } from 'lucide-react';
import { api, buildQrUrl } from '../api';
import type { BankConfig, PaymentRequest } from '../types';

interface VietQRPopupProps {
  request: PaymentRequest | null;
  config: BankConfig | null;
  patientName: string;
  onClose: () => void;
  onPaid: (request: PaymentRequest) => void;
}

export default function VietQRPopup({ request, config, patientName, onClose, onPaid }: VietQRPopupProps) {
  const [copied, setCopied] = React.useState(false);
  const [received, setReceived] = React.useState(0); // partial transfers so far

  // SePay pushes payment events over the realtime channel; this poll is a
  // fallback in case that connection dropped while the QR was on screen.
  useEffect(() => {
    if (!request || !config?.sepayEnabled) return;
    const timer = setInterval(async () => {
      try {
        const latest = await api.getPaymentRequest(request.id);
        if (latest.status === 'paid') onPaid(latest);
        else if ((latest.paidAmount ?? 0) !== (request.paidAmount ?? 0)) setReceived(latest.paidAmount ?? 0);
      } catch (err) {
        console.error('Payment status poll failed', err);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [request, config, onPaid]);

  if (!request || !config) return null;

  const qrImageUrl = buildQrUrl(config, request.amount, request.code);

  function handleCopyInfo() {
    navigator.clipboard.writeText(request!.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div id="qr_popup_overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div
        id="qr_popup"
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden transform scale-100 transition-transform duration-300 relative border border-slate-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-gradient-to-r from-teal-500 to-cyan-600 text-white">
          <h3 className="font-bold text-lg tracking-tight">Mã QR thanh toán</h3>
          <button
            id="close_qr_btn"
            onClick={onClose}
            className="text-white hover:bg-white/10 rounded-full p-1.5 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center">
          <p className="text-sm font-medium text-slate-500 mb-1">
            {patientName ? `${patientName} · ` : ''}Quét mã bằng app ngân hàng bất kỳ
          </p>
          <p className="text-xl font-bold text-slate-800 mb-4 font-mono">
            {request.amount.toLocaleString('vi-VN')} VND
          </p>

          <div className="relative p-3 bg-teal-50/50 rounded-xl border border-teal-100/60 shadow-inner mb-4 flex justify-center items-center w-64 h-64">
            <img
              id="qr_image"
              src={qrImageUrl}
              alt="Mã QR thanh toán"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain rounded-lg"
            />
          </div>

          {config.sepayEnabled ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500 mb-4">
              <Loader2 size={13} className="animate-spin text-teal-500" />
              Đang chờ ngân hàng xác nhận... Màn hình sẽ tự chuyển khi nhận được tiền.
            </p>
          ) : null}
          {config.sepayEnabled && received > 0 && received < request.amount ? (
            <p id="qr_partial_notice" className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4 text-center">
              Đã nhận {received.toLocaleString('vi-VN')} đ, còn thiếu {(request.amount - received).toLocaleString('vi-VN')} đ.
              Khách chuyển thêm với cùng nội dung là đủ.
            </p>
          ) : null}
          {!config.sepayEnabled && (
            <p className="text-[11px] text-amber-600 mb-4 text-center">
              Chưa cấu hình SePay: hãy kiểm tra app ngân hàng để xác nhận đã nhận tiền.
            </p>
          )}

          <div className="w-full bg-slate-50 rounded-xl p-4 border border-slate-100 text-left space-y-2">
            <div className="grid grid-cols-3 text-xs text-slate-500">
              <span className="font-semibold col-span-1">Ngân hàng:</span>
              <span className="col-span-2 text-slate-700 font-medium">{config.bankName}</span>
            </div>
            <div className="grid grid-cols-3 text-xs text-slate-500">
              <span className="font-semibold col-span-1">Chủ tài khoản:</span>
              <span className="col-span-2 text-slate-700 font-medium">{config.accountName}</span>
            </div>
            <div className="grid grid-cols-3 text-xs text-slate-500">
              <span className="font-semibold col-span-1">Số tài khoản:</span>
              <span className="col-span-2 text-slate-700 font-semibold font-mono">{config.accountNo}</span>
            </div>
            <div className="grid grid-cols-3 text-xs text-slate-500">
              <span className="font-semibold col-span-1">Nội dung chuyển:</span>
              <span className="col-span-2 text-slate-700 break-words flex items-center justify-between gap-1 bg-white p-1.5 rounded border border-slate-100">
                <span className="text-[11px] font-mono font-bold leading-tight">{request.code}</span>
                <button
                  onClick={handleCopyInfo}
                  className="text-teal-600 hover:text-teal-700 hover:bg-teal-50 p-1 rounded shrink-0 transition-colors cursor-pointer"
                  title="Sao chép nội dung"
                >
                  {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                </button>
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-sm rounded-lg transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
