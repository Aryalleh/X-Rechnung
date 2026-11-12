import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { formatDateFor } from '../../lib/format';
import { missingFields, type FieldDef } from '../../lib/contract-doc';
import { ContractDoc } from '../components/ContractDoc';
import { SignaturePad } from '../components/SignaturePad';
import { Icon, Logo, Spinner } from '../ui';

type L = 'de' | 'en' | 'fa';
interface View {
  contract_number: string; title: string; language: L; status: string; body: string; fields: FieldDef[]; content_hash: string | null;
  seller: Record<string, string | null>; customer: Record<string, string | null>;
  seller_signer_name: string | null; seller_signature: string | null; seller_signed_at: string | null;
  customer_signed: boolean; signed: boolean; signer_name: string | null; signed_at: string | null; signature: string | null;
  field_values: Record<string, string | boolean>; accent_color: string; brand: string; expires_at: string | null;
}

const T = {
  de: {
    loading: 'Vertrag wird geladen…', invalid: 'Dieser Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen Link an.',
    from: 'Vertrag von', progress: '{a} von {b} Feldern ausgefüllt', provider: 'Auftragnehmer', client: 'Auftraggeber',
    signHead: 'Unterschreiben', name: 'Vollständiger Name', email: 'E-Mail (für Ihre Kopie, optional)', signature: 'Ihre Unterschrift',
    consent: 'Ich habe den Vertrag gelesen und unterschreibe ihn elektronisch. Mir ist bewusst, dass diese elektronische Unterschrift rechtsverbindlich ist.',
    submit: 'Verbindlich unterschreiben', missing: 'Bitte füllen Sie noch aus:', needSig: 'Bitte unterschreiben Sie im Feld.', needConsent: 'Bitte bestätigen Sie die Einwilligung.',
    doneTitle: 'Vielen Dank – der Vertrag ist unterschrieben.', doneSub: 'Beide Parteien haben unterschrieben. Laden Sie Ihre Kopie herunter.',
    waitTitle: 'Vielen Dank – Ihre Unterschrift ist gespeichert.', waitSub: '{p} unterschreibt jetzt gegen. Danach können Sie hier das vollständig unterschriebene PDF herunterladen.', pending: 'Gegenzeichnung ausstehend',
    download: 'Unterschriebenes PDF herunterladen', signedOn: 'Unterschrieben am', secure: 'Privater, verschlüsselter Link · Dokument-Hash',
    steps: ['Prüfen', 'Unterschreiben', 'Fertig'], expires: 'Link gültig noch {n} Tage', expiresToday: 'Link läuft heute ab', print: 'Drucken / als PDF speichern', portal: 'Sicheres Dokumentenportal', reviewSub: 'Bitte prüfen Sie die Bedingungen vor der Unterschrift.', readyTitle: 'Bereit zur Unterschrift?', readySub: 'Zeichnen Sie Ihre Unterschrift unten oder tippen Sie Ihren Namen.', contract: 'Vertrag', powered: 'Sicher bereitgestellt über die digitale Signaturplattform',
    draw: 'Zeichnen', type: 'Tippen', clear: 'Löschen', hint: 'Hier unterschreiben', canvas: 'Unterschriftsfeld', err: 'Unterschrift fehlgeschlagen. Bitte erneut versuchen.',
  },
  en: {
    loading: 'Loading contract…', invalid: 'This link is invalid or has expired. Please ask for a new link.',
    from: 'Contract from', progress: '{a} of {b} fields completed', provider: 'Contractor', client: 'Client',
    signHead: 'Sign', name: 'Full name', email: 'E-mail (for your copy, optional)', signature: 'Your signature',
    consent: 'I have read the contract and sign it electronically. I understand that this electronic signature is legally binding.',
    submit: 'Sign contract', missing: 'Please still fill in:', needSig: 'Please sign in the box.', needConsent: 'Please confirm your consent.',
    doneTitle: 'Thank you – the contract is signed.', doneSub: 'Both parties have signed. Download your copy.',
    waitTitle: 'Thank you – your signature has been saved.', waitSub: '{p} will now countersign. Afterwards you can download the fully signed PDF here.', pending: 'Countersignature pending',
    download: 'Download signed PDF', signedOn: 'Signed on', secure: 'Private, encrypted link · document hash',
    steps: ['Review', 'Sign', 'Finish'], expires: 'Link expires in {n} days', expiresToday: 'Link expires today', print: 'Print / save as PDF', portal: 'Secure document portal', reviewSub: 'Please review the terms below before signing.', readyTitle: 'Ready to sign?', readySub: 'Draw your signature below or type your name.', contract: 'Contract', powered: 'Securely powered by the digital signature platform',
    draw: 'Draw', type: 'Type', clear: 'Clear', hint: 'Sign here', canvas: 'Signature box', err: 'Signing failed. Please try again.',
  },
  fa: {
    loading: 'در حال بارگذاری قرارداد…', invalid: 'این لینک نامعتبر است یا منقضی شده. لطفاً لینک تازه درخواست کنید.',
    from: 'قرارداد از طرف', progress: '{a} از {b} فیلد تکمیل شده', provider: 'مجری', client: 'کارفرما',
    signHead: 'امضا', name: 'نام و نام خانوادگی', email: 'ایمیل (برای دریافت نسخه، اختیاری)', signature: 'امضای شما',
    consent: 'قرارداد را خوانده‌ام و آن را به‌صورت الکترونیکی امضا می‌کنم. می‌دانم که این امضای الکترونیکی الزام‌آور است.',
    submit: 'امضای قرارداد', missing: 'لطفاً این موارد را پر کنید:', needSig: 'لطفاً در کادر امضا کنید.', needConsent: 'لطفاً رضایت خود را تأیید کنید.',
    doneTitle: 'سپاس — قرارداد امضا شد.', doneSub: 'هر دو طرف امضا کرده‌اند. نسخهٔ خود را دریافت کنید.',
    waitTitle: 'سپاس — امضای شما ثبت شد.', waitSub: 'اکنون {p} قرارداد را امضا می‌کند. پس از آن می‌توانید PDF نهایی را از همین صفحه دریافت کنید.', pending: 'در انتظار امضای مجری',
    download: 'دانلود PDF امضاشده', signedOn: 'تاریخ امضا', secure: 'لینک خصوصی و رمزگذاری‌شده · اثر انگشت سند',
    steps: ['بررسی', 'امضا', 'پایان'], expires: 'اعتبار لینک: {n} روز دیگر', expiresToday: 'لینک امروز منقضی می‌شود', print: 'چاپ / ذخیره به‌صورت PDF', portal: 'درگاه امن اسناد', reviewSub: 'لطفاً پیش از امضا شرایط زیر را مطالعه کنید.', readyTitle: 'آمادهٔ امضا هستید؟', readySub: 'امضای خود را در کادر زیر بکشید یا نام خود را تایپ کنید.', contract: 'قرارداد', powered: 'ارائه‌شده به‌صورت امن توسط پلتفرم امضای دیجیتال',
    draw: 'کشیدن', type: 'تایپ', clear: 'پاک کردن', hint: 'اینجا امضا کنید', canvas: 'کادر امضا', err: 'امضا انجام نشد. دوباره تلاش کنید.',
  },
} as const;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const fa = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);

/** Public page reached via /sign/<token>. No login: the private token is the credential. */
export function SignContract({ token }: { token: string }) {
  const [view, setView] = useState<View | null | 'invalid'>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.get<View>(`/public/sign/${encodeURIComponent(token)}`).then((v) => {
    setView(v);
    setName((n) => n || v.customer.name || '');
    setEmail((e) => e || v.customer.email || '');
  }).catch(() => setView('invalid'));
  useEffect(() => { void load(); }, [token]);

  const lang: L = view && view !== 'invalid' ? view.language : (document.documentElement.lang as L) || 'de';
  const t = T[lang] ?? T.de;
  const n = (x: number) => (lang === 'fa' ? fa(String(x)) : String(x));
  useEffect(() => {
    if (view && view !== 'invalid') { document.title = `${view.title} · ${view.contract_number}`; }
  }, [view]);

  const fields = view && view !== 'invalid' ? view.fields : [];
  const missing = useMemo(() => missingFields(fields, values), [fields, values]);
  const required = fields.filter((f) => f.required).length;

  if (view === null) return <Center><Spinner className="h-6 w-6" /><p className="text-muted">{t.loading}</p></Center>;
  if (view === 'invalid') return <Center><Icon name="alert" className="h-8 w-8 text-danger" /><p className="max-w-sm text-center">{t.invalid}</p></Center>;

  const rtl = lang === 'fa';
  const fmt = (iso: string) => formatDateFor(iso, lang);
  const custName = view.customer.company_name || view.customer.name || '';

  async function submit() {
    setTried(true); setErr(null);
    if (missing.length) { document.getElementById(`fld-${fields.find((f) => f.label === missing[0])?.key}`)?.focus(); return; }
    if (!sig || name.trim().length < 2 || !consent) return;
    setBusy(true);
    try {
      await api.post(`/public/sign/${encodeURIComponent(token)}`, { signer_name: name.trim(), signer_email: email.trim(), signature: sig, values, consent: true });
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setErr((e as Error).message || t.err); } finally { setBusy(false); }
  }

  const doneCount = view.signed ? 3 : view.customer_signed ? 2 : 0;
  const days = view.expires_at ? Math.floor((Date.parse(view.expires_at) - Date.now()) / 86_400_000) : null;

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} lang={lang} className="min-h-screen bg-bg">
      <div className="h-1" style={{ background: view.accent_color }} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-10" />
            <div>
              <div className="text-xl font-bold leading-tight" dir="auto">{view.brand}</div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">{t.portal}</div>
            </div>
          </div>
          <div className="text-end">
            <div className="text-sm font-semibold text-muted">{t.contract} <span dir="ltr">#{view.contract_number}</span></div>
            {days !== null && !view.customer_signed && (
              <div className={`text-xs ${days <= 2 ? 'font-medium text-warning' : 'text-muted'}`}>{days < 1 ? t.expiresToday : fill(t.expires, { n: n(days) })}</div>
            )}
          </div>
        </header>

        <ol className="mb-8 flex items-center gap-3 text-sm print:hidden">
          {t.steps.map((s2, i) => {
            const state = i < doneCount ? 'done' : i === doneCount ? 'current' : 'todo';
            return (
              <li key={s2} className={`flex items-center gap-3 ${i < t.steps.length - 1 ? 'flex-1' : ''}`} aria-current={state === 'current' ? 'step' : undefined}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${state === 'todo' ? 'bg-surface-2 text-muted' : 'bg-primary text-on-primary'}`}>
                  {state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" /> : n(i + 1)}
                </span>
                <span className={`whitespace-nowrap ${state === 'todo' ? 'text-muted' : 'font-semibold'}`}>{s2}</span>
                {i < t.steps.length - 1 && <span className={`h-0.5 flex-1 rounded ${i < doneCount || state === 'current' ? 'bg-primary' : 'bg-line'}`} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        {view.customer_signed && !view.signed && (
          <div className="mb-6 rounded-xl border border-primary/30 bg-primary-soft p-5" role="status">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"><Icon name="check" className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h1 className="font-semibold">{t.waitTitle}</h1>
                <p className="mt-0.5 text-sm text-muted">{fill(t.waitSub, { p: view.seller_signer_name || view.seller.full_name || view.brand })}</p>
              </div>
            </div>
          </div>
        )}
        {view.signed && (
          <div className="mb-6 rounded-xl border border-success/30 bg-success-soft p-5" role="status">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-white"><Icon name="check" className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h1 className="font-semibold">{t.doneTitle}</h1>
                <p className="mt-0.5 text-sm text-muted">{t.doneSub}</p>
                <a className="btn-primary mt-3 inline-flex" href={`/api/public/sign/${encodeURIComponent(token)}/pdf`}><Icon name="download" />{t.download}</a>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-line sm:p-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-bold" dir="auto">{view.title}</h2>
              <p className="mt-1 text-sm text-muted">{t.reviewSub}</p>
            </div>
            {!view.signed && <button className="btn-secondary print:hidden" onClick={() => window.print()}><Icon name="download" />{t.print}</button>}
          </div>

          <div className="rounded-xl bg-surface-2 p-3 ring-1 ring-line sm:p-8">
            <article className="bg-surface p-6 shadow-sm sm:p-14">
              <div className="mb-10 flex flex-wrap items-start justify-between gap-4 text-sm">
                <Party k={t.provider} name={[view.seller.full_name, view.seller.business_name].filter(Boolean).join(' · ')} p={view.seller} />
                <Party k={t.client} name={custName} p={view.customer} end />
              </div>
              <ContractDoc body={view.body} mode={view.customer_signed ? 'static' : 'fill'} values={view.customer_signed ? view.field_values : values}
                onValue={(k, v) => setValues((s2) => ({ ...s2, [k]: v }))} formatDate={fmt} showErrors={tried} />
              {view.customer_signed && (
                <div className="mt-10 grid gap-8 border-t border-line pt-6 sm:grid-cols-2">
                  <Sig role={t.client} name={view.signer_name} img={view.signature} at={view.signed_at ? `${t.signedOn} ${fmt(view.signed_at)}` : ''} />
                  {view.signed
                    ? <Sig role={t.provider} name={view.seller_signer_name} img={view.seller_signature} at={view.seller_signed_at ? `${t.signedOn} ${fmt(view.seller_signed_at)}` : ''} />
                    : <Sig role={t.provider} name={view.seller.full_name ?? ''} img={null} at={t.pending} />}
                </div>
              )}
            </article>
          </div>

          {!view.customer_signed && (
            <section className="mt-6 rounded-xl bg-primary-soft/70 px-5 py-10 print:hidden" aria-labelledby="sign-h">
              <div className="mx-auto max-w-md">
                <h2 id="sign-h" className="text-center text-lg font-bold text-primary-fg">{t.readyTitle}</h2>
                <p className="mb-6 mt-1 text-center text-sm text-primary-fg/80">{t.readySub}</p>
                {tried && missing.length > 0 && (
                  <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">{t.missing} {missing.join('، ')}</div>
                )}
                <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase text-primary-fg">{t.name}</span>
                  <input className="input h-12 bg-surface" dir="auto" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={tried && name.trim().length < 2 ? true : undefined} />
                </label>
                <label className="mt-4 block"><span className="mb-1.5 block text-xs font-bold uppercase text-primary-fg">{t.email}</span>
                  <input className="input h-12 bg-surface" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <div className="mt-4">
                  <div className="mb-1.5 text-xs font-bold uppercase text-primary-fg">{t.signature}</div>
                  <SignaturePad onChange={setSig} defaultName={name} rtl={rtl}
                    labels={{ draw: t.draw, type: t.type, clear: t.clear, hint: t.hint, typePlaceholder: t.name, canvasLabel: t.canvas }} />
                  {tried && !sig && <p className="mt-1 text-sm text-danger" role="alert">{t.needSig}</p>}
                </div>
                <label className="mt-5 flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--primary))]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span className="text-xs text-primary-fg/90">{t.consent}</span>
                </label>
                {tried && !consent && <p className="mt-1 text-sm text-danger" role="alert">{t.needConsent}</p>}
                {err && <p className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger" role="alert">{err}</p>}
                <button className="btn-primary mt-6 h-12 w-full justify-center text-base shadow-md" onClick={() => void submit()} disabled={busy}>
                  {busy ? <Spinner /> : null}{t.submit}
                </button>
              </div>
            </section>
          )}
        </div>

        <footer className="mt-8 space-y-1 text-center text-xs text-muted">
          <p>{t.powered} · <span dir="auto">{view.brand}</span></p>
          <p className="flex items-center justify-center gap-1.5"><Icon name="lock" className="h-3.5 w-3.5" />{t.secure}: <code className="max-w-[12rem] truncate" dir="ltr">{view.content_hash?.slice(0, 16)}…</code></p>
        </footer>
      </main>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-4">{children}</div>;
}
function Party({ k, name, p, end }: { k: string; name: string; p: Record<string, string | null>; end?: boolean }) {
  return (
    <div className={end ? 'text-end' : ''}>
      <div className="font-bold" dir="auto">{name}</div>
      <div className="text-xs text-muted">{k}</div>
      <div className="text-xs text-muted" dir="auto">{[p.street, [p.postal_code, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>
    </div>
  );
}
function Sig({ role, name, img, at }: { role: string; name: string | null; img: string | null; at: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{role}</div>
      <div className="flex h-20 items-end">{img ? <img src={img} alt="" className="max-h-20 max-w-[16rem]" /> : null}</div>
      <div className="border-t border-fg pt-1 text-sm font-medium" dir="auto">{name}</div>
      <div className="text-xs text-muted">{at}</div>
    </div>
  );
}
