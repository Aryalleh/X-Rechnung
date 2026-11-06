import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { formatDateFor } from '../../lib/format';
import { missingFields, type FieldDef } from '../../lib/contract-doc';
import { ContractDoc } from '../components/ContractDoc';
import { SignaturePad } from '../components/SignaturePad';
import { Icon, Spinner } from '../ui';

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
    steps: ['Prüfen', 'Unterschreiben', 'Fertig'], expires: 'Link gültig noch {n} Tage', expiresToday: 'Link läuft heute ab', print: 'Drucken / als PDF speichern',
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
    steps: ['Review', 'Sign', 'Finish'], expires: 'Link expires in {n} days', expiresToday: 'Link expires today', print: 'Print / save as PDF',
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
    steps: ['بررسی', 'امضا', 'پایان'], expires: 'اعتبار لینک: {n} روز دیگر', expiresToday: 'لینک امروز منقضی می‌شود', print: 'چاپ / ذخیره به‌صورت PDF',
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

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} lang={lang} className="min-h-screen bg-bg">
      <div className="h-1.5" style={{ background: view.accent_color }} />
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-xs text-muted">{t.from} {view.brand}</div>
            <div className="truncate font-semibold">{view.title} <span className="font-mono text-xs text-muted" dir="ltr">{view.contract_number}</span></div>
          </div>
          {!view.customer_signed && fields.length > 0 && (
            <div className="shrink-0 text-end">
              <div className="text-xs text-muted">{fill(t.progress, { a: n(required - missing.length), b: n(required) })}</div>
              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full bg-primary transition-all" style={{ width: `${required ? ((required - missing.length) / required) * 100 : 100}%` }} />
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <ol className="flex items-center gap-2 text-sm">
            {t.steps.map((s, i) => {
              // Before signing: reviewing; after customer signs: waiting to finish; countersigned: all done.
              const doneCount = view.signed ? 3 : view.customer_signed ? 2 : 0;
              const state = i < doneCount ? 'done' : i === doneCount ? 'current' : 'todo';
              return (
                <li key={s} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
                  {i > 0 && <span className={`h-px w-5 sm:w-8 ${state !== 'todo' ? 'bg-primary' : 'bg-line-strong'}`} aria-hidden="true" />}
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${state === 'done' ? 'bg-primary text-on-primary' : state === 'current' ? 'border-2 border-primary text-primary-fg' : 'border border-line-strong text-muted'}`}>
                    {state === 'done' ? <Icon name="check" className="h-3 w-3" /> : n(i + 1)}
                  </span>
                  <span className={state === 'todo' ? 'text-muted' : 'font-medium'}>{s}</span>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center gap-2">
            {view.expires_at && (() => {
              const days = Math.floor((Date.parse(view.expires_at) - Date.now()) / 86_400_000);
              return <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${days <= 2 ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted'}`}><Icon name="clock" className="h-3.5 w-3.5" />{days < 1 ? t.expiresToday : fill(t.expires, { n: n(days) })}</span>;
            })()}
            {!view.signed && <button className="btn-ghost btn-sm" onClick={() => window.print()}><Icon name="download" />{t.print}</button>}
          </div>
        </div>
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

        <article className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-line sm:p-10">
          <div className="mb-6 grid gap-3 text-sm sm:grid-cols-2">
            <Party k={t.provider} name={[view.seller.full_name, view.seller.business_name].filter(Boolean).join(' · ')} p={view.seller} />
            <Party k={t.client} name={custName} p={view.customer} />
          </div>
          <ContractDoc body={view.body} mode={view.customer_signed ? 'static' : 'fill'} values={view.customer_signed ? view.field_values : values}
            onValue={(k, v) => setValues((s) => ({ ...s, [k]: v }))} formatDate={fmt} showErrors={tried} />

          <div className="mt-10 grid gap-8 border-t border-line pt-6 sm:grid-cols-2">
            {view.customer_signed
              ? <Sig role={t.client} name={view.signer_name} img={view.signature} at={view.signed_at ? `${t.signedOn} ${fmt(view.signed_at)}` : ''} />
              : <div className="hidden sm:block" />}
            {view.signed
              ? <Sig role={t.provider} name={view.seller_signer_name} img={view.seller_signature} at={view.seller_signed_at ? `${t.signedOn} ${fmt(view.seller_signed_at)}` : ''} />
              : view.customer_signed ? <Sig role={t.provider} name={view.seller.full_name ?? ''} img={null} at={t.pending} /> : null}
          </div>
        </article>

        {!view.customer_signed && (
          <section className="mt-6 rounded-xl bg-surface p-5 shadow-sm ring-1 ring-line sm:p-8" aria-labelledby="sign-h">
            <h2 id="sign-h" className="mb-4 flex items-center gap-2 text-lg font-semibold"><Icon name="pen" />{t.signHead}</h2>
            {tried && missing.length > 0 && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">{t.missing} {missing.join('، ')}</div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label">{t.name}</span>
                <input className="input" dir="auto" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={tried && name.trim().length < 2 ? true : undefined} />
              </label>
              <label className="block"><span className="label">{t.email}</span>
                <input className="input" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            </div>
            <div className="mt-4">
              <div className="label">{t.signature}</div>
              <SignaturePad onChange={setSig} defaultName={name} rtl={rtl}
                labels={{ draw: t.draw, type: t.type, clear: t.clear, hint: t.hint, typePlaceholder: t.name, canvasLabel: t.canvas }} />
              {tried && !sig && <p className="mt-1 text-sm text-danger" role="alert">{t.needSig}</p>}
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--primary))]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="text-sm">{t.consent}</span>
            </label>
            {tried && !consent && <p className="mt-1 text-sm text-danger" role="alert">{t.needConsent}</p>}
            {err && <p className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger" role="alert">{err}</p>}
            <button className="btn-primary mt-5 h-12 w-full justify-center text-base" onClick={() => void submit()} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="pen" />}{t.submit}
            </button>
          </section>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
          <Icon name="lock" className="h-3.5 w-3.5" />{t.secure}: <code className="max-w-[12rem] truncate" dir="ltr">{view.content_hash?.slice(0, 16)}…</code>
        </p>
      </main>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-4">{children}</div>;
}
function Party({ k, name, p }: { k: string; name: string; p: Record<string, string | null> }) {
  return (
    <div className="rounded-lg bg-surface-2/60 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</div>
      <div className="font-semibold" dir="auto">{name}</div>
      <div className="text-muted" dir="auto">{[p.street, [p.postal_code, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>
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
