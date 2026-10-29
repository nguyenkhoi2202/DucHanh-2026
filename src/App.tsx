import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, UnauthorizedError } from './api';
import { DentalRecord, DentalRecordInput, PaymentRequest, PlanItem, SessionInfo } from './types';

// Subcomponents
import Login from './components/Login';
import DentalForm from './components/DentalForm';
import DentalRecordsTable from './components/DentalRecordsTable';
import VietQRPopup from './components/VietQRPopup';
import TotalsDialog from './components/TotalsDialog';
import PaymentSuccessDialog from './components/PaymentSuccessDialog';

// Icons
import {
  Heart,
  Phone,
  LogOut,
  Download,
  FolderSync,
  FileText,
  DollarSign,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';

// Records saved by the old version of the app, before the SQLite server existed
const LEGACY_STORAGE_KEY = 'dentalRecords';

function todayStr(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function sumPlans(plans: PlanItem[]) {
  let cost = 0;
  let paid = 0;
  let remaining = 0;
  plans.forEach((plan) => {
    cost += parseFloat(plan.cost as string) || 0;
    paid += parseFloat(plan.paid as string) || 0;
    remaining += parseFloat(plan.remaining as string) || 0;
  });
  return { cost, paid, remaining };
}

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  // 1. Session tracking states
  const [authState, setAuthState] = useState<'checking' | 'out' | 'in'>('checking');
  const [session, setSession] = useState<SessionInfo | null>(null);

  // 2. Core dental record states
  const [records, setRecords] = useState<DentalRecord[]>([]);
  const [activeRecord, setActiveRecord] = useState<DentalRecord | null>(null);
  // Bumped after each save so the form remounts empty (prevents duplicate saves)
  const [formKey, setFormKey] = useState(0);
  const [isLive, setIsLive] = useState(false);

  // 3. Real-time dynamic clock tracking State
  const [clockStr, setClockStr] = useState('');

  // 4. Loading indicator overlay state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Đang xử lý...');

  // 5. QR payment popup state
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [qrPatientName, setQrPatientName] = useState('');
  const [paidPayment, setPaidPayment] = useState<PaymentRequest | null>(null);

  // 6. Totals analytical dialog state
  const [isTotalsOpen, setIsTotalsOpen] = useState(false);
  const [totalsTitle, setTotalsTitle] = useState('');
  const [totalsSum, setTotalsSum] = useState({ cost: 0, paid: 0, remaining: 0 });
  const [totalsCount, setTotalsCount] = useState<number | undefined>(undefined);

  // Reference hooks for triggering file inputs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputThangRef = useRef<HTMLInputElement>(null);

  const handleApiError = useCallback((err: unknown, message: string) => {
    if (err instanceof UnauthorizedError) {
      setAuthState('out');
      return;
    }
    console.error(message, err);
    alert(`${message}: ${(err as Error).message}`);
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      setRecords(await api.listRecords());
    } catch (err) {
      handleApiError(err, 'Không tải được dữ liệu');
    }
  }, [handleApiError]);

  // ==========================================
  // EFFECT 1: Check whether the server session is still valid
  // ==========================================
  useEffect(() => {
    api
      .me()
      .then((info) => {
        setSession(info);
        setAuthState('in');
      })
      .catch(() => setAuthState('out'));
  }, []);

  // ==========================================
  // EFFECT 2: Load records and stay in sync with every other open device
  // ==========================================
  useEffect(() => {
    if (authState !== 'in') return;

    loadRecords().then(() => offerLegacyMigration());

    const events = new EventSource('/api/events');
    events.onopen = () => {
      setIsLive(true);
      loadRecords(); // catch up on anything missed while disconnected
    };
    events.onerror = () => setIsLive(false);
    events.addEventListener('records', () => loadRecords());
    // Shown on every open device, even if the QR popup was already closed
    events.addEventListener('payment', (e) => handlePaid(JSON.parse((e as MessageEvent).data)));
    return () => events.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, loadRecords]);

  // ==========================================
  // EFFECT 3: Live Clock Update (Runs every second)
  // ==========================================
  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const [yyyy, mm, dd] = todayStr(now).split('-');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      setClockStr(`${dd}-${mm}-${yyyy} ${hours}:${minutes}:${seconds}`);
    }

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // One-time move of data that the old version kept in this browser's localStorage
  async function offerLegacyMigration() {
    let legacy: unknown;
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
    } catch {
      return;
    }
    if (!Array.isArray(legacy) || legacy.length === 0) return;

    const ok = window.confirm(
      `Trình duyệt này còn ${legacy.length} hồ sơ từ phiên bản cũ. Chuyển chúng vào cơ sở dữ liệu mới?\n` +
        '(Hồ sơ trùng mã sẽ được cập nhật, không bị nhân đôi.)'
    );
    if (!ok) return;

    try {
      const res = await api.importRecords(legacy);
      // Keep a copy under another key instead of deleting, just in case
      localStorage.setItem(`${LEGACY_STORAGE_KEY}_migrated`, localStorage.getItem(LEGACY_STORAGE_KEY)!);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      alert(`Đã chuyển ${res.imported} hồ sơ. Tổng số hồ sơ hiện có: ${res.total}.`);
      loadRecords();
    } catch (err) {
      handleApiError(err, 'Chuyển dữ liệu cũ thất bại');
    }
  }

  // ==========================================
  // SESSION CONTROL FUNCTIONS
  // ==========================================
  async function handleLoginSuccess() {
    try {
      setSession(await api.me());
      setAuthState('in');
    } catch (err) {
      handleApiError(err, 'Không lấy được cấu hình');
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    setRecords([]);
    setActiveRecord(null);
    setSession(null);
    setAuthState('out');
  }

  // ==========================================
  // RECORD CRUD OPERATIONS
  // ==========================================
  async function handleSaveRecord(formData: DentalRecordInput) {
    try {
      if (activeRecord) {
        await api.updateRecord(activeRecord.id, formData);
      } else {
        await api.createRecord(formData);
      }
      alert(`Lưu dữ liệu với tên ${formData.name} thành công`);
      setActiveRecord(null);
      setFormKey((k) => k + 1);
      loadRecords();
    } catch (err) {
      handleApiError(err, 'Lưu hồ sơ thất bại');
    }
  }

  function handleEditRecord(record: DentalRecord) {
    setActiveRecord(record);
    // Smooth scroll to form element
    document.getElementById('dentalForm')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleDeleteActiveRecord() {
    if (!activeRecord) return;
    const confirmDelete = window.confirm(`Bạn có chắc chắn muốn xóa hồ sơ của ${activeRecord.name}?`);
    if (!confirmDelete) return;

    try {
      await api.deleteRecord(activeRecord.id);
      setActiveRecord(null);
      setFormKey((k) => k + 1);
      loadRecords();
    } catch (err) {
      handleApiError(err, 'Xóa hồ sơ thất bại');
    }
  }

  function handleCancelEdit() {
    setActiveRecord(null);
    setFormKey((k) => k + 1);
  }

  // ==========================================
  // EXPORTS & BACKUP FILE HELPERS
  // ==========================================
  // 1. "Kết sổ cuối tháng" - records visited or treated this month
  function handleDownloadCurrentMonth() {
    const confirmation = window.confirm('Bạn có chắc chắn muốn lưu dữ liệu đầu tháng đến hiện tại?');
    if (!confirmation) return;

    const monthPrefix = todayStr().slice(0, 7); // YYYY-MM
    const currentMonthRecords = records.filter(
      (rec) =>
        rec.visitDate?.startsWith(monthPrefix) || (rec.plan || []).some((p) => p.date?.startsWith(monthPrefix))
    );

    if (currentMonthRecords.length > 0) {
      downloadJSON(currentMonthRecords, `DucHanh-${todayStr()}.json`);
    } else {
      alert('Không có dữ liệu điều trị trong tháng hiện tại.');
    }
  }

  // 2. Full backup (no longer clears data: the database is the source of truth)
  function handleDownloadFullBackup() {
    downloadJSON(records, `DucHanh-backup-${todayStr()}.json`);
  }

  // 3. "Khôi phục từ file backup" - import a backup file into the database
  function handleTriggerLocalFileUpload() {
    fileInputRef.current?.click();
  }

  async function readJSONFile(file: File): Promise<unknown> {
    return JSON.parse(await file.text());
  }

  async function handleLocalFileUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // Reset file input selection
    if (!file) return;

    try {
      const dataParsed = await readJSONFile(file);
      if (!Array.isArray(dataParsed)) {
        alert('Định dạng dữ liệu backup file không hợp lệ! Vui lòng chọn đúng file.');
        return;
      }
      const ok = window.confirm(
        `Nhập ${dataParsed.length} hồ sơ từ file "${file.name}"?\nHồ sơ trùng mã sẽ được ghi đè bằng dữ liệu trong file.`
      );
      if (!ok) return;

      setIsLoading(true);
      setLoadingText('Đang nhập dữ liệu vào cơ sở dữ liệu...');
      const res = await api.importRecords(dataParsed);
      alert(`Đã nhập ${res.imported} hồ sơ. Tổng số hồ sơ hiện có: ${res.total}.`);
      loadRecords();
    } catch (err) {
      handleApiError(err, 'Có lỗi xảy ra khi nhập dữ liệu file');
    } finally {
      setIsLoading(false);
    }
  }

  // 4. "Thống kê Doanh thu Theo tháng" - Import a monthly backup and summarize totals
  function handleTriggerThongKeFileThang() {
    fileInputThangRef.current?.click();
  }

  async function handleThongKeFileThangChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // Clear file input
    if (!file) return;

    try {
      const datasParsed = (await readJSONFile(file)) as DentalRecord[];
      if (!Array.isArray(datasParsed)) {
        alert('Nội dung file không hợp lệ!');
        return;
      }

      setTotalsTitle(`Báo cáo Doanh thu từ File: ${file.name}`);
      setTotalsSum(sumPlans(datasParsed.flatMap((d) => d.plan || [])));
      setTotalsCount(datasParsed.length);
      setIsTotalsOpen(true);
    } catch (err) {
      console.error('Summarize error', err);
      alert('Hệ thống không thể phân tích và tính toán file thống kê!');
    }
  }

  // 5. "Thống kê Doanh thu hiện tại" - sum treatment rows dated this month
  function handleShowCurrentMonthRevenue() {
    const today = todayStr();
    const monthPrefix = today.slice(0, 7);
    const activePlans = records.flatMap((rec) =>
      (rec.plan || []).filter((p) => p.date?.startsWith(monthPrefix) && p.date <= today)
    );

    const [yyyy, mm] = monthPrefix.split('-');
    setTotalsTitle(`Báo cáo Doanh thu Tháng ${Number(mm)}/${yyyy}`);
    setTotalsSum(sumPlans(activePlans));
    setTotalsCount(undefined);
    setIsTotalsOpen(true);
  }

  // ==========================================
  // QR PAYMENT FLOW (SePay)
  // ==========================================
  async function handleGenerateQR(amount: number, patientName: string) {
    if (!amount || amount < 1000) {
      alert('Số tiền thanh toán phải từ 1.000 VND trở lên.');
      return;
    }

    try {
      const request = await api.createPaymentRequest(amount, activeRecord?.id ?? null);
      setQrPatientName(patientName);
      setPaymentRequest(request);
    } catch (err) {
      handleApiError(err, 'Không tạo được mã QR');
    }
  }

  // The QR popup gives way to the success screen once the bank confirms
  const handlePaid = useCallback((paid: PaymentRequest) => {
    setPaymentRequest((current) => (current && current.id === paid.id ? null : current));
    setPaidPayment((current) => (current && current.id === paid.id ? current : paid));
  }, []);

  const clinic = session?.clinic;

  useEffect(() => {
    document.title = clinic ? `${clinic.name} | Quản Lý Hồ Sơ Bệnh Nhân` : 'Quản Lý Hồ Sơ Nha Khoa';
  }, [clinic]);

  // Main Authentication Guardian
  if (authState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#b3cbcf]">
        <span className="inline-block w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (authState === 'out') {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div id="application_viewport" className="min-h-screen bg-[#b3cbcf] text-slate-800 font-sans selection:bg-teal-500 selection:text-white flex flex-col justify-between">

      {/* Hidden Files Import Elements */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleLocalFileUploadChange}
        className="hidden"
        accept=".json,.txt"
      />
      <input
        type="file"
        ref={fileInputThangRef}
        onChange={handleThongKeFileThangChange}
        className="hidden"
        accept=".json,.txt"
      />

      {/* Modern, Highly Polished Top Bar Header */}
      <header className="bg-gradient-to-r from-sky-100 to-indigo-100 border-b border-sky-200/60 shadow-xs px-4 py-3 pb-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-[#007bffd4] text-white rounded-2xl shadow-md transform hover:rotate-6 transition-transform">
              <Heart className="w-8 h-8 fill-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl md:text-3xl font-black text-slate-800 tracking-tight leading-none mb-1">
                {clinic?.name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
                {clinic?.hotlines.map((h) => (
                  <span key={h.phone} className="flex items-center gap-1">
                    <Phone size={12} className="text-[#007bff]" /> Hot-line:{' '}
                    <span className="text-slate-700 font-bold">{h.phone} ({h.label})</span>
                  </span>
                ))}
                <span className="text-slate-400">Đăng nhập: {session?.username}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4.5 bg-white/75 backdrop-blur-xs p-2 px-4 rounded-xl border border-sky-100/90 shadow-inner w-full md:w-auto justify-between md:justify-end">
            <span
              id="sync_status"
              className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${
                isLive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
              title={isLive ? 'Dữ liệu tự cập nhật giữa các máy' : 'Mất kết nối máy chủ, đang thử lại...'}
            >
              {isLive ? <Wifi size={12} /> : <WifiOff size={12} />}
              {isLive ? 'Đã đồng bộ' : 'Mất kết nối'}
            </span>
            <div className="flex flex-col text-right">
              <span id="clock" className="text-base md:text-lg font-black text-[#007bff] font-mono leading-none mb-1">
                {clockStr || 'Đang tải giờ...'}
              </span>
              <span className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase">Giờ hệ thống thực tế</span>
            </div>
            <button
              id="logout_btn"
              onClick={handleLogout}
              className="p-2 bg-rose-50 hover:bg-rose-500 text-rose-600 hover:text-white rounded-lg transition-all cursor-pointer"
              title="Đăng xuất"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Scaffold Operations Body */}
      <main className="max-w-7xl mx-auto w-full px-4 py-6 space-y-6 flex-1">

        {/* Quick Operations toolbar */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-100 p-4 flex flex-wrap items-center gap-2">
          <button
            id="add_new_patient_direct_btn"
            onClick={() => {
              handleCancelEdit();
              document.getElementById('dentalForm')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="px-4.5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs hover:shadow-md transition-all cursor-pointer flex items-center gap-1.5"
          >
            <FileText size={15} />
            <span>Thêm bệnh nhân mới</span>
          </button>

          <button
            id="analytics_now_btn"
            onClick={handleShowCurrentMonthRevenue}
            className="px-4 py-2.5 bg-teal-50 hover:bg-teal-100 border border-teal-200/50 text-teal-700 font-semibold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
          >
            <TrendingUp size={14} />
            <span>Thống kê doanh thu tháng này</span>
          </button>

          <button
            id="analytics_month_file_btn"
            onClick={handleTriggerThongKeFileThang}
            className="px-4 py-2.5 bg-teal-50 hover:bg-teal-100 border border-teal-200/50 text-teal-700 font-semibold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
          >
            <DollarSign size={14} />
            <span>Thống kê doanh thu theo file</span>
          </button>
        </div>

        {/* Dynamic Patient Info Details / Add Form */}
        <section id="dentalForm">
          <DentalForm
            key={activeRecord ? `edit-${activeRecord.id}` : `new-${formKey}`}
            activeRecord={activeRecord}
            onSubmit={handleSaveRecord}
            onDelete={handleDeleteActiveRecord}
            onCancel={handleCancelEdit}
            onGenerateQR={session?.bank ? handleGenerateQR : undefined}
          />
        </section>

        {/* Main Dental Records Index */}
        <section>
          <DentalRecordsTable records={records} onEdit={handleEditRecord} />
        </section>

        {/* Data Maintenance section inside page footer of elements */}
        <section className="bg-slate-100/70 rounded-2xl p-6 border border-slate-200/50 space-y-4">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <FolderSync size={15} /> Sao lưu & khôi phục dữ liệu
          </h4>
          <div className="flex flex-wrap items-center gap-3">
            <button
              id="db_close_month_btn"
              onClick={handleDownloadCurrentMonth}
              className="py-2.5 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Download size={13} />
              <span>Kết sổ tháng này (.json)</span>
            </button>

            <button
              id="db_download_full_btn"
              onClick={handleDownloadFullBackup}
              className="py-2.5 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Download size={13} />
              <span>Tải backup toàn bộ (.json)</span>
            </button>

            <button
              id="db_load_file_btn"
              onClick={handleTriggerLocalFileUpload}
              className="py-2.5 px-4 bg-sky-50 hover:bg-sky-100 border border-sky-200/50 text-sky-700 font-semibold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <FileText size={13} />
              <span>Nhập dữ liệu từ file backup</span>
            </button>
          </div>
        </section>

      </main>

      {/* Clean high contrast Copyright Footer */}
      <footer className="bg-slate-900 text-slate-400 py-6 mt-12 text-center text-xs">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p>© Copyright 2026 {clinic?.name}. Bản quyền thuộc về KhoiTN.</p>
          <div className="flex items-center gap-3 text-slate-500">
            <span>Thiết kế đáp ứng bởi KhoiTN</span>
            <span>•</span>
            <a href="https://facebook.com/nguyenkhoi2202" target="_blank" rel="noreferrer" className="text-teal-400 hover:underline">
              KhoiTN Profile
            </a>
          </div>
        </div>
      </footer>

      {/* ==========================================
          MODAL 1: Loading Overlay Screen Spinner
          ========================================== */}
      {isLoading && (
        <div id="loading_overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white p-6 rounded-2xl shadow-2xl border border-slate-100 text-center max-w-xs w-full space-y-4 animate-scale-up">
            <span className="inline-block w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold text-slate-700">{loadingText}</p>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL 2: Analytical Sum Finance Dialog
          ========================================== */}
      <TotalsDialog
        isOpen={isTotalsOpen}
        onClose={() => setIsTotalsOpen(false)}
        title={totalsTitle}
        totalCost={totalsSum.cost}
        totalPaid={totalsSum.paid}
        totalRemaining={totalsSum.remaining}
        recordCount={totalsCount}
      />

      {/* ==========================================
          MODAL 3: QR Payment Popup
          ========================================== */}
      <VietQRPopup
        request={paymentRequest}
        config={session?.bank ?? null}
        patientName={qrPatientName}
        onClose={() => setPaymentRequest(null)}
        onPaid={handlePaid}
      />

      {/* ==========================================
          MODAL 4: Payment received (SePay webhook)
          ========================================== */}
      <PaymentSuccessDialog payment={paidPayment} onClose={() => setPaidPayment(null)} />

    </div>
  );
}
