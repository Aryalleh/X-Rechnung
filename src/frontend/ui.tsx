/** Shared UI kit: icons, layout primitives, feedback, theme. */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from './i18n';
import type { MsgKey } from './i18n';
import { getCur, parseMoney, toInput } from './currency';

/* ------------------------------------------------------------------ icons */
// Lucide-style 24px stroke icons, inlined (CSP-safe, no icon font).
const ICONS: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  file: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>,
  filePlus: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M12 18v-6" /><path d="M9 15h6" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  inbox: <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  settings: <><path d="M20 7h-9" /><path d="M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><path d="M12 15V3" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><path d="M12 3v12" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></>,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>,
  menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M9.9 4.2A9.6 9.6 0 0 1 12 4c7 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.2" /><path d="M6.6 6.6C3.6 8.6 2 12 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2" /><line x1="2" y1="2" x2="22" y2="22" /></>,
  pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  fileSign: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 18c1.5-2 2.5-2 3 0s1.5 2 3 0" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  logOut: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
  bookmark: <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  building: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" /><path d="M12 10h.01" /><path d="M12 14h.01" /><path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" /></>,
  banknote: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  package: <><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>,
  pencil: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  ban: <><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  save: <><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" /></>,
};
export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'h-4 w-4', flip }: { name: IconName; className?: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={`${className} shrink-0 ${flip ? 'flip-rtl' : ''}`} aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="rgb(var(--primary))" />
      <path d="M10 9l12 14M22 9L10 23" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------------------------------------- layout */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, icon, actions, children, className = '' }: { title?: string; icon?: IconName; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="section-title flex items-center gap-2">{icon && <Icon name={icon} className="h-4 w-4 text-muted" />}{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="card-pad">{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className = '', htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-danger" role="alert">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------- feedback */
type Tone = 'info' | 'success' | 'warning' | 'danger';
const TONE_CLS: Record<Tone, string> = {
  info: 'bg-info-soft text-info border-info/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/20',
  danger: 'bg-danger-soft text-danger border-danger/20',
};
const TONE_ICON: Record<Tone, IconName> = { info: 'info', success: 'check', warning: 'alert', danger: 'alert' };

export function Alert({ tone = 'info', children, onClose }: { tone?: Tone; children: ReactNode; onClose?: () => void }) {
  const { t } = useI18n();
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${TONE_CLS[tone]}`}>
      <Icon name={TONE_ICON[tone]} className="mt-0.5 h-4 w-4" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onClose && (
        <button type="button" className="-m-1 rounded p-1 opacity-70 hover:opacity-100" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="x" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> {t('common.loading')}</div>;
}

export function EmptyState({ icon, title, action }: { icon: IconName; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <div className="rounded-full bg-surface-2 p-3 text-muted"><Icon name={icon} className="h-6 w-6" /></div>
      <p className="text-sm text-muted">{title}</p>
      {action}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-surface-2 text-muted',
  READY_TO_ISSUE: 'bg-info-soft text-info',
  ISSUING: 'bg-info-soft text-info',
  ISSUED: 'bg-primary-soft text-primary-fg',
  SENT: 'bg-primary-soft text-primary-fg',
  PARTIALLY_PAID: 'bg-warning-soft text-warning',
  PAID: 'bg-success-soft text-success',
  OVERDUE: 'bg-danger-soft text-danger',
  CANCELLATION_PENDING: 'bg-warning-soft text-warning',
  CANCELLED: 'bg-surface-2 text-muted line-through',
  VIEWED: 'bg-warning-soft text-warning',
  CUSTOMER_SIGNED: 'bg-primary-soft text-primary-fg',
  SIGNED: 'bg-success-soft text-success',
};
export function StatusBadge({ status }: { status: string }) {
  const { tx } = useI18n();
  return <span className={`badge ${STATUS_TONE[status] ?? 'bg-surface-2 text-muted'}`}>{tx(`status.${status}`, status)}</span>;
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone | 'neutral'; children: ReactNode }) {
  const cls = tone === 'neutral' ? 'bg-surface-2 text-muted' : TONE_CLS[tone].replace(/border-\S+/, '');
  return <span className={`badge ${cls}`}>{children}</span>;
}

/* ---------------------------------------------------------------- toasts */
interface ToastItem { id: number; tone: Tone; text: string }
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => {});
export function useToast() { return useContext(ToastCtx); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p, { id, tone, text }]);
    setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), tone === 'danger' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((it) => (
          <div key={it.id} className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${TONE_CLS[it.tone]} bg-surface`}>
            <Icon name={TONE_ICON[it.tone]} className="h-4 w-4" />
            <span>{it.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ----------------------------------------------------------------- modal */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 30);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" className="btn-ghost btn-sm btn-icon w-8" onClick={onClose} aria-label={t('common.close')}><Icon name="x" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- money input */
/** Text input that shows/accepts major units ("12,50") and reports minor units. */
export function MoneyInput({ value, onChange, currency, id, className = '', ariaLabel }: { value: number; onChange: (minor: number) => void; currency: string; id?: string; className?: string; ariaLabel?: string }) {
  const { lang } = useI18n();
  const [text, setText] = useState(() => toInput(value, currency, lang));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(toInput(value, currency, lang)); }, [value, currency, lang]);
  const c = getCur(currency);
  return (
    <div className="relative" dir="ltr">
      <input id={id} aria-label={ariaLabel} className={`input tabular pr-12 text-right ${className}`} dir="ltr" inputMode="decimal"
        value={text} placeholder={c.decimals ? (lang === 'de' ? '0,00' : '0.00') : '0'}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(toInput(value, currency, lang)); }}
        onChange={(e) => { setText(e.target.value); const m = parseMoney(e.target.value, currency); onChange(m ?? 0); }} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex max-w-[2.5rem] items-center truncate text-xs text-muted">{c.symbol[lang]}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- theme */
export type ThemePref = 'light' | 'dark' | 'auto';
const THEME_KEY = 'xr.theme';
export function readTheme(): ThemePref {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
}
export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readTheme);
  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => applyTheme('auto');
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [pref]);
  const set = (p: ThemePref) => { try { localStorage.setItem(THEME_KEY, p); } catch { /* ignore */ } setPref(p); };
  return [pref, set];
}

/** Translate a key list into <option>s. */
export function Options({ values, prefix }: { values: readonly string[]; prefix: string }) {
  const { tx } = useI18n();
  return <>{values.map((v) => <option key={v} value={v}>{tx(`${prefix}${v}`, v)}</option>)}</>;
}

export function useT() { return useI18n().t as (k: MsgKey, v?: Record<string, string | number>) => string; }

/** Password field with a show/hide toggle (44px hit area, labelled for screen readers). */
export function PasswordInput({ id, value, onChange, autoComplete, required, minLength, invalid, describedBy }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: 'current-password' | 'new-password';
  required?: boolean; minLength?: number; invalid?: boolean; describedBy?: string;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? 'text' : 'password'} className="input pe-11" dir="ltr" value={value}
        onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required={required} minLength={minLength}
        autoCapitalize="off" autoCorrect="off" spellCheck={false}
        aria-invalid={invalid || undefined} aria-describedby={describedBy} />
      <button type="button" onClick={() => setShow(!show)} aria-pressed={show}
        aria-label={show ? t('auth.hide_pw') : t('auth.show_pw')} title={show ? t('auth.hide_pw') : t('auth.show_pw')}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-muted transition-colors hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary">
        <Icon name={show ? 'eyeOff' : 'eye'} className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
