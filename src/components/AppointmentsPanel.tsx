import React, { useMemo } from 'react';
import { CalendarCheck, CalendarClock, CalendarX, PhoneCall, FileEdit, CheckCircle2 } from 'lucide-react';
import type { DentalRecord } from '../types';
import { computeAppointments, lastVisit, patientDebt, type AppointmentItem } from '../utils/stats';

interface AppointmentsPanelProps {
  records: DentalRecord[];
  today: string;
  onOpenRecord: (record: DentalRecord) => void;
}

const ddmm = (ymd: string) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '');

function Row({ item, onOpenRecord, showDate }: { item: AppointmentItem; onOpenRecord: AppointmentsPanelProps['onOpenRecord']; showDate: boolean }) {
  const { record } = item;
  const lastPlan = (record.plan || []).filter((p) => p.treatment).slice(-1)[0];
  const debt = patientDebt(record);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-800">{record.name}</span>
          {item.arrived && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">
              <CheckCircle2 size={10} /> Đã đến
            </span>
          )}
          {debt > 0 && (
            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded px-1.5 py-0.5">
              Nợ {(debt * 1000).toLocaleString('vi-VN')} đ
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500">
          {showDate && <span className="font-semibold text-slate-700">Hẹn {ddmm(item.date)} · </span>}
          Lần cuối: {ddmm(lastVisit(record))}
          {lastPlan && <> · {lastPlan.treatment}</>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {record.phone && (
          <a
            href={`tel:${record.phone.replace(/[^\d+]/g, '')}`}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-100 rounded-lg"
          >
            <PhoneCall size={12} /> {record.phone}
          </a>
        )}
        <button
          onClick={() => onOpenRecord(record)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
        >
          <FileEdit size={12} /> Hồ sơ
        </button>
      </div>
    </li>
  );
}

function Section(props: {
  id: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
  items: AppointmentItem[];
  empty: string;
  showDate: boolean;
  onOpenRecord: AppointmentsPanelProps['onOpenRecord'];
}) {
  return (
    <section id={props.id} className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
          {props.icon} {props.title}
        </h3>
        <span className="text-xs font-bold font-mono text-slate-500 bg-slate-50 rounded-full px-2 py-0.5">{props.items.length}</span>
      </div>
      <p className="text-[11px] text-slate-400 mb-2">{props.hint}</p>
      {props.items.length === 0 ? (
        <p className="text-xs text-slate-400 py-3">{props.empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto pr-1">
          {props.items.map((item) => (
            <Row key={item.record.id} item={item} onOpenRecord={props.onOpenRecord} showDate={props.showDate} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AppointmentsPanel({ records, today, onOpenRecord }: AppointmentsPanelProps) {
  const groups = useMemo(() => computeAppointments(records, today), [records, today]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Section
          id="appointments_today"
          icon={<CalendarCheck size={16} className="text-teal-600" />}
          title="Hẹn hôm nay"
          hint="Bệnh nhân chưa đến xếp trước"
          items={groups.today}
          empty="Hôm nay không có lịch hẹn."
          showDate={false}
          onOpenRecord={onOpenRecord}
        />
        <Section
          id="appointments_upcoming"
          icon={<CalendarClock size={16} className="text-sky-600" />}
          title="7 ngày tới"
          hint="Gọi nhắc lịch trước 1 ngày"
          items={groups.upcoming}
          empty="Không có lịch hẹn trong 7 ngày tới."
          showDate
          onOpenRecord={onOpenRecord}
        />
      </div>
      <Section
        id="appointments_missed"
        icon={<CalendarX size={16} className="text-rose-600" />}
        title="Lỡ hẹn"
        hint="Quá ngày hẹn (trong 60 ngày) mà chưa quay lại điều trị"
        items={groups.missed}
        empty="Không có bệnh nhân lỡ hẹn."
        showDate
        onOpenRecord={onOpenRecord}
      />
    </div>
  );
}
