import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { Lang, MsgKey } from '../i18n';
import { money, normalizeQty } from '../currency';
import { normalizeText } from '../../lib/search';
import { Alert, Field, Icon, MoneyInput, PageHeader, Section, Spinner, useToast } from '../ui';
import { CustomerCombobox, customerName } from '../components/CustomerSearch';
import type { CustomerHit } from '../components/CustomerSearch';
import { CustomerFormModal } from './Customers';

const UNITS = ['Stunde', 'Tag', 'Pauschale', 'Stück', 'Kilometer', 'Projekt', 'Minute'] as const;
type Unit = (typeof UNITS)[number];

interface Template { id: string; name: string; default_description: string; unit: Unit; default_price_cents: number; category: string | null }
interface Item { key: number; description: string; quantity: string; unit: Unit; unit_price_cents: number; discount_cents: number }
interface CustomerFull extends CustomerHit { street: string | null; postal_code: string | null }

let keySeq = 1;
const newItem = (p: Partial<Item> = {}): Item => ({ key: keySeq++, description: '', quantity: '1', unit: 'Stunde', unit_price_cents: 0, discount_cents: 0, ...p });

export function NewInvoice() {
  const i18n = useI18n();
  const { t, tx, lang, mode, num } = i18n;
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [customer, setCustomer] = useState<CustomerFull | null>(null);
  const [custModal, setCustModal] = useState<{ open: boolean; prefill?: string; editId?: string | null }>({ open: false });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [projectName, setProjectName] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [currency, setCurrency] = useState(mode === 'fa' ? 'IRT' : 'EUR');
  const [language, setLanguage] = useState<Lang>(mode === 'fa' ? 'fa' : 'de');
  const [discountMode, setDiscountMode] = useState<'NONE' | 'PERCENT' | 'FIXED'>('NONE');
  const [discountPct, setDiscountPct] = useState('');
  const [discountFixed, setDiscountFixed] = useState(0);
  const [taxRate, setTaxRate] = useState('');
  const [sellerTax, setSellerTax] = useState<{ status: string; rateBp: number }>({ status: 'MICRO', rateBp: 1000 });
  const [iranType, setIranType] = useState<1 | 2>(1);
  const [sellerMissing, setSellerMissing] = useState(false);
  const [advance, setAdvance] = useState(0);
  const [installments, setInstallments] = useState<{ key: number; due_date: string; amount_cents: number }[]>([]);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'issue' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const fail = (e: unknown) => { setErr(errorText(e, i18n)); setErrCode((e as { code?: string }).code ?? null); };
  const focusKey = useRef<number | null>(null);

  useEffect(() => {
    api.get<Template[]>('/templates?active=1').then(setTemplates).catch(() => {});
    api.get<{ iran_tax_status?: string; iran_vat_rate_bp?: number } | null>('/settings/seller')
      .then((s) => {
        setSellerMissing(!s);
        if (s) setSellerTax({ status: s.iran_tax_status ?? 'MICRO', rateBp: s.iran_vat_rate_bp ?? 1000 });
      }).catch(() => {});
    api.get<{ currency: string; invoice_language: string }>('/settings/general').then((g) => {
      if (g.currency) setCurrency(g.currency);
      if (g.invoice_language === 'fa' || g.invoice_language === 'de' || g.invoice_language === 'en') setLanguage(g.invoice_language);
    }).catch(() => {});
  }, []);

  // Preselect a customer from ?customer=<id> (palette / customer list).
  useEffect(() => {
    const id = params.get('customer');
    if (!id) return;
    api.get<{ customer: CustomerFull }>(`/customers/${id}`).then((d) => setCustomer(d.customer)).catch(() => {});
  }, [params]);

  // Focus the description of a freshly added line.
  useEffect(() => {
    if (focusKey.current == null) return;
    document.getElementById(`desc-${focusKey.current}`)?.focus();
    focusKey.current = null;
  }, [items]);

  const currencyOptions = mode === 'de' ? ['EUR'] : mode === 'fa' ? ['IRR', 'IRT', 'IRT_NEW'] : ['EUR', 'IRR', 'IRT', 'IRT_NEW'];
  const languageOptions: Lang[] = mode === 'de' ? ['de'] : mode === 'fa' ? ['fa'] : ['de', 'fa', 'en'];

  // ---- totals (mirror of the server's computation, for live feedback)
  const lineTotal = (it: Item) => Math.round((Number(normalizeQty(it.quantity)) || 0) * it.unit_price_cents) - it.discount_cents;
  const subtotal = items.reduce((a, it) => a + lineTotal(it), 0);
  const pct = Number(normalizeQty(discountPct)) || 0;
  const discountC = discountMode === 'PERCENT' ? Math.round((subtotal * pct) / 100) : discountMode === 'FIXED' ? Math.min(discountFixed, subtotal) : 0;
  const net = subtotal - discountC;
  // Toman/rial invoices follow Iranian VAT law: the rate comes from the
  // seller's registration (micro business → 0, VAT-registered → its rate).
  const iranCur = ['IRR', 'IRT', 'IRT_NEW'].includes(currency);
  const iranVat = iranCur && sellerTax.status === 'VAT_REGISTERED';
  const rate = iranCur ? (iranVat ? sellerTax.rateBp / 100 : 0) : Number(normalizeQty(taxRate)) || 0;
  const taxC = Math.round((net * rate) / 100);
  const grand = net + taxC;
  const due = grand - advance;
  const instSum = installments.reduce((a, i) => a + i.amount_cents, 0);
  const isKlein = rate === 0;

  const addLine = (p: Partial<Item> = {}) => {
    const it = newItem(p);
    if (!p.description) focusKey.current = it.key;
    setItems((prev) => [...prev, it]);
  };
  const update = (key: number, patch: Partial<Item>) => setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: number) => setItems((prev) => prev.filter((x) => x.key !== key));

  async function saveAsTemplate(it: Item) {
    if (!it.description.trim()) { setErr(t('ni.need_items')); return; }
    try {
      const tpl = await api.post<Template>('/templates', {
        name: it.description.trim().slice(0, 80), default_description: it.description.trim(),
        unit: it.unit, default_price_cents: it.unit_price_cents, is_active: true,
      });
      setTemplates((p) => [...p, tpl]);
      toast(t('ni.template_saved'));
    } catch (e) { fail(e); }
  }

  function buildBody() {
    const lines = items.filter((it) => it.description.trim());
    return {
      customer_id: customer!.id,
      project_name: projectName || undefined,
      invoice_date: invoiceDate || undefined,
      currency,
      invoice_language: language,
      tax_scenario: isKlein ? 'KLEINUNTERNEHMER_DE' : 'CUSTOM_TAX_SCENARIO',
      discount_mode: discountMode,
      discount_value: discountMode === 'PERCENT' ? Math.round(pct * 100) : discountMode === 'FIXED' ? discountFixed : 0,
      tax_rate_bp: Math.round(rate * 100),
      iran_invoice_type: iranVat ? iranType : undefined,
      advance_paid_cents: advance,
      installments: installments.filter((i) => i.amount_cents > 0).map(({ due_date, amount_cents }) => ({ due_date, amount_cents })),
      items: lines.map((it) => ({
        description: it.description.trim(), quantity_decimal: normalizeQty(it.quantity) || '1', unit: it.unit,
        unit_price_cents: it.unit_price_cents, discount_cents: it.discount_cents,
      })),
    };
  }

  /** Create the draft once, then update it in place on later saves. */
  async function persist(): Promise<string | null> {
    setErr(null);
    if (!customer) { setErr(t('ni.need_customer')); return null; }
    if (!items.some((it) => it.description.trim())) { setErr(t('ni.need_items')); return null; }
    const body = buildBody();
    if (invoiceId) { await api.put(`/invoices/${invoiceId}`, body); return invoiceId; }
    const d = await api.post<{ id: string }>('/invoices', body);
    setInvoiceId(d.id);
    return d.id;
  }

  async function saveDraft() {
    setBusy('draft');
    try { if (await persist()) toast(t('ni.draft_saved')); } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function issue() {
    setBusy('issue');
    try {
      const id = await persist();
      if (!id) return;
      await api.post(`/invoices/${id}/issue`);
      toast(t('det.issued'));
      nav(`/invoices/${id}`);
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  return (
    <div className="pb-28">
      <PageHeader title={t('ni.title')} subtitle={t('ni.subtitle')} />
      {sellerMissing && (
        <Alert tone="warning">{t('ni.seller_missing')} <Link to="/settings" className="font-semibold underline">{t('ni.go_settings')}</Link></Alert>
      )}
      {err && <Alert tone="danger" onClose={() => { setErr(null); setErrCode(null); }}>{err}
        {errCode === 'SELLER_INCOMPLETE' && <> <Link to="/settings" className="font-semibold underline">{t('ni.go_settings')}</Link></>}
      </Alert>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Customer */}
          <Section title={t('ni.step_customer')} icon="user">
            {customer ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary-fg">
                  <Icon name={customer.customer_type === 'PRIVATE' ? 'user' : 'building'} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{customerName(customer)}</div>
                  <div className="truncate text-sm text-muted">
                    <span className="font-mono" dir="ltr">{num(customer.customer_code)}</span>
                    {[customer.street, [customer.postal_code, customer.city].filter(Boolean).join(' ')].filter(Boolean).map((s) => ` · ${s}`)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-ghost btn-sm" onClick={() => setCustModal({ open: true, editId: customer.id })}><Icon name="pencil" />{t('common.edit')}</button>
                  <button className="btn-secondary btn-sm" onClick={() => setCustomer(null)}>{t('ni.change_customer')}</button>
                </div>
              </div>
            ) : (
              <CustomerCombobox autoFocus onSelect={(c) => {
                api.get<{ customer: CustomerFull }>(`/customers/${c.id}`).then((d) => setCustomer(d.customer)).catch(() => setCustomer(c as CustomerFull));
              }} onCreate={(q) => setCustModal({ open: true, prefill: q })} />
            )}
          </Section>

          {/* Line items */}
          <Section title={t('ni.items')} icon="package"
            actions={<>
              <TemplatePicker templates={templates} currency={currency} onPick={(tpl) => addLine({ description: tpl.default_description, unit: tpl.unit, unit_price_cents: tpl.default_price_cents })} />
              <button className="btn-primary btn-sm" onClick={() => addLine()}><Icon name="plus" />{t('ni.add_line')}</button>
            </>}>
            {items.length === 0 ? (
              <button onClick={() => addLine()} className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line px-4 py-8 text-sm text-muted transition-colors hover:border-primary hover:text-primary-fg">
                <Icon name="plus" className="h-5 w-5" />{t('ni.empty_items')} {t('ni.add_line')}
              </button>
            ) : (
              <div className="space-y-3">
                {items.map((it, idx) => (
                  <div key={it.key} className="rounded-lg border border-line p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">#{num(idx + 1)}</span>
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-sm btn-icon w-8" title={t('ni.save_template')} aria-label={t('ni.save_template')} onClick={() => void saveAsTemplate(it)}><Icon name="bookmark" /></button>
                        <button className="btn-ghost btn-sm btn-icon w-8 hover:text-danger" title={t('ni.remove_line')} aria-label={t('ni.remove_line')} onClick={() => remove(it.key)}><Icon name="trash" /></button>
                      </div>
                    </div>
                    <Field label={t('ni.description')} htmlFor={`desc-${it.key}`}>
                      <textarea id={`desc-${it.key}`} className="input min-h-[2.5rem] resize-y" rows={1} dir="auto" placeholder={t('ni.description_ph')}
                        value={it.description} onChange={(e) => update(it.key, { description: e.target.value })} />
                    </Field>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[minmax(4.5rem,0.7fr)_minmax(6rem,1fr)_minmax(7rem,1.3fr)_minmax(6rem,1.1fr)_minmax(8rem,1.5fr)]">
                      <Field label={t('ni.qty')} htmlFor={`qty-${it.key}`}>
                        <input id={`qty-${it.key}`} className="input tabular text-end" dir="ltr" inputMode="decimal" value={it.quantity}
                          onChange={(e) => update(it.key, { quantity: e.target.value })} />
                      </Field>
                      <Field label={t('ni.unit')} htmlFor={`unit-${it.key}`}>
                        <select id={`unit-${it.key}`} className="input" value={it.unit} onChange={(e) => update(it.key, { unit: e.target.value as Unit })}>
                          {UNITS.map((u) => <option key={u} value={u}>{tx(`unit.${u}`, u)}</option>)}
                        </select>
                      </Field>
                      <Field label={t('ni.unit_price')} htmlFor={`price-${it.key}`}>
                        <MoneyInput id={`price-${it.key}`} value={it.unit_price_cents} currency={currency} onChange={(v) => update(it.key, { unit_price_cents: v })} />
                      </Field>
                      <Field label={t('ni.line_discount')} htmlFor={`disc-${it.key}`}>
                        <MoneyInput id={`disc-${it.key}`} value={it.discount_cents} currency={currency} onChange={(v) => update(it.key, { discount_cents: v })} />
                      </Field>
                      <div className="col-span-2 sm:col-span-1">
                        <div className="label">{t('ni.line_total')}</div>
                        <div className="tabular flex h-10 items-center justify-end overflow-hidden whitespace-nowrap rounded-lg bg-surface-2 px-3 text-sm font-semibold max-sm:h-11" dir="ltr">{money(lineTotal(it), currency, lang)}</div>
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={() => addLine()} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-sm font-medium text-muted transition-colors hover:border-primary hover:text-primary-fg">
                  <Icon name="plus" />{t('ni.add_line')}
                </button>
              </div>
            )}
          </Section>

          {/* Extras */}
          <details className="card group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 font-semibold">
              {t('ni.extras')}
              <Icon name="chevronDown" className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-line px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('ni.discount_type')} htmlFor="dmode">
                  <select id="dmode" className="input" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as typeof discountMode)}>
                    <option value="NONE">{t('ni.discount_none')}</option>
                    <option value="PERCENT">{t('ni.discount_percent')}</option>
                    <option value="FIXED">{t('ni.discount_fixed')}</option>
                  </select>
                </Field>
                {discountMode === 'PERCENT' && (
                  <Field label={t('ni.discount_value_pct')} htmlFor="dpct">
                    <input id="dpct" className="input tabular text-end" dir="ltr" inputMode="decimal" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
                  </Field>
                )}
                {discountMode === 'FIXED' && (
                  <Field label={t('ni.discount_value_fixed')} htmlFor="dfix">
                    <MoneyInput id="dfix" value={discountFixed} currency={currency} onChange={setDiscountFixed} />
                  </Field>
                )}
                {!iranCur ? (
                  <Field label={t('ni.tax_rate')} hint={t('ni.tax_hint')} htmlFor="tax">
                    <input id="tax" className="input tabular text-end" dir="ltr" inputMode="decimal" placeholder="0" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                  </Field>
                ) : iranVat ? (
                  <Field label={t('ni.iran_type')} hint={t('ni.iran_vat_hint').replace('{rate}', num(sellerTax.rateBp / 100))} htmlFor="irtype">
                    <select id="irtype" className="input" value={iranType} onChange={(e) => setIranType(Number(e.target.value) === 2 ? 2 : 1)}>
                      <option value={1}>{t('ni.iran_type1')}</option>
                      <option value={2}>{t('ni.iran_type2')}</option>
                    </select>
                  </Field>
                ) : (
                  <Field label={t('ni.tax_rate')} htmlFor="tax-ir">
                    <p id="tax-ir" className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{t('ni.iran_micro')}</p>
                  </Field>
                )}
                <Field label={t('ni.advance_paid')} htmlFor="adv">
                  <MoneyInput id="adv" value={advance} currency={currency} onChange={setAdvance} />
                </Field>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{t('ni.installments')}</span>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setInstallments((p) => [...p, { key: keySeq++, due_date: '', amount_cents: Math.max(0, due - p.reduce((a, i) => a + i.amount_cents, 0)) }])}>
                    <Icon name="plus" />{t('ni.add_installment')}
                  </button>
                </div>
                <div className="space-y-2">
                  {installments.map((ins) => (
                    <div key={ins.key} className="flex flex-wrap items-center gap-2">
                      <input className="input w-44" type="date" aria-label={t('inv.due')} value={ins.due_date} onChange={(e) => setInstallments((p) => p.map((x) => x.key === ins.key ? { ...x, due_date: e.target.value } : x))} />
                      <div className="w-44"><MoneyInput ariaLabel={t('ni.installment_amount')} value={ins.amount_cents} currency={currency} onChange={(v) => setInstallments((p) => p.map((x) => x.key === ins.key ? { ...x, amount_cents: v } : x))} /></div>
                      <button type="button" className="btn-ghost btn-sm btn-icon w-8 hover:text-danger" aria-label={t('common.delete')} onClick={() => setInstallments((p) => p.filter((x) => x.key !== ins.key))}><Icon name="trash" /></button>
                    </div>
                  ))}
                </div>
                {installments.length > 0 && (
                  <p className={`hint ${instSum !== due ? 'text-warning' : ''}`}>{t('ni.installments_sum')}: {money(instSum, currency, lang)} / {t('ni.due')}: {money(due, currency, lang)}</p>
                )}
              </div>
            </div>
          </details>
        </div>

        {/* Sidebar: details + totals */}
        <div className="space-y-5">
          <Section title={t('ni.details')} icon="file">
            <div className="space-y-3">
              <Field label={t('ni.project')} htmlFor="proj">
                <input id="proj" className="input" dir="auto" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </Field>
              <Field label={t('ni.invoice_date')} hint={t('ni.invoice_date_hint')} htmlFor="idate">
                <input id="idate" className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 xl:grid-cols-2">
                <Field label={t('ni.currency')} htmlFor="cur">
                  <select id="cur" className="input" value={currency} disabled={currencyOptions.length < 2} onChange={(e) => setCurrency(e.target.value)}>
                    {currencyOptions.map((c) => <option key={c} value={c}>{tx(`cur.${c}`, c)}</option>)}
                  </select>
                </Field>
                <Field label={t('ni.language')} htmlFor="ilang">
                  <select id="ilang" className="input" value={language} disabled={languageOptions.length < 2} onChange={(e) => setLanguage(e.target.value as Lang)}>
                    {languageOptions.map((l) => <option key={l} value={l}>{t(`lang.${l}` as MsgKey)}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          </Section>

          <section className="card card-pad lg:sticky lg:top-20">
            <dl className="space-y-2 text-sm">
              <Row label={t('ni.subtotal')} value={money(subtotal, currency, lang)} />
              {discountC > 0 && <Row label={t('ni.discount')} value={`− ${money(discountC, currency, lang)}`} tone="danger" />}
              {taxC > 0 && <Row label={`${t('ni.tax')} (${num(rate)}%)`} value={money(taxC, currency, lang)} />}
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="font-semibold">{t('ni.total')}</dt>
                <dd className="tabular text-xl font-bold">{money(grand, currency, lang)}</dd>
              </div>
              {advance > 0 && <>
                <Row label={t('ni.advance')} value={`− ${money(advance, currency, lang)}`} tone="danger" />
                <Row label={t('ni.due')} value={money(due, currency, lang)} strong />
              </>}
            </dl>
            {iranCur && (
              <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
                {iranVat ? (iranType === 1 ? t('ni.iran_type1') : t('ni.iran_type2')) : t('ni.iran_micro')}
                {' · '}<a href="/settings" className="text-primary-fg hover:underline">{t('ni.iran_change')}</a>
              </p>
            )}
            {language === 'de' && currency === 'EUR' && isKlein && (
              <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted" dir="ltr" lang="de">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>
            )}
          </section>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:start-64">
        <div className="mx-auto grid max-w-6xl grid-cols-2 items-center gap-2 px-4 py-3 sm:flex sm:justify-end sm:px-6">
          <span className="me-auto hidden text-sm text-muted sm:inline">{t('ni.total')}: <b className="tabular text-fg">{money(grand, currency, lang)}</b></span>
          {invoiceId && <a className="btn-ghost max-sm:hidden" href={`/api/invoices/${invoiceId}/preview`} target="_blank" rel="noreferrer"><Icon name="eye" />{t('common.preview')}</a>}
          <button className="btn-secondary" onClick={saveDraft} disabled={!!busy}>{busy === 'draft' ? <Spinner /> : <Icon name="save" />}{t('ni.save_draft')}</button>
          <button className="btn-primary" onClick={issue} disabled={!!busy || !customer || items.length === 0}>{busy === 'issue' ? <Spinner /> : <Icon name="check" />}{busy === 'issue' ? t('ni.issuing') : t('ni.issue')}</button>
        </div>
      </div>

      <CustomerFormModal open={custModal.open} prefill={custModal.prefill} editId={custModal.editId ?? null}
        onClose={() => setCustModal({ open: false })}
        onSaved={(c) => {
          setCustModal({ open: false });
          toast(t('cust.saved'));
          api.get<{ customer: CustomerFull }>(`/customers/${c.id}`).then((d) => setCustomer(d.customer)).catch(() => setCustomer(c as CustomerFull));
        }} />
    </div>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: 'danger'; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${tone === 'danger' ? 'text-danger' : ''} ${strong ? 'font-bold' : ''}`}>
      <dt className={tone ? '' : 'text-muted'}>{label}</dt>
      <dd className="tabular whitespace-nowrap">{value}</dd>
    </div>
  );
}

/** Searchable template dropdown. */
function TemplatePicker({ templates, currency, onPick }: { templates: Template[]; currency: string; onPick: (t: Template) => void }) {
  const { t, tx, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  const shown = useMemo(() => {
    const nq = normalizeText(q);
    return templates.filter((x) => !nq || normalizeText(`${x.name} ${x.default_description} ${x.category ?? ''}`).includes(nq));
  }, [q, templates]);
  return (
    <div ref={ref} className="relative">
      <button className="btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="bookmark" />{t('ni.templates')}<Icon name="chevronDown" className="h-3.5 w-3.5" /></button>
      {open && (
        <div className="absolute end-0 z-30 mt-1 w-80 max-w-[85vw] rounded-xl border border-line bg-surface shadow-lg">
          <div className="border-b border-line p-2">
            <input className="input h-9" autoFocus placeholder={t('ni.template_search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {templates.length === 0 && <p className="px-3 py-3 text-sm text-muted">{t('ni.no_templates')}</p>}
            {shown.map((x) => (
              <button key={x.id} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                onClick={() => { onPick(x); setOpen(false); setQ(''); }}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{x.name}</span>
                  <span className="block text-xs text-muted">{tx(`unit.${x.unit}`, x.unit)}</span>
                </span>
                <span className="tabular whitespace-nowrap text-xs text-muted">{money(x.default_price_cents, currency, lang)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
