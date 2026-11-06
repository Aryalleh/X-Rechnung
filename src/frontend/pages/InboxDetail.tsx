import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import { money } from '../currency';
import { Alert, Badge, EmptyState, Icon, Loading, Modal, Spinner, useToast } from '../ui';
import type { IconName } from '../ui';

interface Received {
  id: string; source: string; format: string | null; profile_id: string | null; supplier_name: string | null; supplier_address: string | null;
  supplier_vat_id: string | null; supplier_tax_id: string | null; invoice_number: string | null; invoice_date: string | null; due_date: string | null;
  currency: string | null; net_amount_cents: number | null; tax_amount_cents: number | null; gross_amount_cents: number | null;
  payment_terms: string | null; iban: string | null; bic: string | null; buyer_reference: string | null; purchase_order_reference: string | null;
  contract_reference: string | null; validation_status: string; duplicate_status: string; duplicate_of: string | null; duplicate_decision: string | null;
  payment_status: string; file_sha256: string | null; xml_pdf_mismatch: number; created_at: string;
}
interface FileRow { id: string; file_role: string; original_filename: string | null; mime_type: string | null; size_bytes: number; sha256: string | null }
interface Item { id: string; position: number; description: string | null; quantity_decimal: string | null; unit: string | null; unit_price_cents: number | null; line_total_cents: number | null }
interface Validation { id: string; level: string; status: string; validator_name: string | null; messages_json: string | null; created_at: string }
interface Event { id: string; event_type: string; actor_email: string | null; created_at: string }
interface Detail { invoice: Received; files: FileRow[]; items: Item[]; validations: Validation[]; history: Event[] }

const VALID = ['BASIC_VALID', 'STRICT_VALID'];
const INVALID = ['BASIC_INVALID', 'STRICT_INVALID', 'PROCESSING_ERROR'];

export function InboxDetail() {
  const { id } = useParams();
  const i18n = useI18n();
  const { t, tx, lang, num, date, locale } = i18n;
  const toast = useToast();
  const [d, setD] = useState<Detail | null | undefined>(undefined);
  const [tab, setTab] = useState<'visual' | 'xml' | 'audit'>('visual');
  const [xml, setXml] = useState<string | null>(null);
  const [xmlErr, setXmlErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const load = () => api.get<Detail>(`/received/${id}`).then(setD).catch(() => setD(null));
  useEffect(() => { void load(); }, [id]);

  const xmlFile = d?.files.find((f) => f.file_role === 'source_xml');
  useEffect(() => {
    if (tab !== 'xml' || xml !== null || !xmlFile) return;
    api.raw(`/documents/received/${id}/file/source_xml`)
      .then(async (r) => { if (!r.ok) throw new Error(); setXml(prettyXml(await r.text())); })
      .catch(() => setXmlErr(true));
  }, [tab, xml, xmlFile, id]);

  if (d === undefined) return <Loading />;
  if (d === null) return <Navigate to="/inbox" replace />;
  const inv = d.invoice;
  const cur = inv.currency ?? 'EUR';
  const m = (v: number | null) => (v == null ? '—' : money(v, cur, lang));
  const dt = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(iso));
  const isDup = inv.duplicate_status !== 'NOT_DUPLICATE';
  const valTone = VALID.includes(inv.validation_status) ? 'success' : INVALID.includes(inv.validation_status) ? 'danger' : 'warning';
  const messages = d.validations.flatMap((v) => { try { return (JSON.parse(v.messages_json ?? '[]') as string[]).map((msg) => ({ level: v.level, msg })); } catch { return []; } });

  async function act(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key); setErr(null);
    try { await fn(); toast(okMsg); await load(); } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(null); }
  }

  const checks: { ok: boolean | null; text: string }[] = [
    { ok: VALID.includes(inv.validation_status) ? true : INVALID.includes(inv.validation_status) ? false : null, text: t(`rx.val_${VALID.includes(inv.validation_status) ? 'ok' : INVALID.includes(inv.validation_status) ? 'bad' : 'partial'}`) },
    { ok: !isDup, text: isDup ? t('rx.dup_found') : t('rx.dup_none') },
    ...(inv.xml_pdf_mismatch ? [{ ok: false, text: t('rx.mismatch') }] : []),
  ];

  return (
    <div>
      <Link to="/inbox" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><Icon name="chevronRight" className="h-4 w-4 rotate-180 rtl:rotate-0" />{t('inbox.title')}</Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('rx.title')}: <span className="font-mono" dir="ltr">{inv.invoice_number ? num(inv.invoice_number) : '—'}</span></h1>
          <p className="mt-1 text-sm text-muted">{t('rx.received_via', { source: tx(`rx.src_${inv.source}`, inv.source) })} · {dt(inv.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDup && !inv.duplicate_decision && <>
            <button className="btn-secondary" disabled={!!busy} onClick={() => setRejectOpen(true)}><Icon name="ban" />{t('rx.reject_dup')}</button>
            <button className="btn-secondary" disabled={!!busy} onClick={() => act('keep', () => api.post(`/received/${id}/duplicate-decision`, { decision: 'ACCEPTED', reason: 'not a duplicate' }), t('rx.decision_saved'))}>{busy === 'keep' ? <Spinner /> : <Icon name="check" />}{t('rx.keep')}</button>
          </>}
          {inv.payment_status !== 'PAID' ? (
            <button className="btn-primary" disabled={!!busy || inv.duplicate_decision?.startsWith('REJECTED')} onClick={() => act('paid', () => api.put(`/received/${id}/payment-status`, { status: 'PAID' }), t('rx.marked_paid'))}>
              {busy === 'paid' ? <Spinner /> : <Icon name="banknote" />}{t('rx.approve_pay')}
            </button>
          ) : (
            <button className="btn-secondary" disabled={!!busy} onClick={() => act('unpaid', () => api.put(`/received/${id}/payment-status`, { status: 'UNPAID' }), t('common.saved'))}>
              {busy === 'unpaid' ? <Spinner /> : <Icon name="x" />}{t('rx.mark_unpaid')}
            </button>
          )}
        </div>
      </div>
      {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
      {inv.duplicate_decision && <Alert tone={inv.duplicate_decision.startsWith('REJECTED') ? 'warning' : 'info'}>{t('rx.decision')}: {inv.duplicate_decision}</Alert>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <section className="card card-pad">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="section-title">{t('rx.validation')}</h2>
              <Badge tone={valTone}>{inv.validation_status}</Badge>
            </div>
            <ul className="space-y-2 text-sm">
              {checks.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Icon name={c.ok === true ? 'check' : c.ok === false ? 'alert' : 'info'} className={`mt-0.5 h-4 w-4 ${c.ok === true ? 'text-success' : c.ok === false ? 'text-danger' : 'text-warning'}`} />
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
            {messages.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg bg-surface-2 p-3 text-xs" dir="auto">
                {messages.map((x, i) => <li key={i}><span className="font-semibold">{x.level}:</span> {x.msg}</li>)}
              </ul>
            )}
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-3">{t('rx.extracted')}</h2>
            <dl className="space-y-2.5 text-sm">
              <Fld label={t('inbox.supplier')}><div dir="auto" className="font-medium">{inv.supplier_name ?? '—'}</div>
                {inv.supplier_vat_id && <div className="text-xs text-muted" dir="ltr">{t('rx.vat_id')}: {inv.supplier_vat_id}</div>}</Fld>
              <Fld label={t('inv.number')}><span className="font-mono" dir="ltr">{inv.invoice_number ? num(inv.invoice_number) : '—'}</span></Fld>
              <div className="grid grid-cols-2 gap-2.5">
                <Fld label={t('inv.date')}>{date(inv.invoice_date) || '—'}</Fld>
                <Fld label={t('inv.due')}>{date(inv.due_date) || '—'}</Fld>
                <Fld label={t('rx.net')}><span className="tabular">{m(inv.net_amount_cents)}</span></Fld>
                <Fld label={t('rx.tax')}><span className="tabular">{m(inv.tax_amount_cents)}</span></Fld>
              </div>
              <Fld label={t('rx.gross')}><span className="tabular text-lg font-bold">{m(inv.gross_amount_cents)}</span></Fld>
              {inv.iban && <Fld label={t('rx.iban')}><span className="font-mono text-[13px]" dir="ltr">{inv.iban.replace(/(.{4})/g, '$1 ').trim()}</span>{inv.bic && <span className="ms-2 text-xs text-muted" dir="ltr">{inv.bic}</span>}</Fld>}
              {inv.payment_terms && <Fld label={t('rx.terms')}><span dir="auto">{inv.payment_terms}</span></Fld>}
              {(inv.buyer_reference || inv.purchase_order_reference || inv.contract_reference) && (
                <Fld label={t('rx.refs')}>
                  <div className="space-y-0.5 text-xs" dir="ltr">
                    {inv.buyer_reference && <div>Leitweg-ID / BT-10: {inv.buyer_reference}</div>}
                    {inv.purchase_order_reference && <div>PO / BT-13: {inv.purchase_order_reference}</div>}
                    {inv.contract_reference && <div>Contract / BT-12: {inv.contract_reference}</div>}
                  </div>
                </Fld>
              )}
              <Fld label={t('rx.payment')}><Badge tone={inv.payment_status === 'PAID' ? 'success' : inv.payment_status === 'PARTIALLY_PAID' ? 'warning' : 'neutral'}>{tx(`status.${inv.payment_status}`, inv.payment_status)}</Badge></Fld>
            </dl>
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-3">{t('rx.files')}</h2>
            {d.files.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <ul className="space-y-2">
                {d.files.map((f) => (
                  <li key={f.id}>
                    <a href={`/api/documents/received/${id}/file/${encodeURIComponent(f.file_role)}`}
                      className="flex items-center gap-3 rounded-lg border border-line p-3 transition-colors hover:border-line-strong hover:bg-surface-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-muted"><Icon name={fileIcon(f)} className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" dir="ltr">{f.original_filename ?? f.file_role}</div>
                        <div className="text-xs text-muted">{tx(`rx.role_${f.file_role}`, f.file_role)} · {fmtSize(f.size_bytes, locale)}</div>
                      </div>
                      <Icon name="download" className="h-4 w-4 text-muted" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
              <div className="flex gap-1" role="tablist">
                {(['visual', 'xml', 'audit'] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={`h-9 rounded-lg px-3 text-sm font-medium transition-colors ${tab === k ? 'bg-primary-soft text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
                    {t(`rx.tab_${k}`)}
                  </button>
                ))}
              </div>
              {inv.file_sha256 && <span className="font-mono text-[11px] text-muted" dir="ltr" title={inv.file_sha256}>SHA-256: {inv.file_sha256.slice(0, 4)}…{inv.file_sha256.slice(-4)}</span>}
            </div>
            {tab === 'visual' && (
              d.items.length === 0 ? <EmptyState icon="file" title={t('rx.no_items')} /> : (
                <div className="overflow-x-auto">
                  <table className="data">
                    <thead><tr><th>#</th><th>{t('rx.description')}</th><th className="text-end">{t('rx.qty')}</th><th className="text-end">{t('rx.unit_price')}</th><th className="text-end">{t('rx.line_total')}</th></tr></thead>
                    <tbody>{d.items.map((it) => (
                      <tr key={it.id}>
                        <td className="text-muted">{num(it.position)}</td>
                        <td dir="auto">{it.description ?? '—'}</td>
                        <td className="num text-end">{it.quantity_decimal ? num(it.quantity_decimal) : ''} {it.unit ?? ''}</td>
                        <td className="num whitespace-nowrap text-end">{m(it.unit_price_cents)}</td>
                        <td className="num whitespace-nowrap text-end font-medium">{m(it.line_total_cents)}</td>
                      </tr>
                    ))}</tbody>
                    <tfoot>
                      <tr><td colSpan={4} className="text-end text-muted">{t('rx.net')}</td><td className="num text-end">{m(inv.net_amount_cents)}</td></tr>
                      <tr><td colSpan={4} className="text-end text-muted">{t('rx.tax')}</td><td className="num text-end">{m(inv.tax_amount_cents)}</td></tr>
                      <tr><td colSpan={4} className="text-end font-semibold">{t('rx.gross')}</td><td className="num text-end font-bold">{m(inv.gross_amount_cents)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              )
            )}
            {tab === 'xml' && (
              !xmlFile ? <EmptyState icon="file" title={t('rx.no_xml')} />
                : xmlErr ? <div className="p-4"><Alert tone="danger">{t('common.error')}</Alert></div>
                  : xml === null ? <Loading />
                    : <pre dir="ltr" className="max-h-[70vh] overflow-auto bg-surface-2 p-4 font-mono text-xs leading-relaxed text-fg">{xml}</pre>
            )}
            {tab === 'audit' && (
              d.history.length === 0 ? <EmptyState icon="activity" title={t('dash.no_activity')} /> : (
                <ol className="space-y-4 p-5">
                  {d.history.map((e, i) => (
                    <li key={e.id} className="relative flex gap-3">
                      {i < d.history.length - 1 && <span className="absolute start-[7px] top-5 h-full w-px bg-line" aria-hidden="true" />}
                      <span className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-surface ${i === 0 ? 'bg-primary' : 'bg-line-strong'}`} />
                      <div>
                        <div className="text-sm font-medium">{tx(`act.${e.event_type}`, e.event_type)}</div>
                        <div className="text-xs text-muted">{dt(e.created_at)} · <span dir="ltr">{e.actor_email ?? t('rx.system')}</span></div>
                      </div>
                    </li>
                  ))}
                </ol>
              )
            )}
          </section>
        </div>
      </div>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title={t('rx.reject_dup')}
        footer={<>
          <button className="btn-secondary" onClick={() => setRejectOpen(false)}>{t('common.cancel')}</button>
          <button className="btn-primary" disabled={!reason.trim() || !!busy} onClick={() => { setRejectOpen(false); void act('reject', () => api.post(`/received/${id}/duplicate-decision`, { decision: 'REJECTED', reason: reason.trim() }), t('rx.decision_saved')); }}>
            <Icon name="ban" />{t('rx.reject_dup')}
          </button>
        </>}>
        <label className="label" htmlFor="rej-reason">{t('rx.reason')}</label>
        <textarea id="rej-reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
        {inv.duplicate_of && <p className="hint"><Link className="text-primary-fg underline" to={`/inbox/${inv.duplicate_of}`} onClick={() => setRejectOpen(false)}>{t('rx.view_original')}</Link></p>}
      </Modal>
    </div>
  );
}

function Fld({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}

function fileIcon(f: FileRow): IconName {
  if (f.file_role === 'source_xml') return 'file';
  if (f.file_role === 'source_pdf') return 'download';
  return 'package';
}

function fmtSize(bytes: number, locale: string): string {
  const u = bytes < 1024 ? ['byte', bytes] : bytes < 1024 ** 2 ? ['kilobyte', bytes / 1024] : ['megabyte', bytes / 1024 ** 2];
  return new Intl.NumberFormat(locale, { style: 'unit', unit: u[0] as string, unitDisplay: 'short', maximumFractionDigits: 1 }).format(u[1] as number);
}

/** Indent XML for reading (display only, never re-parsed). */
function prettyXml(src: string): string {
  if (src.length > 2_000_000) return src;
  const tok = src.replace(/>\s+</g, '><').split(/(?=<)/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < tok.length; i++) {
    const cur = tok[i]!;
    const isClose = cur.startsWith('</');
    const isOpen = !isClose && !/^<[?!]/.test(cur) && !/\/>$/.test(cur);
    if (isOpen && tok[i + 1]?.startsWith('</')) { out.push('  '.repeat(depth) + cur + tok[i + 1]); i++; continue; }
    if (isClose) depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + cur);
    if (isOpen) depth++;
  }
  return out.join('\n');
}
