import { useEffect, useState } from 'react';
import { api, euro } from '../api';

interface Received {
  id: string; supplier_name: string | null; invoice_number: string | null; invoice_date: string | null;
  currency: string | null; gross_amount_cents: number | null; format: string | null;
  validation_status: string; duplicate_status: string; source: string;
}

const VAL_TONE: Record<string, string> = {
  BASIC_VALID: 'bg-green-100 text-green-700', STRICT_VALID: 'bg-green-100 text-green-700',
  BASIC_INVALID: 'bg-red-100 text-red-700', STRICT_INVALID: 'bg-red-100 text-red-700',
  BASIC_CHECK_ONLY: 'bg-amber-100 text-amber-700', UNSUPPORTED_FORMAT: 'bg-gray-100 text-gray-600',
  PENDING: 'bg-gray-100 text-gray-600', PROCESSING_ERROR: 'bg-red-100 text-red-700',
};

export function Inbox() {
  const [rows, setRows] = useState<Received[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.get<Received[]>('/received').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  async function upload(file: File) {
    setMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    try { const r = await api.post<{ format: string; structured: boolean; validationStatus: string }>('/received/upload', fd); setMsg(`دریافت شد: ${r.format} (${r.validationStatus})`); load(); }
    catch (e) { setMsg((e as Error).message); }
  }

  async function open(id: string) {
    const d = await api.get<Record<string, unknown>>(`/received/${id}`);
    setDetail(d);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">E-Rechnung Eingang</h1>
        <div className="flex gap-2">
          <a className="btn-ghost" href="/api/export/incoming.csv">خروجی CSV</a>
          <label className="btn-primary cursor-pointer">
            آپلود فایل
            <input type="file" className="hidden" accept=".xml,.pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      </div>
      {msg && <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}

      <div className="card overflow-x-auto">
        <table className="data">
          <thead><tr><th>فروشنده</th><th>شماره</th><th>تاریخ</th><th>مبلغ</th><th>فرمت</th><th>اعتبارسنجی</th><th>تکراری</th><th>منبع</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => open(r.id)}>
                <td>{r.supplier_name ?? '—'}</td>
                <td className="font-mono">{r.invoice_number ?? '—'}</td>
                <td dir="ltr">{r.invoice_date ?? ''}</td>
                <td className="font-mono">{r.gross_amount_cents != null ? euro(r.gross_amount_cents, r.currency ?? 'EUR') : ''}</td>
                <td>{r.format}</td>
                <td><span className={`badge ${VAL_TONE[r.validation_status] ?? ''}`}>{r.validation_status}</span></td>
                <td>{r.duplicate_status !== 'NOT_DUPLICATE' ? <span className="badge bg-amber-100 text-amber-700">{r.duplicate_status}</span> : ''}</td>
                <td>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold">جزئیات فاکتور دریافتی</div>
            <button className="btn-ghost" onClick={() => setDetail(null)}>بستن</button>
          </div>
          <pre dir="ltr" className="max-h-96 overflow-auto rounded bg-gray-50 p-3 text-xs dark:bg-gray-950">{JSON.stringify(detail, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
