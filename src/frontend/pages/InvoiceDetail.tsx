import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import { money } from '../currency';
import { Alert, Field, Icon, Loading, Modal, MoneyInput, Options, Section, Spinner, StatusBadge, useToast } from '../ui';

interface Detail {
  invoice: { id: string; invoice_number: string | null; status: string; total_cents: number; currency: string; document_type: string; due_date: string | null; invoice_date: string | null; project_name: string | null };
  items: { id: string; description: string; quantity_decimal: string; unit: string; unit_price_cents: number; line_total_cents: number }[];
  payments: { paidCents: number; remainingCents: number; payments: { payment_date: string; amount_cents: number; payment_method: string }[] };
  relations: { related_invoice_id: string; relation_type: string }[];
  installments: { id: string; position: number; label: string | null; due_date: string | null; amount_cents: number; paid: number }[];
}
const METHODS = ['BANK_TRANSFER', 'CASH', 'PAYPAL', 'CARD', 'OTHER'] as const;

export function InvoiceDetail() {
  const { id } = useParams();
  const i18n = useI18n();
  const { t, tx, lang, num, date } = i18n;
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const fail = (e: unknown) => { setErr(errorText(e, i18n)); setErrCode((e as { code?: string }).code ?? null); };
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmStorno, setConfirmStorno] = useState(false);
  const [pay, setPay] = useState({ payment_date: new Date().toISOString().slice(0, 10), amount_cents: 0, payment_method: 'BANK_TRANSFER' });
  const [pdfDoc, setPdfDoc] = useState<string | null>(null);

  const load = () => api.get<Detail>(`/invoices/${id}`).then((data) => {
    setD(data);
    setPay((p) => ({ ...p, amount_cents: data.payments.remainingCents }));
  }).catch((e) => fail(e));
  const loadDocs = () => api.get<{ id: string; document_role: string }[]>(`/documents/for/invoice/${id}`)
    .then((docs) => setPdfDoc(docs.find((x) => x.document_role === 'pdf')?.id ?? null)).catch(() => {});

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); void loadDocs(); }, [id]);

  async function act(name: string, fn: () => Promise<unknown>, okMsg?: string) {
    setErr(null); setBusy(name);
    try { await fn(); if (okMsg) toast(okMsg); await load(); await loadDocs(); } catch (e) { fail(e); } finally { setBusy(null); }
  }

  if (!d) return err ? <Alert tone="danger">{err}</Alert> : <Loading />;
  const inv = d.invoice;
  const isDraft = inv.status === 'DRAFT' || inv.status === 'READY_TO_ISSUE';
  const live = !isDraft && inv.status !== 'CANCELLED';
  const title = `${tx(`doc.${inv.document_type}`, inv.document_type)} ${inv.invoice_number ? num(inv.invoice_number) : ''}`.trim();

  return (
    <div>
      <Link to="/invoices" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><Icon name="chevronRight" className="h-4 w-4 rotate-180" flip />{t('nav.invoices')}</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" dir="auto">{title}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {[inv.project_name, inv.invoice_date && `${t('inv.date')}: ${date(inv.invoice_date)}`, inv.due_date && `${t('inv.due')}: ${date(inv.due_date)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/invoices/${id}/preview`} target="_blank" rel="noreferrer"><Icon name="eye" />{t('common.preview')}</a>
          {pdfDoc && <a className="btn-secondary" href={`/api/documents/${pdfDoc}/download`}><Icon name="download" />{t('common.download_pdf')}</a>}
          {live && <button className="btn-secondary" disabled={!!busy} onClick={() => act('send', () => api.post(`/invoices/${id}/send`, {}), t('det.sent'))}>{busy === 'send' ? <Spinner /> : <Icon name="send" />}{t('det.send')}</button>}
          {live && <button className="btn-danger" disabled={!!busy} onClick={() => setConfirmStorno(true)}><Icon name="ban" />{t('det.storno')}</button>}
          {isDraft && <button className="btn-primary" disabled={!!busy} onClick={() => act('issue', () => api.post(`/invoices/${id}/issue`), t('det.issued'))}>{busy === 'issue' ? <Spinner /> : <Icon name="check" />}{t('ni.issue')}</button>}
        </div>
      </div>
      {err && <Alert tone="danger" onClose={() => { setErr(null); setErrCode(null); }}>{err}
        {errCode === 'SELLER_INCOMPLETE' && <> <Link to="/settings" className="font-semibold underline">{t('ni.go_settings')}</Link></>}
      </Alert>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="card overflow-hidden">
            <div className="border-b border-line px-5 py-3"><h2 className="section-title">{t('det.items')}</h2></div>
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>{t('ni.description')}</th><th className="text-end">{t('ni.qty')}</th><th className="text-end max-sm:hidden">{t('ni.unit_price')}</th><th className="text-end">{t('ni.line_total')}</th></tr></thead>
                <tbody>
                  {d.items.map((it) => (
                    <tr key={it.id}>
                      <td dir="auto" className="whitespace-pre-line">{it.description}</td>
                      <td className="num whitespace-nowrap text-end">{num(it.quantity_decimal)} {tx(`unit.${it.unit}`, it.unit)}</td>
                      <td className="num whitespace-nowrap text-end text-muted max-sm:hidden">{money(it.unit_price_cents ?? 0, inv.currency, lang)}</td>
                      <td className="num whitespace-nowrap text-end font-medium">{money(it.line_total_cents, inv.currency, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-baseline justify-end gap-4 border-t border-line px-5 py-4">
              <span className="text-muted">{t('ni.total')}</span>
              <span className="tabular text-xl font-bold">{money(inv.total_cents, inv.currency, lang)}</span>
            </div>
          </section>

          {d.installments.length > 0 && (
            <Section title={t('det.installments')} icon="clock">
              <ul className="divide-y divide-line">
                {d.installments.map((ins) => (
                  <li key={ins.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span className="text-sm"><span className="text-muted">#{num(ins.position)}</span> {date(ins.due_date)}{ins.label ? ` · ${ins.label}` : ''}</span>
                    <span className="tabular font-medium">{money(ins.amount_cents, inv.currency, lang)}</span>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={ins.paid === 1}
                        onChange={(e) => act('ins', () => api.put(`/invoices/${id}/installments/${ins.id}`, { paid: e.target.checked }))} />
                      {ins.paid ? t('det.installment_paid') : t('det.installment_open')}
                    </label>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {d.relations.length > 0 && (
            <Section title={t('det.related')} icon="file">
              <ul className="space-y-1 text-sm">
                {d.relations.map((r, i) => (
                  <li key={i}><span className="text-muted">{r.relation_type}:</span> <Link className="text-primary-fg hover:underline" to={`/invoices/${r.related_invoice_id}`}>{r.related_invoice_id}</Link></li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          <Section title={t('det.payments')} icon="banknote">
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-success-soft px-3 py-2"><div className="text-xs text-success">{t('det.paid')}</div><div className="tabular font-semibold text-success">{money(d.payments.paidCents, inv.currency, lang)}</div></div>
              <div className="rounded-lg bg-surface-2 px-3 py-2"><div className="text-xs text-muted">{t('det.remaining')}</div><div className="tabular font-semibold">{money(d.payments.remainingCents, inv.currency, lang)}</div></div>
            </div>
            {d.payments.payments.length === 0 ? <p className="mb-4 text-sm text-muted">{t('det.no_payments')}</p> : (
              <ul className="mb-4 divide-y divide-line text-sm">
                {d.payments.payments.map((p, i) => (
                  <li key={i} className="flex justify-between gap-2 py-2"><span className="text-muted">{date(p.payment_date)} · {tx(`pm.${p.payment_method}`, p.payment_method)}</span><span className="tabular">{money(p.amount_cents, inv.currency, lang)}</span></li>
                ))}
              </ul>
            )}
            {live && d.payments.remainingCents > 0 && (
              <form className="space-y-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); void act('pay', () => api.post(`/payments/${id}`, pay), t('det.payment_saved')); }}>
                <Field label={t('det.date')} htmlFor="pdate"><input id="pdate" className="input" type="date" value={pay.payment_date} onChange={(e) => setPay({ ...pay, payment_date: e.target.value })} /></Field>
                <Field label={t('det.amount')} htmlFor="pamt"><MoneyInput id="pamt" value={pay.amount_cents} currency={inv.currency} onChange={(v) => setPay({ ...pay, amount_cents: v })} /></Field>
                <Field label={t('det.method')} htmlFor="pm">
                  <select id="pm" className="input" value={pay.payment_method} onChange={(e) => setPay({ ...pay, payment_method: e.target.value })}><Options values={METHODS} prefix="pm." /></select>
                </Field>
                <button className="btn-primary w-full" disabled={!!busy}>{busy === 'pay' ? <Spinner /> : <Icon name="check" />}{t('det.add_payment')}</button>
              </form>
            )}
          </Section>
        </div>
      </div>

      <Modal open={confirmStorno} onClose={() => setConfirmStorno(false)} title={t('det.storno')}
        footer={<>
          <button className="btn-secondary" onClick={() => setConfirmStorno(false)}>{t('common.cancel')}</button>
          <button className="btn-danger" onClick={() => { setConfirmStorno(false); void act('storno', () => api.post(`/invoices/${id}/storno`)); }}><Icon name="ban" />{t('det.storno')}</button>
        </>}>
        <p className="text-sm">{t('det.storno_confirm')}</p>
      </Modal>
    </div>
  );
}
