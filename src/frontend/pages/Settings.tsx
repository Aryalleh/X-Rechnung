import { useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { InstallMode, Lang, MsgKey } from '../i18n';
import { Alert, Badge, EmptyState, Field, Icon, Loading, Modal, Options, PageHeader, PasswordInput, Section, Spinner, useToast } from '../ui';
import type { IconName } from '../ui';

/* Labels for generic settings keys (per language). Unknown keys are humanized. */
const SETTING_LABELS: Record<Lang, Record<string, string>> = {
  fa: {
    app_name: 'نام برنامه', base_url: 'آدرس پایه', locale: 'زبان پیش‌فرض رابط', timezone: 'منطقه زمانی', date_format: 'قالب تاریخ', country: 'کشور', theme: 'پوسته', logo: 'لوگو',
    prefix_rechnung: 'پیشوند فاکتور', prefix_storno: 'پیشوند فاکتور ابطالی', prefix_gutschrift: 'پیشوند اعتبار برگشتی', number_digits: 'تعداد ارقام شماره', payment_days: 'مهلت پرداخت (روز)',
    payment_terms_text: 'متن شرایط پرداخت', thanks_text: 'متن تشکر', rights_text: 'متن حقوق استفاده', show_logo: 'نمایش لوگو', show_bank: 'نمایش اطلاعات بانکی', filename_pattern: 'الگوی نام فایل',
    invoice_language: 'زبان فاکتور', tax_exemption_text: 'متن معافیت مالیاتی', accent_color: 'رنگ تأکیدی', brand_heading: 'عنوان برند',
    inbound_enabled: 'دریافت فعال است', accept_xrechnung: 'پذیرش XRechnung', accept_zugferd: 'پذیرش ZUGFeRD', accept_pdf_plain: 'پذیرش PDF ساده', max_file_bytes: 'حداکثر حجم فایل (بایت)',
    kosit_url: 'آدرس Validator (KoSIT)', kosit_timeout_ms: 'مهلت Validator (میلی‌ثانیه)', kosit_retries: 'تعداد تلاش مجدد', retention_years: 'مدت نگهداری (سال)',
  },
  de: {
    app_name: 'App-Name', base_url: 'Basis-URL', locale: 'Standard-Oberflächensprache', timezone: 'Zeitzone', date_format: 'Datumsformat', country: 'Land', theme: 'Design', logo: 'Logo',
    prefix_rechnung: 'Präfix Rechnung', prefix_storno: 'Präfix Stornorechnung', prefix_gutschrift: 'Präfix Gutschrift', number_digits: 'Stellen der Nummer', payment_days: 'Zahlungsziel (Tage)',
    payment_terms_text: 'Zahlungsbedingungen', thanks_text: 'Dankestext', rights_text: 'Nutzungsrechte-Text', show_logo: 'Logo anzeigen', show_bank: 'Bankverbindung anzeigen', filename_pattern: 'Dateinamen-Muster',
    invoice_language: 'Rechnungssprache', tax_exemption_text: 'Steuerbefreiungstext', accent_color: 'Akzentfarbe', brand_heading: 'Markenüberschrift',
    inbound_enabled: 'Empfang aktiviert', accept_xrechnung: 'XRechnung annehmen', accept_zugferd: 'ZUGFeRD annehmen', accept_pdf_plain: 'Einfache PDFs annehmen', max_file_bytes: 'Max. Dateigröße (Bytes)',
    kosit_url: 'Validator-URL (KoSIT)', kosit_timeout_ms: 'Validator-Timeout (ms)', kosit_retries: 'Wiederholungen', retention_years: 'Aufbewahrung (Jahre)',
  },
  en: {
    app_name: 'App name', base_url: 'Base URL', locale: 'Default UI language', timezone: 'Time zone', date_format: 'Date format', country: 'Country', theme: 'Theme', logo: 'Logo',
    prefix_rechnung: 'Invoice prefix', prefix_storno: 'Cancellation prefix', prefix_gutschrift: 'Credit note prefix', number_digits: 'Number digits', payment_days: 'Payment terms (days)',
    payment_terms_text: 'Payment terms text', thanks_text: 'Thank-you text', rights_text: 'Usage rights text', show_logo: 'Show logo', show_bank: 'Show bank details', filename_pattern: 'File name pattern',
    invoice_language: 'Invoice language', tax_exemption_text: 'Tax exemption text', accent_color: 'Accent color', brand_heading: 'Brand heading',
    inbound_enabled: 'Receiving enabled', accept_xrechnung: 'Accept XRechnung', accept_zugferd: 'Accept ZUGFeRD', accept_pdf_plain: 'Accept plain PDF', max_file_bytes: 'Max file size (bytes)',
    kosit_url: 'Validator URL (KoSIT)', kosit_timeout_ms: 'Validator timeout (ms)', kosit_retries: 'Retries', retention_years: 'Retention (years)',
  },
};
const humanize = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const NAV: { to: string; key: MsgKey; icon: IconName }[] = [
  { to: '', key: 'set.seller', icon: 'user' },
  { to: 'currency', key: 'set.currency', icon: 'globe' },
  { to: 'invoice', key: 'set.invoice', icon: 'file' },
  { to: 'general', key: 'set.general', icon: 'settings' },
  { to: 'einvoice', key: 'set.einvoice', icon: 'inbox' },
  { to: 'users', key: 'set.users', icon: 'users' },
  { to: 'cloudflare', key: 'set.cloudflare', icon: 'globe' },
  { to: 'status', key: 'set.status', icon: 'activity' },
];

export function Settings() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t('set.title')} />
      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-56 lg:shrink-0">
          <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to || '.'} end
                className={({ isActive }) => `flex min-h-10 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 lg:whitespace-normal text-sm font-medium transition-colors ${isActive ? 'bg-primary-soft text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
                <Icon name={n.icon} className="h-4 w-4" />{t(n.key)}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <Routes>
            <Route index element={<SellerSettings />} />
            <Route path="currency" element={<CurrencySettings />} />
            <Route path="general" element={<GenericGroup title={t('set.general')} path="/settings/general" hide={['invoice_mode', 'currency', 'invoice_language']} />} />
            <Route path="invoice" element={<GenericGroup title={t('set.invoice')} path="/settings/invoice" />} />
            <Route path="einvoice" element={<GenericGroup title={t('set.einvoice')} path="/settings/einvoice" />} />
            <Route path="users" element={<><Users /><div className="mt-5"><GenericGroup title={t('team.email_title')} path="/settings/group/EMAIL_OUTBOUND" /></div></>} />
            <Route path="cloudflare" element={<GenericGroup title={t('set.cloudflare')} path="/settings/cloudflare" readOnly />} />
            <Route path="status" element={<SystemStatus />} />
            <Route path="*" element={<Navigate to="." replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

const SELLER_SECTIONS: { key: MsgKey; fields: string[] }[] = [
  { key: 'set.sec_person', fields: ['full_name', 'business_name', 'job_title'] },
  { key: 'set.sec_address', fields: ['street', 'postal_code', 'city', 'country', 'email', 'phone', 'website'] },
  { key: 'set.sec_tax', fields: ['steuernummer', 'ust_idnr', 'kleinunternehmer_id'] },
  { key: 'set.sec_bank', fields: ['account_holder', 'iban', 'bic', 'bank_name'] },
  { key: 'set.sec_bank_ir', fields: ['iran_account_holder', 'iran_bank_name', 'shaba', 'iran_card_number'] },
];
const SELLER_LTR = new Set(['shaba', 'iran_card_number', 'national_id', 'economic_code', 'tax_memory_id', 'email', 'website', 'iban', 'bic', 'ust_idnr', 'steuernummer', 'phone', 'postal_code', 'country', 'kleinunternehmer_id']);

function SellerSettings() {
  const i18n = useI18n();
  const { t, tx } = i18n;
  const toast = useToast();
  const [form, setForm] = useState<Record<string, string | number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const defaults = { iran_tax_status: 'MICRO', iran_vat_rate_bp: 1000, tax_exemption_text: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', invoice_number_prefix: 'RE', default_payment_days: 14, country: 'DE' };
    api.get<Record<string, string | number> | null>('/settings/seller').then((s) => setForm({ ...defaults, ...(s ?? {}) })).catch(() => setForm(defaults));
  }, []);

  async function save() {
    setErr(null); setBusy(true);
    try { await api.post('/settings/seller', form); toast(t('set.seller_saved')); }
    catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }
  if (!form) return <Loading />;
  const set = (k: string, v: string | number) => setForm({ ...form, [k]: v });

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-sm text-muted">{t('set.seller_sub')}</p>
      {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
      <Section title={t('set.sec_iran')}>
        <p className="mb-3 text-xs text-muted">{t('set.iran_sub')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="label">{t('f.iran_tax_status')}</legend>
            {(['MICRO', 'VAT_REGISTERED'] as const).map((v) => (
              <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${form.iran_tax_status === v ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                <input type="radio" name="iran_tax_status" className="mt-1 accent-[rgb(var(--primary))]" checked={form.iran_tax_status === v} onChange={() => set('iran_tax_status', v)} />
                <span><span className="block text-sm font-medium">{t(v === 'MICRO' ? 'set.iran_micro' : 'set.iran_vat')}</span>
                  <span className="block text-xs text-muted">{t(v === 'MICRO' ? 'set.iran_micro_hint' : 'set.iran_vat_hint')}</span></span>
              </label>
            ))}
          </fieldset>
          {(['national_id', 'economic_code', 'tax_memory_id'] as const).map((k) => (
            <Field key={k} label={t(`f.${k}`)} htmlFor={`s-${k}`} hint={k === 'national_id' ? t('f.national_id_hint') : undefined}>
              <input id={`s-${k}`} className="input tabular" dir="ltr" inputMode={k === 'tax_memory_id' ? 'text' : 'numeric'} value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
          {form.iran_tax_status === 'VAT_REGISTERED' && (
            <Field label={t('f.iran_vat_rate')} hint={t('f.iran_vat_rate_hint')} htmlFor="s-irrate">
              <input id="s-irrate" className="input tabular text-end" dir="ltr" inputMode="decimal" value={Number(form.iran_vat_rate_bp ?? 1000) / 100}
                onChange={(e) => set('iran_vat_rate_bp', Math.round((Number(e.target.value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(',', '.')) || 0) * 100))} />
            </Field>
          )}
        </div>
      </Section>
      {SELLER_SECTIONS.filter((s) => !(i18n.mode === 'fa' && s.key === 'set.sec_tax')).map((s) => (
        <Section key={s.key} title={t(s.key)}>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.fields.map((k) => (
              <Field key={k} label={tx(`f.${k}`, k)} htmlFor={`s-${k}`} className={k === 'street' ? 'sm:col-span-2' : ''}>
                <input id={`s-${k}`} className="input" dir={SELLER_LTR.has(k) ? 'ltr' : 'auto'} value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
              </Field>
            ))}
          </div>
        </Section>
      ))}
      <Section title={t('set.sec_invoice')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('f.default_payment_days')} htmlFor="s-days"><input id="s-days" className="input" dir="ltr" type="number" min={0} value={Number(form.default_payment_days ?? 14)} onChange={(e) => set('default_payment_days', Number(e.target.value))} /></Field>
          <Field label={t('f.invoice_number_prefix')} htmlFor="s-pre"><input id="s-pre" className="input" dir="ltr" value={String(form.invoice_number_prefix ?? 'RE')} onChange={(e) => set('invoice_number_prefix', e.target.value)} /></Field>
          <Field label={t('f.tax_exemption_text')} htmlFor="s-tax" className="sm:col-span-2">
            <textarea id="s-tax" className="input" rows={2} dir="ltr" lang="de" value={String(form.tax_exemption_text ?? '')} onChange={(e) => set('tax_exemption_text', e.target.value)} />
          </Field>
        </div>
      </Section>
      <SaveBar busy={busy} />
    </form>
  );
}

function SaveBar({ busy }: { busy: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end">
      <button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : <Icon name="check" />}{t('common.save')}</button>
    </div>
  );
}

function CurrencySettings() {
  const i18n = useI18n();
  const { t, tx, setMode } = i18n;
  const toast = useToast();
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const base = { invoice_mode: 'both', currency: 'EUR', invoice_language: 'de', redenomination_active: false, qeran_per_new_unit: 100, redenomination_effective_date: '' };
    api.get<Record<string, unknown>>('/settings/group/LOCALIZATION').then((d) => setCfg({ ...base, ...d })).catch(() => setCfg(base));
  }, []);
  if (!cfg) return <Loading />;
  const set = (k: string, v: unknown) => setCfg({ ...cfg, [k]: v });

  async function save() {
    setErr(null); setBusy(true);
    try {
      await api.put('/settings/group/LOCALIZATION', cfg);
      setMode(cfg!.invoice_mode as InstallMode); // UI language follows the profile immediately
      toast(t('common.saved'));
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
      <Section title={t('set.currency')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('set.mode')} hint={t('set.mode_hint')} htmlFor="c-mode" className="sm:col-span-3">
            <select id="c-mode" className="input" value={String(cfg.invoice_mode)} onChange={(e) => set('invoice_mode', e.target.value)}>
              <option value="both">{t('set.mode_both')}</option><option value="de">{t('set.mode_de')}</option><option value="fa">{t('set.mode_fa')}</option>
            </select>
          </Field>
          <Field label={t('set.default_currency')} htmlFor="c-cur">
            <select id="c-cur" className="input" value={String(cfg.currency)} onChange={(e) => set('currency', e.target.value)}>
              {['EUR', 'IRR', 'IRT', 'IRT_NEW'].map((c) => <option key={c} value={c}>{tx(`cur.${c}`, c)}</option>)}
            </select>
          </Field>
          <Field label={t('set.default_language')} htmlFor="c-lang">
            <select id="c-lang" className="input" value={String(cfg.invoice_language)} onChange={(e) => set('invoice_language', e.target.value)}>
              {(['de', 'fa', 'en'] as const).map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}
            </select>
          </Field>
        </div>
      </Section>
      <Section title={t('set.redenom_title')}>
        <Alert tone="warning">{t('set.redenom_note')}</Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={Boolean(cfg.redenomination_active)} onChange={(e) => set('redenomination_active', e.target.checked)} />
            {t('set.redenom_active')}
          </label>
          <Field label={t('set.qeran_per_unit')} htmlFor="c-q"><input id="c-q" className="input" dir="ltr" type="number" value={Number(cfg.qeran_per_new_unit ?? 100)} onChange={(e) => set('qeran_per_new_unit', Number(e.target.value))} /></Field>
          <Field label={t('set.redenom_date')} htmlFor="c-d"><input id="c-d" className="input" type="date" value={String(cfg.redenomination_effective_date ?? '')} onChange={(e) => set('redenomination_effective_date', e.target.value)} /></Field>
        </div>
      </Section>
      <SaveBar busy={busy} />
    </form>
  );
}

function GenericGroup({ title, path, readOnly, hide = [] }: { title: string; path: string; readOnly?: boolean; hide?: string[] }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setData(null); api.get<Record<string, unknown>>(path).then((d) => setData(d ?? {})).catch(() => setData({})); }, [path]);
  if (!data) return <Loading />;

  async function save() {
    setErr(null); setBusy(true);
    try { await api.put(path, data); toast(t('common.saved')); } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }
  const entries = Object.entries(data).filter(([k, v]) => !hide.includes(k) && (typeof v !== 'object' || v === null));
  const label = (k: string) => SETTING_LABELS[lang][k] ?? humanize(k);

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-5">
      {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
      <Section title={title}>
        {readOnly && <p className="mb-3 text-xs text-muted">{t('set.readonly_note')}</p>}
        {entries.length === 0 ? <EmptyState icon="settings" title={t('set.empty_group')} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {entries.map(([k, v]) => {
              const id = `g-${k}`;
              if (typeof v === 'boolean') {
                return (
                  <label key={k} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" disabled={readOnly} checked={v} onChange={(e) => setData({ ...data, [k]: e.target.checked })} />
                    {label(k)}
                  </label>
                );
              }
              const long = typeof v === 'string' && (v.length > 60 || k.endsWith('_text'));
              return (
                <Field key={k} label={label(k)} htmlFor={id} className={long ? 'sm:col-span-2' : ''}>
                  {long ? (
                    <textarea id={id} className="input" rows={2} dir="auto" readOnly={readOnly} value={String(v ?? '')} onChange={(e) => setData({ ...data, [k]: e.target.value })} />
                  ) : (
                    <input id={id} className="input" dir="ltr" readOnly={readOnly} type={typeof v === 'number' ? 'number' : 'text'} value={String(v ?? '')}
                      onChange={(e) => setData({ ...data, [k]: typeof v === 'number' ? Number(e.target.value) : e.target.value })} />
                  )}
                </Field>
              );
            })}
          </div>
        )}
      </Section>
      {!readOnly && entries.length > 0 && <SaveBar busy={busy} />}
    </form>
  );
}

const ROLES = ['ADMIN', 'ACCOUNTANT', 'READ_ONLY'] as const;
/** What each role may do (mirrors requireRole() checks on the server). */
const PERMS: Record<string, string[]> = {
  OWNER: ['FULL_ACCESS', 'MANAGE_USERS', 'ISSUE_INVOICE', 'MANAGE_CONTRACTS'],
  ADMIN: ['ISSUE_INVOICE', 'MANAGE_CUSTOMERS', 'MANAGE_CONTRACTS', 'SETTINGS'],
  ACCOUNTANT: ['ISSUE_INVOICE', 'MANAGE_CUSTOMERS', 'READ_REPORTS'],
  READ_ONLY: ['READ_REPORTS'],
};

function Users() {
  const i18n = useI18n();
  const { t, tx, date } = i18n;
  const toast = useToast();
  type Row = { id: string; email: string; full_name: string | null; role: string; status: string; last_login_at: string | null; has_password: number };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [me, setMe] = useState<{ email: string; role: string; hasPassword: boolean } | null>(null);
  const [form, setForm] = useState({ email: '', full_name: '', role: 'ADMIN', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pwFor, setPwFor] = useState<Row | null>(null);
  const load = () => api.get<Row[]>('/settings/users').then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); api.get<NonNullable<typeof me>>('/auth/me').then(setMe).catch(() => undefined); }, []);
  const isOwner = me?.role === 'OWNER';

  async function patch(r: Row, what: 'role' | 'status', value: string) {
    setErr(null);
    try { await api.put(`/settings/users/${r.id}/${what}`, { [what]: value }); toast(t('common.saved')); await load(); }
    catch (e) { setErr(errorText(e, i18n)); }
  }

  async function add() {
    setErr(null); setBusy(true);
    try {
      await api.post('/settings/users', form);
      setForm({ email: '', full_name: '', role: 'ADMIN', password: '' }); toast(t('common.saved')); await load();
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
      {me && <MyPassword hasPassword={me.hasPassword} onChanged={() => setMe({ ...me, hasPassword: true })} />}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="section-title">{t('team.members')}</h2>
          {isOwner && <a href="#invite" className="btn-primary btn-sm"><Icon name="plus" />{t('team.invite')}</a>}
        </div>
        {!rows ? <Loading /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr>
                <th>{t('team.user')}</th><th>{t('set.user_role')}</th><th className="max-xl:hidden">{t('team.permissions')}</th><th>{t('set.user_status')}</th>
                <th>{t('set.user_login')}</th><th className="max-sm:hidden">{t('set.user_last_login')}</th>
                {isOwner && <th><span className="sr-only">{t('set.user_set_pw')}</span></th>}
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-fg">{(r.full_name || r.email).slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0">
                        {r.full_name && <div className="truncate font-medium" dir="auto">{r.full_name}</div>}
                        <div className="truncate text-xs text-muted" dir="ltr">{r.email}{me?.email === r.email ? ` · ${t('team.you')}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {isOwner && r.role !== 'OWNER' ? (
                      <select className="input h-9 w-auto py-0" aria-label={`${t('set.user_role')}: ${r.email}`} value={r.role} onChange={(e) => void patch(r, 'role', e.target.value)}>
                        <Options values={ROLES} prefix="role." />
                      </select>
                    ) : tx(`role.${r.role}`, r.role)}
                  </td>
                  <td className="max-xl:hidden">
                    <div className="flex max-w-[18rem] flex-wrap gap-1">
                      {(PERMS[r.role] ?? []).map((p) => <span key={p} className="whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted" title={p}>{t(`perm.${p}` as MsgKey)}</span>)}
                    </div>
                  </td>
                  <td>
                    {isOwner && me?.email !== r.email ? (
                      <button className={`badge ${r.status === 'ACTIVE' ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'} hover:ring-1 hover:ring-line-strong`}
                        title={r.status === 'ACTIVE' ? t('team.disable') : t('team.enable')}
                        onClick={() => void patch(r, 'status', r.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}>{tx(`ustatus.${r.status}`, r.status)}</button>
                    ) : <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>{tx(`ustatus.${r.status}`, r.status)}</Badge>}
                  </td>
                  <td><Badge tone={r.has_password ? 'success' : 'warning'}>{t(r.has_password ? 'set.user_has_pw' : 'set.user_no_pw')}</Badge></td>
                  <td className="max-sm:hidden text-muted">{r.last_login_at ? date(r.last_login_at) : '—'}</td>
                  {isOwner && (
                    <td className="text-end">
                      <button className="btn-secondary h-9 whitespace-nowrap" onClick={() => setPwFor(r)}><Icon name="lock" />{t('set.user_set_pw')}</button>
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {isOwner && (
        <div id="invite" className="scroll-mt-24">
        <Section title={t('set.users_add')}>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <Field label={t('set.user_email')} htmlFor="u-e"><input id="u-e" type="email" required className="input" dir="ltr" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={t('set.user_name')} htmlFor="u-n"><input id="u-n" className="input" dir="auto" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
            <Field label={t('set.user_role')} htmlFor="u-r"><select id="u-r" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><Options values={ROLES} prefix="role." /></select></Field>
            <Field label={t('set.user_password')} htmlFor="u-p">
              <PasswordInput id="u-p" value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete="new-password" minLength={10} />
            </Field>
            <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">{t('set.pw_hint')}</p>
            <button className="btn-primary justify-center" disabled={busy}>{busy ? <Spinner /> : <Icon name="plus" />}{t('set.users_add')}</button>
          </form>
        </Section>
        </div>
      )}
      <section className="card card-pad">
        <h2 className="section-title mb-2 flex items-center gap-2"><Icon name="info" className="h-4 w-4 text-muted" />{t('team.logic_title')}</h2>
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
          <li>{t('team.logic_1')}</li>
          <li>{t('team.logic_2')}</li>
          <li>{t('team.logic_3')}</li>
        </ul>
      </section>
      {pwFor && <SetUserPassword row={pwFor} onClose={() => setPwFor(null)} onSaved={() => { setPwFor(null); toast(t('set.pw_set')); void load(); }} />}
    </div>
  );
}

/** Change own password (current password required once one is set). */
function MyPassword({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mismatch = Boolean(f.confirm && f.confirm !== f.next);

  async function save() {
    if (f.next !== f.confirm) { setErr(t('set.pw_mismatch')); return; }
    setErr(null); setBusy(true);
    try {
      await api.post('/auth/password', { current_password: f.current || undefined, new_password: f.next });
      setF({ current: '', next: '', confirm: '' }); toast(t('set.pw_changed')); onChanged();
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }

  return (
    <Section title={t('set.my_password')} icon="lock">
      <p className="mb-3 text-xs text-muted">{t('set.my_password_sub')}</p>
      {err && <div className="mb-3" role="alert"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
      <form className="grid gap-3 sm:grid-cols-3 sm:items-start" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {hasPassword && (
          <Field label={t('set.pw_current')} htmlFor="mp-c">
            <PasswordInput id="mp-c" value={f.current} onChange={(v) => setF({ ...f, current: v })} autoComplete="current-password" required />
          </Field>
        )}
        <Field label={t('set.pw_new')} htmlFor="mp-n" hint={t('set.pw_hint')}>
          <PasswordInput id="mp-n" value={f.next} onChange={(v) => setF({ ...f, next: v })} autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label={t('set.pw_confirm')} htmlFor="mp-r" error={mismatch ? t('set.pw_mismatch') : undefined}>
          <PasswordInput id="mp-r" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} autoComplete="new-password" required minLength={10} invalid={mismatch} />
        </Field>
        <div className="flex justify-end sm:col-span-3">
          <button className="btn-primary" disabled={busy || !f.next || mismatch}>{busy ? <Spinner /> : <Icon name="check" />}{t('set.pw_change')}</button>
        </div>
      </form>
    </Section>
  );
}

/** Owner sets / resets another user's password (signs that user out). */
function SetUserPassword({ row, onClose, onSaved }: { row: { id: string; email: string }; onClose: () => void; onSaved: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mismatch = Boolean(pw2 && pw2 !== pw);
  async function save() {
    if (pw !== pw2) { setErr(t('set.pw_mismatch')); return; }
    setErr(null); setBusy(true);
    try { await api.put(`/settings/users/${row.id}/password`, { password: pw }); onSaved(); }
    catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={t('set.user_set_pw_title', { email: row.email })}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn-primary" form="set-user-pw" disabled={busy || !pw || mismatch}>{busy ? <Spinner /> : <Icon name="lock" />}{t('common.save')}</button>
      </>}>
      <form id="set-user-pw" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {err && <div role="alert"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
        <Field label={t('set.pw_new')} htmlFor="sp-n" hint={t('set.pw_hint')}>
          <PasswordInput id="sp-n" value={pw} onChange={setPw} autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label={t('set.pw_confirm')} htmlFor="sp-r" error={mismatch ? t('set.pw_mismatch') : undefined}>
          <PasswordInput id="sp-r" value={pw2} onChange={setPw2} autoComplete="new-password" required minLength={10} invalid={mismatch} />
        </Field>
      </form>
    </Modal>
  );
}

function SystemStatus() {
  const { t } = useI18n();
  const [data, setData] = useState<{ items: Record<string, string> } | null>(null);
  useEffect(() => { api.get<{ items: Record<string, string> }>('/system/status').then(setData).catch(() => setData({ items: {} })); }, []);
  if (!data) return <Loading />;
  const tone = (s: string) => (s === 'OK' ? 'success' : s === 'WARNING' ? 'warning' : s === 'ERROR' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';
  return (
    <Section title={t('set.status')}>
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(data.items).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5">
            <span className="truncate text-sm" dir="ltr">{humanize(k)}</span><Badge tone={tone(v)}>{v}</Badge>
          </div>
        ))}
      </div>
    </Section>
  );
}
