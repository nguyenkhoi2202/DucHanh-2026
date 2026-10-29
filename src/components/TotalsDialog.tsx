import React from 'react';
import { X, TrendingUp, Landmark, ShieldCheck, PieChart } from 'lucide-react';

interface TotalsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  totalCost: number;
  totalPaid: number;
  totalRemaining: number;
  recordCount?: number;
}

export default function TotalsDialog({ isOpen, onClose, title, totalCost, totalPaid, totalRemaining, recordCount }: TotalsDialogProps) {
  if (!isOpen) return null;

  return (
    <div id="totals_dialog_overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div 
        id="totals_dialog" 
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden transform scale-100 transition-transform duration-300 border border-slate-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-teal-600 text-white">
          <div className="flex items-center gap-2">
            <PieChart size={20} />
            <h3 className="font-bold text-lg tracking-tight">{title}</h3>
          </div>
          <button 
            id="close_totals_btn"
            onClick={onClose} 
            className="text-white hover:bg-white/10 rounded-full p-1.5 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {recordCount !== undefined && (
            <div className="text-center text-sm font-medium text-slate-500 bg-slate-50 rounded-lg py-2 border border-slate-100">
              Tổng số bản ghi thống kê: <span className="text-slate-800 font-bold font-mono">{recordCount}</span> hồ sơ
            </div>
          )}

          <div className="space-y-4">
            {/* Standard Cost Item */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-sky-50 text-sky-600 rounded-lg">
                  <TrendingUp size={22} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-700">Tổng doanh thu</h4>
                  <p className="text-xs text-slate-500">Tổng số tiền theo hợp đồng</p>
                </div>
              </div>
              <span className="text-lg font-bold text-slate-800 font-mono">
                {(totalCost * 1000).toLocaleString('vi-VN')} VND
              </span>
            </div>

            {/* Paid Item */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-teal-50 text-teal-600 rounded-lg">
                  <Landmark size={22} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-700 font-semibold">Đã thanh toán</h4>
                  <p className="text-xs text-slate-500">Tổng số tiền thực thu</p>
                </div>
              </div>
              <span className="text-lg font-bold text-teal-600 font-mono">
                {(totalPaid * 1000).toLocaleString('vi-VN')} VND
              </span>
            </div>

            {/* Remaining Item */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-50 text-rose-600 rounded-lg">
                  <ShieldCheck size={22} className="rotate-180" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-700">Công nợ còn lại</h4>
                  <p className="text-xs text-slate-500">Khách hàng còn nợ</p>
                </div>
              </div>
              <span className={`text-lg font-bold font-mono ${totalRemaining > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                {(totalRemaining * 1000).toLocaleString('vi-VN')} VND
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button 
            id="close_totals_primary"
            onClick={onClose} 
            className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium text-sm rounded-lg shadow-md hover:shadow-lg transition-all cursor-pointer"
          >
            Đồng ý
          </button>
        </div>
      </div>
    </div>
  );
}
