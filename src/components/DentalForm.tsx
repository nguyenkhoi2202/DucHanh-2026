import React, { useState, useEffect } from 'react';
import { DentalRecord, PlanItem } from '../types';
import { Plus, Trash2, Save, FilePlus, User, Phone, Calendar, MapPin, Hash, QrCode } from 'lucide-react';

interface DentalFormProps {
  activeRecord: DentalRecord | null;
  onSubmit: (data: {
    name: string;
    phone: string;
    address: string;
    dob: string;
    visitDate: string;
    appointment: string;
    plan: PlanItem[];
  }) => void;
  onDelete: () => void;
  onCancel: () => void;
  onGenerateQR: (amount: number, patientName: string) => void;
}

export default function DentalForm({
  activeRecord,
  onSubmit,
  onDelete,
  onCancel,
  onGenerateQR,
}: DentalFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [dob, setDob] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [appointment, setAppointment] = useState('');
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [qrMode, setQrMode] = useState<'remaining' | 'custom'>('remaining');
  const [qrCustomAmount, setQrCustomAmount] = useState('');

  // Default values for today (local date; toISOString() would give the UTC date)
  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Sync state with activeRecord (or defaults for new record)
  useEffect(() => {
    if (activeRecord) {
      setName(activeRecord.name);
      setPhone(activeRecord.phone);
      setAddress(activeRecord.address);
      setDob(activeRecord.dob);
      setVisitDate(activeRecord.visitDate);
      setAppointment(activeRecord.appointment);
      setPlan(activeRecord.plan || []);
    } else {
      setName('');
      setPhone('');
      setAddress('');
      setDob('');
      setVisitDate(getTodayStr());
      setAppointment(getTodayStr());
      setPlan([
        {
          date: getTodayStr(),
          tooth: '',
          treatment: '',
          cost: '',
          paid: '',
          remaining: '0',
          doctor: 'My',
        },
      ]);
    }
  }, [activeRecord]);

  // Handler to add a treatment plan row
  function addRow() {
    const today = getTodayStr();
    setPlan((prevPlan) => [
      ...prevPlan,
      {
        date: today,
        tooth: '',
        treatment: '',
        cost: '',
        paid: '',
        remaining: '0',
        doctor: 'My',
      },
    ]);
  }

  // Update a specific field in a treatment plan row
  function handlePlanChange(index: number, field: keyof PlanItem, value: string) {
    setPlan((prevPlan) => {
      const updated = prevPlan.map((item, idx) => {
        if (idx !== index) return item;

        const updatedItem = { ...item, [field]: value };

        // Auto calculate remaining when cost or paid changes
        if (field === 'cost' || field === 'paid') {
          const cost = parseFloat((field === 'cost' ? value : item.cost) as string) || 0;
          const paid = parseFloat((field === 'paid' ? value : item.paid) as string) || 0;
          updatedItem.remaining = (cost - paid).toString();
        }

        return updatedItem;
      });
      return updated;
    });
  }

  // Remove a plan row locally if there is more than 1
  function removeRowAt(index: number) {
    if (plan.length <= 1) return;
    setPlan((prevPlan) => prevPlan.filter((_, idx) => idx !== index));
  }

  // Calculate overall totals inside the form
  const totalCost = plan.reduce((sum, item) => sum + (parseFloat(item.cost as string) || 0), 0);
  const totalPaid = plan.reduce((sum, item) => sum + (parseFloat(item.paid as string) || 0), 0);
  const totalRemaining = totalCost - totalPaid;

  // Amounts in the form are in thousands of VND; the QR needs the full amount
  const qrAmountK = qrMode === 'remaining' ? totalRemaining : parseInt(qrCustomAmount, 10) || 0;
  const qrAmount = qrAmountK * 1000;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      dob: dob.trim(),
      visitDate,
      appointment,
      plan,
    });
  }

  return (
    <div id="dental_form_card" className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden mb-6 p-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
        <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
          {activeRecord ? (
            <span className="inline-block py-1 px-3 bg-teal-50 text-teal-700 text-xs rounded-full font-bold"> ĐANG SỬA </span>
          ) : (
            <span className="inline-block py-1 px-3 bg-emerald-50 text-emerald-700 text-xs rounded-full font-bold"> THÊM MỚI </span>
          )}
          Thông Tin Bệnh Nhân & Nhật Ký Điều Trị
        </h3>
        {activeRecord && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-800 font-semibold underline cursor-pointer"
          >
            Hủy sửa, tạo bản ghi mới
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core Info Input Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100/80">
          <div className="col-span-1 lg:col-span-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <User size={13} className="text-teal-500" /> Họ và tên:
            </label>
            <input
              id="patient_name_input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nguyễn Văn A"
              required
              className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Phone size={13} className="text-teal-500" /> Số điện thoại:
            </label>
            <input
              id="patient_phone_input"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09xx xxx xxx"
              required
              className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Hash size={13} className="text-teal-500" /> Tuổi:
            </label>
            <input
              id="patient_dob_input"
              type="text"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              placeholder="32"
              required
              className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Calendar size={13} className="text-teal-500" /> Ngày khám:
            </label>
            <input
              id="patient_visit_date_input"
              type="date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
              required
              className="w-full bg-white border border-slate-200 rounded-lg py-1.5 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="col-span-1">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Calendar size={13} className="text-teal-500" /> Ngày hẹn tiếp:
            </label>
            <input
              id="patient_appointment_input"
              type="date"
              value={appointment}
              onChange={(e) => setAppointment(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg py-1.5 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="col-span-1 md:col-span-2 lg:col-span-6">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <MapPin size={13} className="text-teal-500" /> Địa chỉ:
            </label>
            <input
              id="patient_address_input"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Số nhà, Đường, Xã/Phường, Huyện/Thành phố"
              required
              className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        {/* Treatment Log Editable Subtable */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
              Nhật ký điều trị & Thống kê chi phí
            </h4>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-[#ADD3F8]/35">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider w-[140px]">Ngày</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider w-[100px]">Răng</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Công tác điều trị</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider w-[130px]">Chi phí (k)</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider w-[130px]">Đã Trả (k)</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider w-[130px]">Còn lại (k)</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 uppercase tracking-wider w-[80px]">Bác sĩ</th>
                  <th className="px-3 py-2.5 text-center text-xs font-bold text-slate-700 uppercase tracking-wider w-[50px]">Xóa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {plan.map((item, index) => (
                  <tr key={index} className="hover:bg-slate-50/55 transition-colors">
                    <td className="px-2 py-2">
                      <input
                        type="date"
                        value={item.date}
                        onChange={(e) => handlePlanChange(index, 'date', e.target.value)}
                        className="w-full bg-slate-50 focus:bg-white border border-slate-200 focus:ring-1 focus:ring-teal-500 focus:outline-none rounded-md px-2 py-1 text-xs text-slate-700"
                        required
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={item.tooth}
                        onChange={(e) => handlePlanChange(index, 'tooth', e.target.value)}
                        placeholder="R36, R46"
                        className="w-full bg-slate-50 focus:bg-white border border-slate-200 focus:ring-1 focus:ring-teal-500 focus:outline-none rounded-md px-2 py-1 text-xs text-slate-700"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={item.treatment}
                        onChange={(e) => handlePlanChange(index, 'treatment', e.target.value)}
                        placeholder="Nhổ răng, hàn răng, trám răng..."
                        className="w-full bg-slate-50 focus:bg-white border border-slate-200 focus:ring-1 focus:ring-teal-500 focus:outline-none rounded-md px-2.5 py-1 text-xs text-slate-700"
                        required
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={item.cost}
                        onChange={(e) => handlePlanChange(index, 'cost', e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-50 focus:bg-white border border-slate-200 focus:ring-1 focus:ring-teal-500 focus:outline-none rounded-md px-2 py-1 text-xs text-slate-700 font-mono"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={item.paid}
                        onChange={(e) => handlePlanChange(index, 'paid', e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-50 focus:bg-white border border-slate-200 focus:ring-1 focus:ring-teal-500 focus:outline-none rounded-md px-2 py-1 text-xs text-slate-700 font-mono"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={item.remaining}
                        readOnly
                        placeholder="0"
                        className="w-full bg-slate-100 font-bold border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-600 font-mono focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={item.doctor}
                        onChange={(e) => handlePlanChange(index, 'doctor', e.target.value)}
                        className="w-full bg-slate-50 focus:bg-white border border-slate-200 focus:ring-1 focus:ring-teal-500 focus:outline-none rounded-md px-2 py-1 text-xs text-slate-700 text-center"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeRowAt(index)}
                        disabled={plan.length <= 1}
                        className="text-stone-300 hover:text-red-500 disabled:opacity-30 p-1 rounded-md transition-colors cursor-pointer"
                        title="Xóa dòng"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Total Summary Row inside Table footer */}
                <tr className="bg-sky-50/40 font-bold text-slate-800">
                  <td colSpan={3} className="px-3 py-3 text-right text-xs font-semibold tracking-wider text-slate-600 uppercase">
                    Cộng cộng:
                  </td>
                  <td className="px-2 py-2 text-xs font-mono font-bold bg-[#dff9fb]">
                    {totalCost.toLocaleString('vi-VN')}
                  </td>
                  <td className="px-2 py-2 text-xs font-mono font-bold bg-[#dff9fb]">
                    {totalPaid.toLocaleString('vi-VN')}
                  </td>
                  <td className="px-2 py-2 text-xs font-mono font-bold bg-[#dff9fb] text-rose-600">
                    {totalRemaining.toLocaleString('vi-VN')}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2">
            <button
              id="add_treatment_row_btn"
              type="button"
              onClick={addRow}
              className="px-4 py-2 bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold text-xs rounded-lg border border-teal-200/50 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span>Thêm dòng điều trị</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* QR payment: total outstanding debt, or a custom amount */}
            <div className="flex flex-wrap items-center gap-1.5 bg-teal-50/50 p-1.5 px-2.5 rounded-lg border border-teal-100">
              <span className="text-[11px] font-bold text-teal-700 whitespace-nowrap">Thu tiền QR:</span>
              <div className="flex rounded-md border border-teal-200 overflow-hidden text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setQrMode('remaining')}
                  className={`px-2 py-1 cursor-pointer ${qrMode === 'remaining' ? 'bg-teal-600 text-white' : 'bg-white text-teal-700'}`}
                >
                  Còn nợ
                </button>
                <button
                  type="button"
                  onClick={() => setQrMode('custom')}
                  className={`px-2 py-1 cursor-pointer ${qrMode === 'custom' ? 'bg-teal-600 text-white' : 'bg-white text-teal-700'}`}
                >
                  Tự nhập
                </button>
              </div>
              {qrMode === 'remaining' ? (
                <span className="w-32 text-right text-xs font-mono font-bold text-slate-700">
                  {qrAmount.toLocaleString('vi-VN')} đ
                </span>
              ) : (
                <>
                  <input
                    id="money_qr_input"
                    type="text"
                    inputMode="numeric"
                    placeholder="Số k (vd: 50)"
                    value={qrCustomAmount}
                    onChange={(e) => setQrCustomAmount(e.target.value.replace(/\D/g, ''))}
                    className="w-20 bg-white border border-teal-200 rounded-md py-1 px-1.5 text-xs text-right text-slate-700 font-mono focus:outline-none"
                  />
                  <span className="text-[10px] font-mono text-teal-600">k = {qrAmount.toLocaleString('vi-VN')} đ</span>
                </>
              )}
              <button
                id="form_qr_generation_btn"
                type="button"
                onClick={() => onGenerateQR(qrAmount, name.trim())}
                disabled={qrAmount < 1000}
                className="p-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors cursor-pointer"
                title="Tạo mã QR thanh toán"
              >
                <QrCode size={14} />
              </button>
            </div>

            {activeRecord && (
              <button
                id="delete_record_btn"
                type="button"
                onClick={onDelete}
                className="px-4.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-sm rounded-lg border border-rose-200/50 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Trash2 size={16} />
                <span>Xóa bệnh nhân</span>
              </button>
            )}

            <button
              id="submit_record_btn"
              type="submit"
              className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm rounded-lg shadow-md hover:shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Save size={16} />
              <span>Lưu hồ sơ</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
