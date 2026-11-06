import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { Lang, MsgKey } from '../i18n';
import { convertPrice, marketOf, money, normalizeQty } from '../currency';
import { normalizeText } from '../../lib/search';
import { Alert, Field, Icon, MoneyInput, Spinner, TopBar, useToast } from '../ui';
import { CustomerCombobox, customerName } from '../components/CustomerSearch';
import type { CustomerHit } from '../components/CustomerSearch';
import { CustomerFormModal } from './Customers';

const UNITS = ['Stunde', 'Tag', 'Pauschale', 'Stück', 'Kilometer', 'Projekt', 'Minute'] as const;
type Unit = (typeof UNITS)[number];

interface Template { id: string; name: string; default_description: string; unit: Unit; default_price_cents: number; category: string | null; market: 'DE' | 'IR'; currency: string }
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
  const [projectNumber, setProjectNumber] = useState('');
  const [poRef, setPoRef] = useState('');
  const [contractRef, setContractRef] = useState('');
  const [contracts, setContracts] = useState<{ id: string; contract_number: string; title: string; status: string; customer_id: string | null }[]>([]);
  const [terms, setTerms] = useState<'default' | '0' | '14' | '30' | 'custom'>('default');
  const [customDue, setCustomDue] = useState('');
  const [defaultDays, setDefaultDays] = useState(14);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [zoom, setZoom] = useState(0.6);
  const [instOn, setInstOn] = useState(false);
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
    api.get<{ id: string; contract_number: string; title: string; status: string; customer_id: string | null }[]>('/contracts').then(setContracts).catch(() => {});
    api.get<{ iran_tax_status?: string; iran_vat_rate_bp?: number; default_payment_days?: number } | null>('/settings/seller')
      .then((s) => {
        setSellerMissing(!s);
        if (typeof s?.default_payment_days === 'number') setDefaultDays(s.default_payment_days);
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
        currency, // → German (EUR) or Persian (rial/toman) template list
      });
      setTemplates((p) => [...p, tpl]);
      toast(t('ni.template_saved'));
    } catch (e) { fail(e); }
  }

  // Due date from the chosen payment term (relative to the invoice date, or today when issued now).
  const dueDate = (() => {
    if (terms === 'default') return undefined;
    if (terms === 'custom') return customDue || undefined;
    const base = invoiceDate ? new Date(`${invoiceDate}T12:00:00Z`) : new Date();
    return new Date(base.getTime() + Number(terms) * 86_400_000).toISOString().slice(0, 10);
  })();
  const signedContracts = contracts.filter((c) => (c.status === 'SIGNED' || c.status === 'CUSTOMER_SIGNED') && (!customer || c.customer_id === customer.id));

  function buildBody() {
    const lines = items.filter((it) => it.description.trim());
    return {
      customer_id: customer!.id,
      project_name: projectName || undefined,
      project_number: projectNumber.trim() || undefined,
      purchase_order_reference: poRef.trim() || undefined,
      contract_reference: contractRef || undefined,
      due_date: dueDate,
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
    try { if (await persist()) { toast(t('ni.draft_saved')); setPreviewKey((k) => k + 1); } } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function refreshPreview() {
    setPreviewOpen(true);
    setBusy('draft');
    try { if (await persist()) setPreviewKey((k) => k + 1); } catch (e) { fail(e); } finally { setBusy(null); }
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

  const canSave = !!customer && items.some((it) => it.description.trim());
  return (
    <div className="-mx-4 -my-6 sm:-mx-8 sm:-my-8">
      <TopBar back="/invoices" title={t('ni.title')}
        actions={<>
          <button className="btn-secondary" onClick={saveDraft} disabled={!!busy}>{busy === 'draft' ? <Spinner /> : <Icon name="save" className="sm:hidden" />}<span className="max-sm:hidden">{t('ni.save_draft')}</span></button>
          <button className="btn-primary" onClick={issue} disabled={!!busy || !customer || items.length === 0}>
            <span className="max-sm:hidden">{busy === 'issue' ? t('ni.issuing') : t('ni.review_issue')}</span>{busy === 'issue' ? <Spinner /> : <Icon name="send" flip />}
          </button>
        </>} />

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6 px-4 py-6 sm:px-8 sm:py-8">
          {sellerMissing && (
            <Alert tone="warning">{t('ni.seller_missing')} <Link to="/settings" className="font-semibold underline">{t('ni.go_settings')}</Link></Alert>
          )}
          {err && <Alert tone="danger" onClose={() => { setErr(null); setErrCode(null); }}>{err}
            {errCode === 'SELLER_INCOMPLETE' && <> <Link to="/settings" className="font-semibold underline">{t('ni.go_settings')}</Link></>}
          </Alert>}

          <NumSection n={1} title={t('ni.sec_customer')}>
            <div className="label">{t('ni.select_customer')}</div>
            {customer ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-primary-fg shadow-sm">
                  <Icon name={customer.customer_type === 'PRIVATE' ? 'user' : 'building'} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold"><bdi>{customerName(customer)}</bdi></div>
                  <div className="truncate text-xs text-muted">
                    <span className="font-mono" dir="ltr">{num(customer.customer_code)}</span>
                    {[customer.street, [customer.postal_code, customer.city].filter(Boolean).join(' ')].filter(Boolean).map((x) => ` · ${x}`)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost btn-sm" onClick={() => setCustModal({ open: true, editId: customer.id })}><Icon name="pencil" />{t('common.edit')}</button>
                  <button className="btn-secondary btn-sm" onClick={() => setCustomer(null)}>{t('ni.change_customer')}</button>
                </div>
              </div>
            ) : (
              <CustomerCombobox autoFocus onSelect={(c) => {
                api.get<{ customer: CustomerFull }>(`/customers/${c.id}`).then((d) => setCustomer(d.customer)).catch(() => setCustomer(c as CustomerFull));
              }} onCreate={(q) => setCustModal({ open: true, prefill: q })} />
            )}
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label={t('ni.contract_link')} htmlFor="ctr-link" className="sm:col-span-2">
                <select id="ctr-link" className="input" value={contractRef} disabled={!customer} onChange={(e) => {
                  setContractRef(e.target.value);
                  const c = signedContracts.find((x) => x.contract_number === e.target.value);
                  if (c && !projectName) setProjectName(c.title);
                }}>
                  <option value="">{t('ni.no_contract')}</option>
                  {signedContracts.map((c) => <option key={c.id} value={c.contract_number}>{c.title} ({c.contract_number})</option>)}
                </select>
                {contractRef ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-success"><Icon name="check" className="h-3.5 w-3.5" />{t('ni.contract_linked')}</p>
                ) : customer && !signedContracts.length ? <p className="hint">{t('ni.no_signed_contracts')}</p> : null}
              </Field>
              <Field label={t('ni.project_code')} htmlFor="proj-no">
                <input id="proj-no" className="input" dir="ltr" placeholder={t('common.optional')} value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} maxLength={60} />
              </Field>
              <Field label={t('ni.po')} htmlFor="po">
                <input id="po" className="input" dir="ltr" placeholder={t('common.optional')} value={poRef} onChange={(e) => setPoRef(e.target.value)} maxLength={120} />
              </Field>
            </div>
          </NumSection>

          <NumSection n={2} title={t('ni.sec_details')}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t('ni.invoice_number')} htmlFor="inv-no">
                <input id="inv-no" className="input text-muted" readOnly value={t('ni.number_auto')} />
              </Field>
              <Field label={t('ni.invoice_date')} htmlFor="idate">
                <input id="idate" className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </Field>
              <Field label={t('inv.due')} htmlFor="terms" hint={dueDate ? i18n.date(dueDate) : t('ni.terms_default_hint', { n: defaultDays })}>
                <select id="terms" className="input" value={terms} onChange={(e) => setTerms(e.target.value as typeof terms)}>
                  <option value="default">{t('ni.terms_default', { n: defaultDays })}</option>
                  <option value="14">{t('ni.terms_net', { n: 14 })}</option>
                  <option value="30">{t('ni.terms_net', { n: 30 })}</option>
                  <option value="0">{t('ni.terms_receipt')}</option>
                  <option value="custom">{t('ni.terms_custom')}</option>
                </select>
              </Field>
              {terms === 'custom' ? (
                <Field label={t('inv.due')} htmlFor="due-custom">
                  <input id="due-custom" className="input" type="date" min={invoiceDate || undefined} value={customDue} onChange={(e) => setCustomDue(e.target.value)} />
                </Field>
              ) : (
                <Field label={t('ni.currency')} htmlFor="cur">
                  <select id="cur" className="input" value={currency} disabled={currencyOptions.length < 2} onChange={(e) => setCurrency(e.target.value)}>
                    {currencyOptions.map((c) => <option key={c} value={c}>{tx(`cur.${c}`, c)}</option>)}
                  </select>
                </Field>
              )}
              {terms === 'custom' && (
                <Field label={t('ni.currency')} htmlFor="cur">
                  <select id="cur" className="input" value={currency} disabled={currencyOptions.length < 2} onChange={(e) => setCurrency(e.target.value)}>
                    {currencyOptions.map((c) => <option key={c} value={c}>{tx(`cur.${c}`, c)}</option>)}
                  </select>
                </Field>
              )}
              <Field label={t('ni.project')} htmlFor="proj">
                <input id="proj" className="input" dir="auto" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </Field>
              <Field label={t('ni.language')} htmlFor="ilang">
                <select id="ilang" className="input" value={language} disabled={languageOptions.length < 2} onChange={(e) => setLanguage(e.target.value as Lang)}>
                  {languageOptions.map((l) => <option key={l} value={l}>{t(`lang.${l}` as MsgKey)}</option>)}
                </select>
              </Field>
            </div>
          </NumSection>

          <NumSection n={3} title={t('ni.sec_items')}
            actions={<TemplatePicker templates={templates} currency={currency} onPick={(tpl) => addLine({ description: tpl.default_description, unit: tpl.unit, unit_price_cents: convertPrice(tpl.default_price_cents, tpl.currency, currency) })} />}>
            <div className="space-y-4">
              {items.map((it, idx) => (
                <div key={it.key} className="group rounded-lg border border-line p-4">
                  <div className="flex items-start gap-3">
                    <Field label={idx === 0 ? t('ni.description') : `${t('ni.description')} ${num(idx + 1)}`} htmlFor={`desc-${it.key}`} className="flex-1">
                      <textarea id={`desc-${it.key}`} className="input min-h-[2.5rem] resize-y" rows={1} dir="auto" placeholder={t('ni.description_ph')}
                        value={it.description} onChange={(e) => update(it.key, { description: e.target.value })} />
                    </Field>
                    <div className="flex gap-1 pt-6">
                      <button className="btn-ghost btn-icon h-10 w-9" title={t('ni.save_template')} aria-label={t('ni.save_template')} onClick={() => void saveAsTemplate(it)}><Icon name="bookmark" /></button>
                      <button className="btn-ghost btn-icon h-10 w-9 hover:text-danger" title={t('ni.remove_line')} aria-label={t('ni.remove_line')} onClick={() => remove(it.key)}><Icon name="trash" /></button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[minmax(4rem,0.6fr)_minmax(5.5rem,0.9fr)_minmax(7rem,1.3fr)_minmax(6rem,1fr)_minmax(7rem,1.2fr)]">
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
                      <div className="tabular flex h-10 items-center justify-end overflow-hidden whitespace-nowrap px-1 text-sm font-semibold max-sm:h-11" dir="ltr">{money(lineTotal(it), currency, lang)}</div>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={() => addLine()} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line text-sm font-semibold text-muted transition-colors hover:border-primary hover:text-primary-fg">
                <Icon name="plus" />{t('ni.add_new_line')}
              </button>
            </div>
          </NumSection>

          <NumSection n={4} title={t('ni.sec_adjust')}>
            <div className="grid gap-5 sm:grid-cols-3">
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
                  <p id="tax-ir" className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{t('ni.iran_micro')}</p>
                </Field>
              )}
              <Field label={t('ni.discount_type')} htmlFor="dmode">
                <div className="flex gap-2">
                  <select id="dmode" className="input w-auto shrink-0" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as typeof discountMode)}>
                    <option value="NONE">{t('ni.discount_none')}</option>
                    <option value="PERCENT">%</option>
                    <option value="FIXED">{tx(`cur.${currency}`, currency).split(' ')[0]}</option>
                  </select>
                  {discountMode === 'PERCENT' && <input className="input tabular text-end" aria-label={t('ni.discount_value_pct')} dir="ltr" inputMode="decimal" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />}
                  {discountMode === 'FIXED' && <MoneyInput ariaLabel={t('ni.discount_value_fixed')} value={discountFixed} currency={currency} onChange={setDiscountFixed} />}
                </div>
              </Field>
              <Field label={t('ni.advance_paid')} htmlFor="adv">
                <MoneyInput id="adv" value={advance} currency={currency} onChange={setAdvance} />
              </Field>
            </div>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-2 p-4">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" checked={instOn || installments.length > 0}
                onChange={(e) => { setInstOn(e.target.checked); if (!e.target.checked) setInstallments([]); }} />
              <span>
                <span className="block text-sm font-semibold">{t('ni.enable_installments')}</span>
                <span className="block text-xs text-muted">{t('ni.installments_hint')}</span>
              </span>
            </label>
            {(instOn || installments.length > 0) && (
              <div className="mt-3 space-y-2">
                {installments.map((ins) => (
                  <div key={ins.key} className="flex flex-wrap items-center gap-2">
                    <input className="input w-44" type="date" aria-label={t('inv.due')} value={ins.due_date} onChange={(e) => setInstallments((p) => p.map((x) => x.key === ins.key ? { ...x, due_date: e.target.value } : x))} />
                    <div className="w-44"><MoneyInput ariaLabel={t('ni.installment_amount')} value={ins.amount_cents} currency={currency} onChange={(v) => setInstallments((p) => p.map((x) => x.key === ins.key ? { ...x, amount_cents: v } : x))} /></div>
                    <button type="button" className="btn-ghost btn-sm btn-icon w-8 hover:text-danger" aria-label={t('common.delete')} onClick={() => setInstallments((p) => p.filter((x) => x.key !== ins.key))}><Icon name="trash" /></button>
                  </div>
                ))}
                <button type="button" className="btn-secondary btn-sm" onClick={() => setInstallments((p) => [...p, { key: keySeq++, due_date: '', amount_cents: Math.max(0, due - p.reduce((a, i) => a + i.amount_cents, 0)) }])}>
                  <Icon name="plus" />{t('ni.add_installment')}
                </button>
                {installments.length > 0 && (
                  <p className={`hint ${instSum !== due ? 'text-warning' : ''}`}>{t('ni.installments_sum')}: {money(instSum, currency, lang)} / {t('ni.due')}: {money(due, currency, lang)}</p>
                )}
              </div>
            )}

            <dl className="mt-6 space-y-2 border-t border-line pt-5 text-sm">
              <Row label={t('ni.subtotal')} value={money(subtotal, currency, lang)} />
              {discountC > 0 && <Row label={t('ni.discount')} value={`− ${money(discountC, currency, lang)}`} tone="danger" />}
              {taxC > 0 && <Row label={`${t('ni.tax')} (${num(rate)}%)`} value={money(taxC, currency, lang)} />}
              <div className="flex items-baseline justify-between pt-2">
                <dt className="font-semibold">{t('ni.total')}</dt>
                <dd className="tabular text-2xl font-bold text-primary-fg">{money(grand, currency, lang)}</dd>
              </div>
              {advance > 0 && <>
                <Row label={t('ni.advance')} value={`− ${money(advance, currency, lang)}`} tone="danger" />
                <Row label={t('ni.due')} value={money(due, currency, lang)} strong />
              </>}
            </dl>
            {iranCur && (
              <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                {iranVat ? (iranType === 1 ? t('ni.iran_type1') : t('ni.iran_type2')) : t('ni.iran_micro')}
                {' · '}<a href="/settings" className="text-primary-fg hover:underline">{t('ni.iran_change')}</a>
              </p>
            )}
            {language === 'de' && currency === 'EUR' && isKlein && (
              <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted" dir="ltr" lang="de">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>
            )}
          </NumSection>
        </div>

        {/* Live preview pane */}
        <aside className="border-line bg-surface-2 xl:sticky xl:top-16 xl:h-[calc(100vh-4rem)] xl:border-s">
          <div className="flex h-14 items-center justify-between gap-2 border-b border-line bg-surface px-6">
            <span className="eyebrow flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />{t('ni.live_preview')}</span>
            <div className="flex items-center gap-1">
              <button className="btn-ghost btn-icon h-8 w-8" aria-label={t('ni.zoom_out')} onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(1)))}><Icon name="zoomOut" /></button>
              <span className="tabular w-12 text-center text-xs font-medium text-muted">{num(Math.round(zoom * 100))}%</span>
              <button className="btn-ghost btn-icon h-8 w-8" aria-label={t('ni.zoom_in')} onClick={() => setZoom((z) => Math.min(1.2, +(z + 0.1).toFixed(1)))}><Icon name="zoomIn" /></button>
              <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
              <button className="btn-ghost btn-sm" onClick={() => void refreshPreview()} disabled={!!busy || !canSave} title={t('ni.preview_refresh')}>
                {busy === 'draft' ? <Spinner /> : <Icon name="activity" />}<span className="max-sm:hidden">{previewOpen ? t('ni.preview_refresh') : t('ni.preview_show')}</span>
              </button>
            </div>
          </div>
          <div className="overflow-auto p-6 xl:h-[calc(100%-3.5rem)]">
            {previewOpen && invoiceId ? (
              <div className="mx-auto overflow-hidden rounded bg-white shadow-lg" style={{ width: 794 * zoom, height: 1123 * zoom }}>
                <iframe key={previewKey} title={t('ni.live_preview')} src={`/api/invoices/${invoiceId}/preview?v=${previewKey}`} sandbox="allow-same-origin"
                  style={{ width: 794, height: 1123, transform: `scale(${zoom})`, transformOrigin: '0 0', border: 0 }} />
              </div>
            ) : (
              <div className="mx-auto flex flex-col items-center justify-center gap-3 rounded bg-surface p-8 text-center shadow-sm" style={{ width: 794 * zoom, minHeight: 1123 * zoom, maxWidth: '100%' }}>
                <Icon name="file" className="h-10 w-10 text-line-strong" />
                <p className="max-w-xs text-sm text-muted">{t('ni.preview_hint')}</p>
                <button className="btn-secondary btn-sm" onClick={() => void refreshPreview()} disabled={!!busy || !canSave}><Icon name="eye" />{t('ni.preview_show')}</button>
              </div>
            )}
          </div>
        </aside>
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

function NumSection({ n, title, actions, children }: { n: number; title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const { num } = useI18n();
  return (
    <section className="card p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{num(n)}. {title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
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
  const { t, tx, lang, num: i18nNum } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  // German templates on EUR invoices, Persian ones on rial/toman invoices — never mixed.
  const market = marketOf(currency);
  const mine = useMemo(() => templates.filter((x) => (x.market ?? 'DE') === market), [templates, market]);
  const shown = useMemo(() => {
    const nq = normalizeText(q);
    return mine.filter((x) => !nq || normalizeText(`${x.name} ${x.default_description} ${x.category ?? ''}`).includes(nq));
  }, [q, mine]);
  return (
    <div ref={ref} className="relative">
      <button className="btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="bookmark" />{t('ni.templates')}<Icon name="chevronDown" className="h-3.5 w-3.5" /></button>
      {open && (
        <div className="absolute end-0 z-30 mt-1 w-80 max-w-[85vw] rounded-xl border border-line bg-surface shadow-lg">
          <div className="border-b border-line p-2">
            <div className="mb-2 flex items-center justify-between px-1 text-xs text-muted">
              <span className="font-medium text-fg">{t(market === 'IR' ? 'ni.templates_ir' : 'ni.templates_de')}</span>
              <span className="tabular">{i18nNum(mine.length)}</span>
            </div>
            <input className="input h-9" autoFocus placeholder={t('ni.template_search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {mine.length === 0 && <p className="px-3 py-3 text-sm text-muted">{t(market === 'IR' ? 'ni.no_templates_ir' : 'ni.no_templates')}</p>}
            {shown.map((x) => (
              <button key={x.id} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                onClick={() => { onPick(x); setOpen(false); setQ(''); }}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{x.name}</span>
                  <span className="block text-xs text-muted">{tx(`unit.${x.unit}`, x.unit)}</span>
                </span>
                <span className="tabular whitespace-nowrap text-xs text-muted">{money(convertPrice(x.default_price_cents, x.currency, currency), currency, lang)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
