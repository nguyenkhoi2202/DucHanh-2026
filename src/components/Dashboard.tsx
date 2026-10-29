import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Wallet, Receipt, UserPlus, AlertTriangle, Stethoscope, Table2, BarChart3, Tags } from 'lucide-react';
import type { DentalRecord, ServiceItem } from '../types';
import { computeDashboard, serviceBreakdown, type MonthPoint } from '../utils/stats';

interface DashboardProps {
  records: DentalRecord[];
  services: ServiceItem[];
  today: string;
  onOpenRecord: (record: DentalRecord) => void;
}

// Amounts are in thousands of VND
const vnd = (k: number) => `${Math.round(k * 1000).toLocaleString('vi-VN')} đ`;
const compactVnd = (k: number) =>
  k >= 1000 ? `${(k / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr` : `${Math.round(k)}k`;
const monthLabel = (ym: string) => `T${Number(ym.slice(5))}/${ym.slice(2, 4)}`;

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="text-[11px] text-slate-400">Chưa có số liệu tháng trước</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${up ? 'text-emerald-700' : 'text-rose-700'}`}>
      <Icon size={12} />
      {up ? '+' : ''}
      {pct}% so với tháng trước
    </span>
  );
}

function KpiCard(props: { icon: React.ReactNode; label: string; value: string; footer: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span className="p-1.5 rounded-lg bg-slate-50 text-slate-600">{props.icon}</span>
        {props.label}
      </div>
      <div className="text-2xl font-black text-slate-800 font-mono tracking-tight">{props.value}</div>
      <div>{props.footer}</div>
    </div>
  );
}

function RevenueChart({ months }: { months: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { top: 16, right: 8, bottom: 26, left: 48 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = Math.max(...months.map((m) => m.paid), 1);
  // About 4 gridlines at "nice" steps (1, 2, 2.5, 5 × 10^n), axis just above the tallest bar
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const slot = plotW / months.length;
  const barW = Math.min(36, slot - 8);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Thực thu 12 tháng gần nhất">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400" fontSize={10}>
              {compactVnd(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = pad.left + slot * i + (slot - barW) / 2;
          const h = Math.max(0, pad.top + plotH - y(m.paid));
          const r = Math.min(4, h);
          return (
            <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target spans the whole slot, larger than the bar */}
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(m.paid) + r} Q${x},${y(m.paid)} ${x + r},${y(m.paid)} H${x + barW - r} Q${x + barW},${y(m.paid)} ${x + barW},${y(m.paid) + r} V${y(0)} Z`}
                  fill="#0d9488"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="fill-slate-500" fontSize={10}>
                {monthLabel(m.month)}
              </text>
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 bg-slate-900 text-white rounded-lg px-3 py-2 text-[11px] shadow-lg whitespace-nowrap"
          style={{ left: `${((pad.left + slot * hover + slot / 2) / W) * 100}%` }}
        >
          <div className="font-bold mb-0.5">Tháng {months[hover].month.slice(5)}/{months[hover].month.slice(0, 4)}</div>
          <div>Thực thu: <span className="font-mono font-bold">{vnd(months[hover].paid)}</span></div>
          <div className="text-slate-300">Doanh thu: <span className="font-mono">{vnd(months[hover].cost)}</span></div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ records, services, today, onOpenRecord }: DashboardProps) {
  const stats = useMemo(() => computeDashboard(records, today), [records, today]);
  const byService = useMemo(() => serviceBreakdown(records, services, today), [records, services, today]);
  const [showTable, setShowTable] = useState(false);
  const { thisMonth, lastMonth } = stats;

  return (
    <div id="dashboard" className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Wallet size={14} />}
          label="Thực thu tháng này"
          value={vnd(thisMonth.paid)}
          footer={<Delta now={thisMonth.paid} before={lastMonth.paid} />}
        />
        <KpiCard
          icon={<Receipt size={14} />}
          label="Doanh thu điều trị tháng này"
          value={vnd(thisMonth.cost)}
          footer={<Delta now={thisMonth.cost} before={lastMonth.cost} />}
        />
        <KpiCard
          icon={<UserPlus size={14} />}
          label="Bệnh nhân mới tháng này"
          value={thisMonth.newPatients.toLocaleString('vi-VN')}
          footer={<span className="text-[11px] text-slate-500">Hôm nay đã điều trị: <b className="text-slate-700">{stats.treatedToday}</b> bệnh nhân</span>}
        />
        <KpiCard
          icon={<AlertTriangle size={14} />}
          label="Tổng công nợ"
          value={vnd(stats.totalDebt)}
          footer={<span className="text-[11px] text-slate-500"><b className="text-slate-700">{stats.debtorCount}</b> bệnh nhân còn nợ</span>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-xs p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold text-slate-800">Thực thu 12 tháng gần nhất</h3>
              <p className="text-[11px] text-slate-400">Rê chuột lên cột để xem chi tiết</p>
            </div>
            <button
              id="dashboard_toggle_table_btn"
              onClick={() => setShowTable((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              {showTable ? <BarChart3 size={14} /> : <Table2 size={14} />}
              {showTable ? 'Xem biểu đồ' : 'Xem bảng'}
            </button>
          </div>
          {showTable ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-100">
                    <th className="text-left py-2">Tháng</th>
                    <th className="text-right py-2">Doanh thu</th>
                    <th className="text-right py-2">Thực thu</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stats.months].reverse().map((m) => (
                    <tr key={m.month} className="border-b border-slate-50">
                      <td className="py-1.5 text-slate-600">{m.month.slice(5)}/{m.month.slice(0, 4)}</td>
                      <td className="py-1.5 text-right font-mono text-slate-700">{vnd(m.cost)}</td>
                      <td className="py-1.5 text-right font-mono font-bold text-slate-800">{vnd(m.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <RevenueChart months={stats.months} />
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5">
          <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-rose-500" /> Công nợ cao nhất
          </h3>
          {stats.topDebtors.length === 0 ? (
            <p className="text-xs text-slate-400">Không có bệnh nhân nào còn nợ.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {stats.topDebtors.map(({ record, debt }) => (
                <li key={record.id}>
                  <button
                    onClick={() => onOpenRecord(record)}
                    className="w-full flex items-center justify-between gap-2 py-2 text-left hover:bg-slate-50 rounded-lg px-1 cursor-pointer"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 truncate">{record.name}</span>
                      <span className="block text-[11px] text-slate-400 font-mono">{record.phone}</span>
                    </span>
                    <span className="text-xs font-mono font-bold text-rose-700 whitespace-nowrap">{vnd(debt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5">
        <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-1.5">
          <Stethoscope size={15} className="text-teal-600" /> Theo bác sĩ (tháng này)
        </h3>
        {stats.doctors.length === 0 ? (
          <p className="text-xs text-slate-400">Chưa có lượt điều trị nào trong tháng.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-100">
                  <th className="text-left py-2">Bác sĩ</th>
                  <th className="text-right py-2">Lượt điều trị</th>
                  <th className="text-right py-2">Doanh thu</th>
                  <th className="text-right py-2">Thực thu</th>
                </tr>
              </thead>
              <tbody>
                {stats.doctors.map((d) => (
                  <tr key={d.name} className="border-b border-slate-50">
                    <td className="py-1.5 font-semibold text-slate-700">{d.name}</td>
                    <td className="py-1.5 text-right font-mono text-slate-600">{d.visits}</td>
                    <td className="py-1.5 text-right font-mono text-slate-700">{vnd(d.cost)}</td>
                    <td className="py-1.5 text-right font-mono font-bold text-slate-800">{vnd(d.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5">
        <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-1.5">
          <Tags size={15} className="text-teal-600" /> Doanh thu theo dịch vụ (tháng này)
        </h3>
        <p className="text-[11px] text-slate-400 mb-3">
          {services.length === 0
            ? 'Chưa có bảng giá: vào tab Cài đặt để tạo, các điều trị sẽ được gom theo dịch vụ.'
            : 'Điều trị ghi đúng tên trong bảng giá được gom theo dịch vụ; còn lại xếp vào "Khác".'}
        </p>
        {byService.length === 0 ? (
          <p className="text-xs text-slate-400">Chưa có điều trị nào trong tháng.</p>
        ) : (
          <div className="overflow-x-auto">
            <table id="service_revenue_table" className="min-w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-100">
                  <th className="text-left py-2">Dịch vụ</th>
                  <th className="text-right py-2">Lượt</th>
                  <th className="text-right py-2">Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {byService.map((s) => (
                  <tr key={s.name} className="border-b border-slate-50">
                    <td className="py-1.5 font-semibold text-slate-700">{s.name}</td>
                    <td className="py-1.5 text-right font-mono text-slate-600">{s.count}</td>
                    <td className="py-1.5 text-right font-mono font-bold text-slate-800">{vnd(s.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
