import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import { money } from '../currency';
import { Alert, EmptyState, Icon, Loading, Modal, Spinner, TopBar, useToast } from '../ui';
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
  const [tab, setTab] = useState<'visual' | 'xml' | 'audit' | null>(null);
  const [xml, setXml] = useState<string | null>(null);
  const [xmlErr, setXmlErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const load = () => api.get<Detail>(`/received/${id}`).then(setD).catch(() => setD(null));
  useEffect(() => { void load(); }, [id]);

  const xmlFile = d?.files.find((f) => f.file_role === 'source_xml');
  const activeTab = tab ?? (xmlFile ? 'xml' : 'visual');
  const copy = (v: string) => { void navigator.clipboard?.writeText(v).then(() => toast(t('common.copied'))).catch(() => {}); };
  useEffect(() => {
    if (activeTab !== 'xml' || xml !== null || !xmlFile) return;
    api.raw(`/documents/received/${id}/file/source_xml`)
      .then(async (r) => { if (!r.ok) throw new Error(); setXml(prettyXml(await r.text())); })
      .catch(() => setXmlErr(true));
  }, [activeTab, xml, xmlFile, id]);

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

  const valBorder = valTone === 'success' ? 'border-s-success' : valTone === 'danger' ? 'border-s-danger' : 'border-s-warning';
  const valPill = valTone === 'success' ? 'bg-success-soft text-success' : valTone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning';

  return (
    <div>
      <TopBar back="/inbox"
        title={<>{t('rx.title')}: <span dir="ltr">#{inv.invoice_number ? num(inv.invoice_number) : '—'}</span></>}
        subtitle={`${t('rx.received_via', { source: tx(`rx.src_${inv.source}`, inv.source) })} • ${dt(inv.created_at)}`}
        actions={<>
          {isDup && !inv.duplicate_decision && <>
            <button className="btn-secondary max-md:hidden" disabled={!!busy} onClick={() => act('keep', () => api.post(`/received/${id}/duplicate-decision`, { decision: 'ACCEPTED', reason: 'not a duplicate' }), t('rx.decision_saved'))}>{busy === 'keep' ? <Spinner /> : <Icon name="check" />}{t('rx.keep')}</button>
            <button className="btn-danger" disabled={!!busy} onClick={() => setRejectOpen(true)}><Icon name="ban" /><span className="max-sm:hidden">{t('rx.reject_dup')}</span></button>
          </>}
          {inv.payment_status !== 'PAID' ? (
            <button className="btn-primary" disabled={!!busy || inv.duplicate_decision?.startsWith('REJECTED')} onClick={() => act('paid', () => api.put(`/received/${id}/payment-status`, { status: 'PAID' }), t('rx.marked_paid'))}>
              {busy === 'paid' ? <Spinner /> : <Icon name="check" />}<span className="max-sm:hidden">{t('rx.approve_pay')}</span>
            </button>
          ) : (
            <button className="btn-secondary" disabled={!!busy} onClick={() => act('unpaid', () => api.put(`/received/${id}/payment-status`, { status: 'UNPAID' }), t('common.saved'))}>
              {busy === 'unpaid' ? <Spinner /> : <Icon name="x" />}<span className="max-sm:hidden">{t('rx.mark_unpaid')}</span>
            </button>
          )}
        </>} />
      {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
      {inv.duplicate_decision && <Alert tone={inv.duplicate_decision.startsWith('REJECTED') ? 'warning' : 'info'}>{t('rx.decision')}: {inv.duplicate_decision}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-6">
          <section className={`card border-s-4 p-6 ${valBorder}`}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-bold">{t('rx.validation')}</h2>
              <span className={`badge-status ${valPill}`} dir="ltr">{inv.validation_status}</span>
            </div>
            <ul className="space-y-3 text-sm">
              {checks.map((c, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${c.ok === true ? 'bg-success-soft text-success' : c.ok === false ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
                    <Icon name={c.ok === true ? 'check' : c.ok === false ? 'x' : 'info'} className="h-3 w-3" />
                  </span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
            {messages.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-lg bg-surface-2 p-3 text-xs" dir="auto">
                {messages.map((x, i) => <li key={i}><span className="font-semibold">{x.level}:</span> {x.msg}</li>)}
              </ul>
            )}
          </section>

          <section className="card p-6">
            <div className="mb-5 flex items-center justify-between gap-2">
              <h2 className="text-base font-bold">{t('rx.extracted')}</h2>
              <span className={`badge-status ${inv.payment_status === 'PAID' ? 'bg-success-soft text-success' : inv.payment_status === 'PARTIALLY_PAID' ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted'}`}>{tx(`status.${inv.payment_status}`, inv.payment_status)}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm">
              <Fld label={t('inbox.supplier')} wide><div dir="auto" className="font-semibold">{inv.supplier_name ?? '—'}</div>
                {inv.supplier_address && <div className="text-xs text-muted" dir="auto">{inv.supplier_address}</div>}</Fld>
              <Fld label={t('rx.vat_id')}><span className="font-mono" dir="ltr">{inv.supplier_vat_id ?? inv.supplier_tax_id ?? '—'}</span></Fld>
              <Fld label={t('inv.number')}><span className="font-mono" dir="ltr">{inv.invoice_number ? num(inv.invoice_number) : '—'}</span></Fld>
              <Fld label={t('inv.date')}>{date(inv.invoice_date) || '—'}</Fld>
              <Fld label={t('inv.due')}>{date(inv.due_date) || '—'}</Fld>
              <Fld label={t('rx.net')}><span className="tabular">{m(inv.net_amount_cents)}</span></Fld>
              <Fld label={t('rx.tax')}><span className="tabular">{m(inv.tax_amount_cents)}</span></Fld>
              <Fld label={t('rx.gross')} wide><span className="tabular text-2xl font-bold text-primary-fg">{m(inv.gross_amount_cents)}</span></Fld>
              {inv.iban && (
                <Fld label={t('rx.iban')} wide>
                  <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <span className="flex-1 font-mono text-[13px]" dir="ltr">{inv.iban.replace(/(.{4})/g, '$1 ').trim()}{inv.bic && <span className="ms-3 text-muted">{inv.bic}</span>}</span>
                    <button className="btn-ghost btn-icon h-7 w-7" aria-label={t('common.copy')} onClick={() => copy(inv.iban!)}><Icon name="copy" className="h-3.5 w-3.5" /></button>
                  </div>
                </Fld>
              )}
              {inv.payment_terms && <Fld label={t('rx.terms')} wide><span dir="auto">{inv.payment_terms}</span></Fld>}
              {(inv.buyer_reference || inv.purchase_order_reference || inv.contract_reference) && (
                <Fld label={t('rx.refs')} wide>
                  <div className="space-y-0.5 font-mono text-xs" dir="ltr">
                    {inv.buyer_reference && <div>Leitweg-ID / BT-10: {inv.buyer_reference}</div>}
                    {inv.purchase_order_reference && <div>PO / BT-13: {inv.purchase_order_reference}</div>}
                    {inv.contract_reference && <div>Contract / BT-12: {inv.contract_reference}</div>}
                  </div>
                </Fld>
              )}
            </dl>
          </section>

          <section className="card p-6">
            <h2 className="mb-4 text-base font-bold">{t('rx.files')}</h2>
            {d.files.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <ul className="space-y-3">
                {d.files.map((f) => (
                  <li key={f.id}>
                    <a href={`/api/documents/received/${id}/file/${encodeURIComponent(f.file_role)}`}
                      className="flex items-center gap-3 rounded-lg border border-line p-3 transition-colors hover:border-line-strong hover:bg-surface-2">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${f.file_role === 'source_pdf' ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info'}`}><Icon name={fileIcon(f)} className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold" dir="ltr">{f.original_filename ?? f.file_role}</div>
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

        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist">
              {(['xml', 'visual', 'audit'] as const).map((k) => (
                <button key={k} role="tab" aria-selected={activeTab === k} onClick={() => setTab(k)}
                  className={`h-8 rounded-md px-4 text-[13px] font-semibold transition-colors ${activeTab === k ? 'bg-fg text-bg shadow-sm' : 'text-muted hover:text-fg'}`}>
                  {t(`rx.tab_${k}`)}
                </button>
              ))}
            </div>
            {inv.file_sha256 && (
              <button className="flex items-center gap-1.5 font-mono text-[11px] text-muted hover:text-fg" dir="ltr" title={inv.file_sha256} onClick={() => copy(inv.file_sha256!)}>
                SHA-256: {inv.file_sha256.slice(0, 6)}…{inv.file_sha256.slice(-6)}<Icon name="copy" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <section className={`overflow-hidden rounded-xl ${activeTab === 'xml' ? 'bg-[#0f172a] shadow-lg' : 'card'}`}>
            {activeTab === 'visual' && (
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
                      <tr><td colSpan={4} className="text-end font-semibold">{t('rx.gross')}</td><td className="num text-end font-bold text-primary-fg">{m(inv.gross_amount_cents)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              )
            )}
            {activeTab === 'xml' && (
              !xmlFile ? <p className="p-8 text-center text-sm text-slate-400">{t('rx.no_xml')}</p>
                : xmlErr ? <div className="p-4"><Alert tone="danger">{t('common.error')}</Alert></div>
                  : xml === null ? <div className="p-8 text-center"><Spinner /></div>
                    : <>
                      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5" dir="ltr">
                        <span className="h-3 w-3 rounded-full bg-[#ef4444]/80" /><span className="h-3 w-3 rounded-full bg-[#eab308]/80" /><span className="h-3 w-3 rounded-full bg-[#22c55e]/80" />
                        <span className="ms-3 truncate font-mono text-xs text-slate-400">{xmlFile.original_filename ?? 'invoice.xml'}</span>
                        <button className="ms-auto rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label={t('common.copy')} onClick={() => copy(xml)}><Icon name="copy" className="h-4 w-4" /></button>
                      </div>
                      <pre dir="ltr" className="max-h-[60vh] overflow-auto p-5 font-mono text-xs leading-relaxed text-slate-300">{highlightXml(xml)}</pre>
                    </>
            )}
            {activeTab === 'audit' && (
              d.history.length === 0 ? <EmptyState icon="activity" title={t('dash.no_activity')} /> : (
                <div className="overflow-x-auto">
                  <table className="data">
                    <thead><tr><th>{t('dash.col_activity')}</th><th>{t('rx.actor')}</th><th>{t('inv.date')}</th></tr></thead>
                    <tbody>{d.history.map((e) => (
                      <tr key={e.id}><td className="font-medium">{tx(`act.${e.event_type}`, e.event_type)}</td><td className="text-muted" dir="ltr">{e.actor_email ?? t('rx.system')}</td><td className="whitespace-nowrap text-muted">{dt(e.created_at)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )
            )}
          </section>

          <section className="card p-6">
            <h2 className="mb-5 text-base font-bold">{t('rx.history')}</h2>
            {d.history.length === 0 ? <p className="text-sm text-muted">{t('dash.no_activity')}</p> : (
              <ol className="space-y-5">
                {d.history.slice(0, 8).map((e, i, arr) => (
                  <li key={e.id} className="relative flex gap-4">
                    {i < arr.length - 1 && <span className="absolute start-[11px] top-7 h-[calc(100%-0.5rem)] w-0.5 bg-line" aria-hidden="true" />}
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${i === 0 ? 'bg-primary text-on-primary' : 'bg-success-soft text-success'}`}><Icon name={i === 0 ? 'activity' : 'check'} className="h-3 w-3" /></span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{tx(`act.${e.event_type}`, e.event_type)}</div>
                      <div className="text-xs text-muted">{dt(e.created_at)} · <span dir="ltr">{e.actor_email ?? t('rx.system')}</span></div>
                    </div>
                  </li>
                ))}
              </ol>
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

function Fld({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={wide ? 'col-span-2' : ''}><dt className="eyebrow text-[11px]">{label}</dt><dd className="mt-1">{children}</dd></div>;
}

/** Colour XML tokens as React nodes (no innerHTML): tags, attribute names, attribute values, text. */
function highlightXml(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(<\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)(\s*\/?>)|(<\?[^>]*\?>|<!--[\s\S]*?-->)/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(<span key={k++} className="text-slate-100">{src.slice(last, m.index)}</span>);
    if (m[5]) out.push(<span key={k++} className="text-slate-500">{m[5]}</span>);
    else {
      out.push(<span key={k++} className="text-sky-400">{m[1]}{m[2]}</span>);
      for (const a of m[3]!.matchAll(/(\s+)([\w:.-]+)(=)("[^"]*")/g)) {
        out.push(a[1], <span key={k++} className="text-violet-300">{a[2]}</span>, a[3], <span key={k++} className="text-emerald-300">{a[4]}</span>);
      }
      out.push(<span key={k++} className="text-sky-400">{m[4]}</span>);
    }
    last = re.lastIndex;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
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
