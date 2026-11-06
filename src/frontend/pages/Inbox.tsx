import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import { money } from '../currency';
import { Alert, Badge, EmptyState, Icon, Loading, PageHeader, Spinner, useToast } from '../ui';

interface Received {
  id: string; supplier_name: string | null; invoice_number: string | null; invoice_date: string | null;
  currency: string | null; gross_amount_cents: number | null; format: string | null;
  validation_status: string; duplicate_status: string; source: string; payment_status: string;
}

const VAL_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  BASIC_VALID: 'success', STRICT_VALID: 'success', BASIC_INVALID: 'danger', STRICT_INVALID: 'danger',
  BASIC_CHECK_ONLY: 'warning', UNSUPPORTED_FORMAT: 'neutral', PENDING: 'neutral', PROCESSING_ERROR: 'danger',
};

export function Inbox() {
  const i18n = useI18n();
  const { t, tx, lang, date, num } = i18n;
  const nav = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<Received[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = () => api.get<Received[]>('/received').then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, []);

  async function upload(f: File) {
    setErr(null); setUploading(true);
    const fd = new FormData();
    fd.append('file', f);
    try {
      const r = await api.post<{ format: string; validationStatus: string }>('/received/upload', fd);
      toast(t('inbox.uploaded', { format: r.format, status: r.validationStatus }));
      await load();
    } catch (e) { setErr(errorText(e, i18n)); } finally { setUploading(false); if (file.current) file.current.value = ''; }
  }

  return (
    <div>
      <PageHeader title={t('inbox.title')} subtitle={t('inbox.subtitle')}
        actions={<>
          <a className="btn-secondary" href="/api/export/incoming.csv"><Icon name="download" />{t('common.export_csv')}</a>
          <button className="btn-primary" onClick={() => file.current?.click()} disabled={uploading}>{uploading ? <Spinner /> : <Icon name="upload" />}{t('inbox.upload')}</button>
          <input ref={file} type="file" className="hidden" accept=".xml,.pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </>} />
      {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}

      <div className="card overflow-hidden">
        {!rows ? <Loading /> : rows.length === 0 ? <EmptyState icon="inbox" title={t('inbox.empty')} /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('inbox.supplier')}</th><th>{t('inv.number')}</th><th>{t('inv.date')}</th><th className="text-end">{t('inv.amount')}</th><th>{t('inbox.format')}</th><th>{t('inbox.validation')}</th><th>{t('rx.payment')}</th><th className="max-md:hidden">{t('inbox.source')}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => nav(`/inbox/${r.id}`)}>
                    <td dir="auto">{r.supplier_name ?? '—'}{r.duplicate_status !== 'NOT_DUPLICATE' && <span className="ms-2"><Badge tone="warning">{t('inbox.duplicate')}</Badge></span>}</td>
                    <td className="font-mono text-[13px]" dir="ltr">{r.invoice_number ? num(r.invoice_number) : '—'}</td>
                    <td className="whitespace-nowrap text-muted">{date(r.invoice_date)}</td>
                    <td className="num whitespace-nowrap text-end">{r.gross_amount_cents != null ? money(r.gross_amount_cents, r.currency ?? 'EUR', lang) : ''}</td>
                    <td className="text-muted">{r.format}</td>
                    <td><Badge tone={VAL_TONE[r.validation_status] ?? 'neutral'}>{r.validation_status}</Badge></td>
                    <td><Badge tone={r.payment_status === 'PAID' ? 'success' : r.payment_status === 'PARTIALLY_PAID' ? 'warning' : 'neutral'}>{tx(`status.${r.payment_status}`, r.payment_status)}</Badge></td>
                    <td className="max-md:hidden text-muted">{tx(`rx.src_${r.source}`, r.source)}</td>
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
