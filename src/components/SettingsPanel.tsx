import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Save, Search, Sparkles, Eye, EyeOff, Tags } from 'lucide-react';
import { api } from '../api';
import type { DentalRecord, ServiceItem } from '../types';
import { foldVietnamese, suggestServices } from '../utils/stats';

interface SettingsPanelProps {
  services: ServiceItem[];
  records: DentalRecord[];
  onChanged: () => void; // reload the price list
  onError: (err: unknown, message: string) => void;
}

const vnd = (k: number) => `${Math.round(k * 1000).toLocaleString('vi-VN')} đ`;
const digitsOnly = (v: string) => v.replace(/\D/g, '');

function ServiceRow({ service, onChanged, onError }: { service: ServiceItem } & Pick<SettingsPanelProps, 'onChanged' | 'onError'>) {
  const [name, setName] = useState(service.name);
  const [price, setPrice] = useState(String(service.price));
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== service.name || Number(price || 0) !== service.price;

  // Another device changed this service: take the new values unless the user is mid-edit here
  const lastServer = useRef({ name: service.name, price: service.price });
  useEffect(() => {
    const prev = lastServer.current;
    const untouched = name.trim() === prev.name && Number(price || 0) === prev.price;
    if (untouched) {
      setName(service.name);
      setPrice(String(service.price));
    }
    lastServer.current = { name: service.name, price: service.price };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.name, service.price]);

  async function save(patch: Partial<ServiceItem> = {}) {
    setBusy(true);
    try {
      await api.updateService(service.id, { name: name.trim(), price: Number(price || 0), active: service.active, ...patch });
      onChanged();
    } catch (err) {
      onError(err, 'Không lưu được dịch vụ');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Xóa dịch vụ "${service.name}" khỏi bảng giá?\n(Các hồ sơ đã ghi dịch vụ này không bị ảnh hưởng.)`)) return;
    try {
      await api.deleteService(service.id);
      onChanged();
    } catch (err) {
      onError(err, 'Không xóa được dịch vụ');
    }
  }

  return (
    <tr className={service.active ? '' : 'opacity-50'}>
      <td className="py-1.5 pr-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && dirty && save()}
          className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </td>
      <td className="py-1.5 pr-2">
        <div className="flex items-center gap-1">
          <input
            value={price}
            inputMode="numeric"
            onChange={(e) => setPrice(digitsOnly(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && dirty && save()}
            className="w-24 bg-white border border-slate-200 rounded-md px-2 py-1 text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <span className="text-[11px] text-slate-400 whitespace-nowrap">k = {vnd(Number(price || 0))}</span>
        </div>
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        {dirty && (
          <button onClick={() => save()} disabled={busy} className="p-1.5 text-teal-700 hover:bg-teal-50 rounded-md cursor-pointer" title="Lưu thay đổi">
            <Save size={15} />
          </button>
        )}
        <button
          onClick={() => save({ name: service.name, price: service.price, active: !service.active })}
          disabled={busy}
          className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md cursor-pointer"
          title={service.active ? 'Ẩn khỏi gợi ý khi nhập điều trị' : 'Hiện lại trong gợi ý'}
        >
          {service.active ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button onClick={remove} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer" title="Xóa dịch vụ">
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  );
}

export default function SettingsPanel({ services, records, onChanged, onError }: SettingsPanelProps) {
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Record<string, number>>({}); // suggestion name -> price (k)

  const suggestions = useMemo(() => suggestServices(records, services), [records, services]);
  const visible = services.filter((s) => foldVietnamese(s.name).includes(foldVietnamese(query)));

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createServices([{ name: newName.trim(), price: Number(newPrice || 0), active: true }]);
      setNewName('');
      setNewPrice('');
      onChanged();
    } catch (err) {
      onError(err, 'Không thêm được dịch vụ');
    }
  }

  async function addPicked() {
    const items = Object.entries(picked).map(([name, price]) => ({ name, price, active: true }));
    try {
      await api.createServices(items);
      setPicked({});
      onChanged();
    } catch (err) {
      onError(err, 'Không thêm được dịch vụ');
    }
  }

  return (
    <div id="settings" className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <section className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 shadow-xs p-5 space-y-4">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
            <Tags size={16} className="text-teal-600" /> Bảng giá dịch vụ
          </h3>
          <p className="text-[11px] text-slate-400">
            Giá tính theo nghìn đồng (k). Khi nhập điều trị, chọn dịch vụ sẽ tự điền chi phí. Sửa hoặc xóa ở đây không làm thay đổi hồ sơ cũ.
          </p>
        </div>

        <form onSubmit={addService} className="flex flex-wrap items-center gap-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
          <input
            id="new_service_name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tên dịch vụ (vd: Bọc sứ Zirconia)"
            required
            className="flex-1 min-w-[200px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <input
            id="new_service_price"
            value={newPrice}
            onChange={(e) => setNewPrice(digitsOnly(e.target.value))}
            inputMode="numeric"
            placeholder="Giá (k)"
            className="w-28 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            id="add_service_btn"
            type="submit"
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-lg flex items-center gap-1 cursor-pointer"
          >
            <Plus size={15} /> Thêm
          </button>
        </form>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Tìm trong ${services.length} dịch vụ...`}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        {services.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            Chưa có dịch vụ nào. Thêm ở trên, hoặc chọn nhanh từ phần gợi ý bên cạnh.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table id="services_table" className="min-w-full">
              <thead className="sticky top-0 bg-white">
                <tr className="text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="text-left py-2">Dịch vụ</th>
                  <th className="text-left py-2">Giá</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visible.map((s) => (
                  <ServiceRow key={s.id} service={s} onChanged={onChanged} onError={onError} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-xs p-5 space-y-3">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
            <Sparkles size={16} className="text-amber-500" /> Gợi ý từ lịch sử điều trị
          </h3>
          <p className="text-[11px] text-slate-400">
            Các điều trị được ghi nhiều lần nhưng chưa có trong bảng giá, kèm mức giá hay dùng nhất. Chọn rồi bấm thêm; có thể sửa giá trước.
          </p>
        </div>
        {suggestions.length === 0 ? (
          <p className="text-xs text-slate-400 py-4">Không còn gợi ý nào.</p>
        ) : (
          <>
            <ul id="service_suggestions" className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto pr-1">
              {suggestions.map((s) => {
                const checked = s.name in picked;
                return (
                  <li key={s.name} className="flex items-center gap-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = { ...prev };
                          if (checked) delete next[s.name];
                          else next[s.name] = s.price;
                          return next;
                        })
                      }
                      className="accent-teal-600 cursor-pointer"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-800 truncate" title={s.name}>{s.name}</span>
                      <span className="block text-[10px] text-slate-400">{s.count} lần</span>
                    </span>
                    {checked ? (
                      <input
                        value={String(picked[s.name])}
                        inputMode="numeric"
                        onChange={(e) => setPicked((prev) => ({ ...prev, [s.name]: Number(digitsOnly(e.target.value) || 0) }))}
                        className="w-20 bg-white border border-teal-200 rounded-md px-1.5 py-0.5 text-xs text-right font-mono focus:outline-none"
                      />
                    ) : (
                      <span className="text-xs font-mono text-slate-500">{s.price ? `${s.price}k` : '—'}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              id="add_suggestions_btn"
              onClick={addPicked}
              disabled={Object.keys(picked).length === 0}
              className="w-full py-2 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 border border-amber-200 text-amber-800 text-sm font-bold rounded-lg cursor-pointer disabled:cursor-not-allowed"
            >
              Thêm {Object.keys(picked).length || ''} dịch vụ đã chọn vào bảng giá
            </button>
          </>
        )}
      </section>
    </div>
  );
}
