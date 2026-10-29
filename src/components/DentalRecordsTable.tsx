import React, { useState } from 'react';
import { DentalRecord } from '../types';
import { foldVietnamese, patientDebt } from '../utils/stats';
import { 
  Search, 
  Calendar, 
  FilterX, 
  FileEdit, 
  Users, 
  AlertTriangle, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  PhoneCall, 
  MapPin, 
  CalendarPlus,
  Sparkles
} from 'lucide-react';

interface DentalRecordsTableProps {
  records: DentalRecord[];
  onEdit: (record: DentalRecord, index: number) => void;
}

export default function DentalRecordsTable({ records, onEdit }: DentalRecordsTableProps) {
  // Filter variables
  const [searchPhoneOrName, setSearchPhoneOrName] = useState('');
  const [appointmentFilter, setAppointmentFilter] = useState('');
  const [onedayFilter, setOnedayFilter] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [porcelainTeethOnly, setPorcelainTeethOnly] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7;

  // Perform filtration locally
  const filteredRecords = records.filter((rec) => {
    // 1. Text Search (phone or name)
    if (searchPhoneOrName) {
      const query = foldVietnamese(searchPhoneOrName);
      const queryDigits = searchPhoneOrName.replace(/\D/g, '');
      const matchPhone = queryDigits !== '' && (rec.phone || '').replace(/\D/g, '').includes(queryDigits);
      const matchName = foldVietnamese(rec.name || '').includes(query);
      if (!matchPhone && !matchName) return false;
    }

    // 2. Appointment Date Filter
    if (appointmentFilter) {
      if (!rec.appointment || !rec.appointment.includes(appointmentFilter)) {
        return false;
      }
    }

    // 3. One Day Visit Filter
    if (onedayFilter) {
      if (!rec.visitDate || !rec.visitDate.includes(onedayFilter)) {
        return false;
      }
    }

    // 4. Debt Only Filter (whole log: later payment rows cancel earlier debt)
    if (debtOnly && patientDebt(rec) <= 0) return false;

    // 5. Porcelain Teeth ("răng sứ") Filter
    if (porcelainTeethOnly) {
      const hasPorcelain = (rec.plan || []).some((item) => {
        const treatmentVal = (item.treatment || '').toLowerCase();
        return treatmentVal.includes('sứ');
      });
      if (!hasPorcelain) return false;
    }

    return true;
  });

  // Calculate pages
  const totalItems = filteredRecords.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  // Prevent out of bounds on page change
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * itemsPerPage;
  const paginatedRecords = filteredRecords.slice(startIndex, startIndex + itemsPerPage);

  // Page buttons: first, last and two either side of the current page; null marks a gap
  const pageNumbers: (number | null)[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - validCurrentPage) <= 2) {
      pageNumbers.push(p);
    } else if (pageNumbers[pageNumbers.length - 1] !== null) {
      pageNumbers.push(null);
    }
  }

  // Clear all filters
  function handleClearFilters() {
    setSearchPhoneOrName('');
    setAppointmentFilter('');
    setOnedayFilter('');
    setDebtOnly(false);
    setPorcelainTeethOnly(false);
    setCurrentPage(1);
  }

  // Set debt only filter state
  function toggleDebtFilter() {
    setDebtOnly(!debtOnly);
    setCurrentPage(1);
  }

  // Set porcelain teeth filter state
  function togglePorcelainFilter() {
    setPorcelainTeethOnly(!porcelainTeethOnly);
    setCurrentPage(1);
  }

  return (
    <div id="records_ledger" className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden space-y-6">
      
      {/* Search / Filter Section */}
      <div className="p-6 bg-slate-50/70 border-b border-slate-100/80 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-teal-600" />
            <h3 className="font-bold text-slate-800 text-base leading-tight tracking-tight">
              Tìm kiếm & Bộ lọc hồ sơ bệnh án
            </h3>
          </div>
          
          {/* Patients Count Stat Display */}
          <div className="flex items-center gap-1.5 bg-teal-50 px-3 py-1.5 rounded-full border border-teal-100">
            <span className="text-xs font-semibold text-slate-500">Kết quả lọc:</span>
            <span id="texxt" className="text-sm font-black font-mono text-teal-700">
              {filteredRecords.length}
            </span>
            <span className="text-xs text-slate-500">/ {records.length} bệnh nhân</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Substring Search Input */}
          <div className="relative">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Số điện thoại / Tên bệnh nhân
            </label>
            <div className="relative mt-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
                <Search size={14} />
              </span>
              <input
                id="search_phone_name_input"
                type="text"
                value={searchPhoneOrName}
                onChange={(e) => {
                  setSearchPhoneOrName(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Nhập tên hoặc SĐT..."
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 rounded-lg text-xs font-medium placeholder-slate-400"
              />
            </div>
          </div>

          {/* Appointment Date Filter Input */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Kiểm tra lịch hẹn ngày
            </label>
            <div className="relative mt-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
                <Calendar size={14} />
              </span>
              <input
                id="search_appointment_input"
                type="date"
                value={appointmentFilter}
                onChange={(e) => {
                  setAppointmentFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-3 py-1 bg-white border border-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 rounded-lg text-xs font-medium text-slate-700"
              />
            </div>
          </div>

          {/* Patient in Day Input */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Bệnh nhân khám trong ngày
            </label>
            <div className="relative mt-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
                <Clock size={14} />
              </span>
              <input
                id="search_day_input"
                type="date"
                value={onedayFilter}
                onChange={(e) => {
                  setOnedayFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-3 py-1 bg-white border border-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 rounded-lg text-xs font-medium text-slate-700"
              />
            </div>
          </div>

          {/* Quick Filters Group */}
          <div className="flex items-end gap-2">
            <button
              id="filter_debt_toggle_btn"
              onClick={toggleDebtFilter}
              className={`flex-1 py-1 px-1.5 h-[34px] rounded-lg border text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 shrink-0 ${
                debtOnly
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <AlertTriangle size={13} className={debtOnly ? 'text-rose-600 animate-bounce' : 'text-slate-400'} />
              <span>Còn nợ</span>
            </button>

            <button
              id="filter_porcelain_toggle_btn"
              onClick={togglePorcelainFilter}
              className={`flex-1 py-1 px-1.5 h-[34px] rounded-lg border text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 shrink-0 ${
                porcelainTeethOnly
                  ? 'bg-amber-50 border-amber-350 text-amber-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Sparkles size={13} className={porcelainTeethOnly ? 'text-amber-500 animate-pulse' : 'text-slate-400'} />
              <span>Răng sứ</span>
            </button>

            <button
              id="reset_filters_btn"
              onClick={handleClearFilters}
              className="py-1 px-2 h-[34px] rounded-lg border border-slate-200 text-slate-500 bg-white hover:text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-center shrink-0 w-[34px]"
              title="Bỏ tìm kiếm & đặt lại"
            >
              <FilterX size={14} />
            </button>
          </div>

        </div>
      </div>

      {/* Grid Ledger Ledger list */}
      <div className="px-6 pb-2">
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table id="table2" className="min-w-full divide-y divide-slate-100">
            <thead className="bg-[#007bff] text-white">
              <tr>
                <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider w-[60px]">STT</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider">Họ và tên</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider w-[140px]">Số điện thoại</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider">Địa chỉ</th>
                <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider w-[80px]">Tuổi</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider w-[125px]">Ngày khám</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider w-[125px]">Ngày Hẹn</th>
                <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider w-[100px]">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {paginatedRecords.length > 0 ? (
                paginatedRecords.map((record, index) => {
                  const globalIndex = records.findIndex((r) => r.id === record.id);
                  const debt = patientDebt(record);
                  const isDebt = debt > 0;
                  
                  return (
                    <tr key={record.id} className={`hover:bg-slate-50/70 transition-colors ${isDebt ? 'bg-amber-50/15' : ''}`}>
                      <td className="px-4 py-3 text-center text-xs font-semibold text-slate-500 font-mono">
                        {startIndex + index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-800">{record.name}</span>
                          {isDebt && (
                            <span className="inline-flex items-center text-[9px] bg-rose-50 text-rose-600 font-bold px-1.5 py-0.5 rounded border border-rose-100 mt-1 w-max">
                              Còn nợ {(debt * 1000).toLocaleString('vi-VN')} đ
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-600 font-mono">
                        <span className="flex items-center gap-1">
                          <PhoneCall size={11} className="text-slate-400" />
                          {record.phone}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate">
                        <span className="flex items-center gap-1" title={record.address}>
                          <MapPin size={11} className="text-slate-450 shrink-0" />
                          {record.address}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-slate-600 font-semibold font-mono">
                        {record.dob}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                        <span className="flex items-center gap-1">
                          <Calendar size={11} className="text-slate-400" />
                          {record.visitDate}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                        {record.appointment ? (
                          <span className="flex items-center gap-1 text-teal-600 font-medium">
                            <CalendarPlus size={11} className="text-teal-400" />
                            {record.appointment}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          id={`edit_record_idx_${record.id}`}
                          onClick={() => onEdit(record, globalIndex)}
                          className="px-3 py-1.5 bg-teal-50 hover:bg-teal-600 text-teal-700 hover:text-white border border-teal-100 hover:border-teal-600 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1 mx-auto"
                        >
                          <FileEdit size={12} />
                          <span>Sửa</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm font-medium text-slate-400 bg-slate-50/40">
                    Không tìm thấy hồ sơ bệnh nhân nào phù hợp.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Render Pagination controls */}
      {totalPages > 1 && (
        <div id="pagination_controls" className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-500 font-medium">
            Hiển thị <span className="font-bold text-slate-700 font-mono">{startIndex + 1}</span> -{' '}
            <span className="font-bold text-slate-700 font-mono">
              {Math.min(startIndex + itemsPerPage, totalItems)}
            </span>{' '}
            trong số <span className="font-medium text-slate-700 font-mono">{totalItems}</span> bệnh nhân
          </p>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={validCurrentPage === 1}
              className="p-1 px-2.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg text-xs font-semibold text-slate-600 cursor-pointer transition-colors"
            >
              <ChevronLeft size={14} className="inline mr-0.5" /> Trước
            </button>

            {pageNumbers.map((p, idx) =>
              p === null ? (
                <span key={`gap-${idx}`} className="px-1 text-xs text-slate-400">…</span>
              ) : (
              <button
                key={p}
                onClick={() => setCurrentPage(p)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  p === validCurrentPage
                    ? 'bg-teal-600 text-white'
                    : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600'
                }`}
              >
                {p}
              </button>
              )
            )}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={validCurrentPage === totalPages}
              className="p-1 px-2.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg text-xs font-semibold text-slate-600 cursor-pointer transition-colors"
            >
              Sau <ChevronRight size={14} className="inline ml-0.5" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
