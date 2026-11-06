import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api } from './api';
import { I18nProvider, useI18n } from './i18n';
import type { InstallMode, Lang, MsgKey } from './i18n';
import { Icon, Logo, Spinner, ToastProvider, TopBarCtx, useTheme } from './ui';
import type { IconName, ThemePref } from './ui';
import { CommandPalette } from './components/CustomerSearch';
import { SetupWizard } from './pages/SetupWizard';
import { Dashboard } from './pages/Dashboard';
import { Customers } from './pages/Customers';
import { NewInvoice } from './pages/NewInvoice';
import { InvoiceDetail } from './pages/InvoiceDetail';
import { Invoices } from './pages/Invoices';
import { Inbox } from './pages/Inbox';
import { InboxDetail } from './pages/InboxDetail';
import { Mail } from './pages/Mail';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { Contracts } from './pages/Contracts';
import { SignContract } from './pages/SignContract';

interface Bootstrap {
  setupState: string;
  appName: string;
  locale: string;
  invoiceMode: InstallMode;
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState(false);
  useTheme(); // apply saved/system theme as early as possible

  const load = () => {
    setError(false);
    api.get<Bootstrap>('/system/bootstrap').then(setBoot).catch(() => setError(true));
  };
  useEffect(load, []);

  if (error) {
    return (
      <I18nProvider initialMode={null}>
        <BootError onRetry={load} />
      </I18nProvider>
    );
  }
  if (!boot) return <div className="flex min-h-screen items-center justify-center text-muted"><Spinner className="h-6 w-6" /></div>;

  const isSetup = boot.setupState !== 'ACTIVE';
  // Public contract signing link: no login, own language handling.
  const signMatch = /^\/sign\/([A-Za-z0-9_-]{20,128})\/?$/.exec(window.location.pathname);
  if (signMatch && !isSetup) {
    return (
      <I18nProvider initialMode={boot.invoiceMode} serverLocale={boot.locale}>
        <ToastProvider><SignContract token={signMatch[1]!} /></ToastProvider>
      </I18nProvider>
    );
  }
  return (
    <I18nProvider initialMode={isSetup ? null : boot.invoiceMode} serverLocale={boot.locale}>
      <ToastProvider>
        {isSetup ? (
          <Routes>
            <Route path="/setup" element={<SetupWizard onDone={() => window.location.assign('/')} />} />
            <Route path="*" element={<Navigate to="/setup" replace />} />
          </Routes>
        ) : (
          <AuthGate appName={boot.appName} />
        )}
      </ToastProvider>
    </I18nProvider>
  );
}

export interface Me { email: string; role: string; fullName: string | null; via: string | null; hasPassword: boolean; mailAddress?: string | null }

/** Shows the login page until /auth/me succeeds; returns to it on any 401. */
function AuthGate({ appName }: { appName: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const check = () => { api.get<Me>('/auth/me').then(setMe).catch(() => setMe(null)); };
  useEffect(check, []);
  useEffect(() => {
    const onUnauth = () => setMe(null);
    window.addEventListener('xr:unauthorized', onUnauth);
    return () => window.removeEventListener('xr:unauthorized', onUnauth);
  }, []);
  if (me === undefined) return <div className="flex min-h-screen items-center justify-center text-muted"><Spinner className="h-6 w-6" /></div>;
  if (me === null) return <Login appName={appName} onLoggedIn={check} />;
  return <Shell appName={appName} me={me} onLogout={async () => { await api.post('/auth/logout').catch(() => undefined); setMe(null); }} />;
}

function BootError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted">
      <Icon name="alert" className="h-6 w-6 text-danger" />
      <p>{t('common.error_network')}</p>
      <button className="btn-secondary" onClick={onRetry}>{t('common.retry')}</button>
    </div>
  );
}

const NAV: { to: string; key: MsgKey; icon: IconName }[] = [
  { to: '/', key: 'nav.dashboard', icon: 'dashboard' },
  { to: '/invoices', key: 'nav.invoices', icon: 'file' },
  { to: '/invoices/new', key: 'nav.new_invoice', icon: 'filePlus' },
  { to: '/contracts', key: 'nav.contracts', icon: 'fileSign' },
  { to: '/customers', key: 'nav.customers', icon: 'users' },
  { to: '/inbox', key: 'nav.inbox', icon: 'inbox' },
  { to: '/mail', key: 'nav.mail', icon: 'mail' },
];
const NAV_CONFIG: { to: string; key: MsgKey; icon: IconName; end?: boolean }[] = [
  { to: '/settings/users', key: 'nav.team', icon: 'user' },
  { to: '/settings', key: 'nav.settings', icon: 'settings' },
];

function Shell({ appName, me, onLogout }: { appName: string; me: Me; onLogout: () => void }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { t, tx, num } = useI18n();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [badges, setBadges] = useState<Partial<Record<string, number>>>({});
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const [barCount, setBarCount] = useState(0);

  // Email-only users get the mailbox and nothing else.
  const mailOnly = me.role === 'MAIL_USER';

  // Sidebar counters: unpaid received invoices and contracts waiting for our countersignature.
  useEffect(() => {
    if (mailOnly) {
      api.get<{ folders: Record<string, { unread: number }> }>('/mail/counts')
        .then((r) => setBadges({ '/mail': r.folders.INBOX?.unread ?? 0 })).catch(() => {});
      return;
    }
    api.get<{ payment_status: string }[]>('/received')
      .then((r) => setBadges((b) => ({ ...b, '/inbox': r.filter((x) => x.payment_status !== 'PAID').length }))).catch(() => {});
    api.get<{ folders: Record<string, { unread: number }> }>('/mail/counts')
      .then((r) => setBadges((b) => ({ ...b, '/mail': r.folders.INBOX?.unread ?? 0 }))).catch(() => {});
    api.get<{ status: string }[]>('/contracts')
      .then((r) => setBadges((b) => ({ ...b, '/contracts': r.filter((x) => x.status === 'CUSTOMER_SIGNED').length }))).catch(() => {});
  }, [loc.pathname, mailOnly]);

  useEffect(() => { setDrawer(false); }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mailOnly) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'n') nav('/invoices/new');
      else if (e.key === 'c') nav('/customers');
      else if (e.key === '/') { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, mailOnly]);

  const item = (n: { to: string; key: MsgKey; icon: IconName }, end: boolean) => (
    <NavLink key={n.to} to={n.to} end={end}
      className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors ${isActive ? 'bg-primary-soft text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
      <Icon name={n.icon} className="h-5 w-5" />
      <span className="flex-1">{t(n.key)}</span>
      {!!badges[n.to] && <span className="tabular rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-fg ring-1 ring-primary/20" aria-label={t('nav.badge', { n: badges[n.to]! })}>{num(badges[n.to]!)}</span>}
    </NavLink>
  );

  const sidebar = (
    <nav className="flex h-full flex-col p-4" aria-label={t('nav.menu')}>
      <div className="mb-8 px-2 pt-2">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="truncate text-xl font-bold tracking-tight">{appName || t('app.name')}</div>
        </div>
        <div className="mt-1.5 ps-11 text-xs text-muted">{t('app.tagline')}</div>
      </div>
      <div className="flex flex-col gap-1">
        {(mailOnly ? NAV.filter((n) => n.to === '/mail') : NAV).map((n) => item(n, n.to === '/' || n.to === '/invoices'))}
      </div>
      {mailOnly && me.mailAddress && <div className="mt-6 truncate px-3 text-xs text-muted" dir="ltr">{me.mailAddress}</div>}
      {!mailOnly && <><div className="eyebrow mb-2 mt-8 px-3 text-[11px]">{t('nav.config')}</div>
      <div className="flex flex-col gap-1">
        {NAV_CONFIG.map((n) => (
          <NavLink key={n.to} to={n.to}
            className={() => {
              const active = n.to === '/settings' ? loc.pathname.startsWith('/settings') && !loc.pathname.startsWith('/settings/users') : loc.pathname.startsWith(n.to);
              return `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors ${active ? 'bg-primary-soft text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`;
            }}>
            <Icon name={n.icon} className="h-5 w-5" />
            <span className="flex-1">{t(n.key)}</span>
          </NavLink>
        ))}
      </div></>}
    </nav>
  );

  const initials = (me.fullName || me.email).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <TopBarCtx.Provider value={{ el: barEl, mount: () => { setBarCount((c) => c + 1); return () => setBarCount((c) => c - 1); } }}>
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-e border-line bg-surface lg:block">{sidebar}</aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 max-w-[85vw] overflow-y-auto bg-surface shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-8">
          <button className="btn-ghost btn-icon w-10 lg:hidden" onClick={() => setDrawer(true)} aria-label={t('nav.menu')}><Icon name="menu" className="h-5 w-5" /></button>
          {/* Pages with their own top bar (back arrow, title, actions) render into this slot. */}
          <div ref={setBarEl} className={barCount > 0 ? 'flex min-w-0 flex-1 items-center' : 'hidden'} />
          {barCount === 0 && <>
            {mailOnly ? <div className="flex-1" /> : <button onClick={() => setPalette(true)}
              className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-surface-2 px-3.5 text-sm text-muted transition-colors hover:bg-line sm:max-w-2xl">
              <Icon name="search" className="h-[18px] w-[18px]" />
              <span className="truncate">{t('nav.search')}</span>
              <kbd className="ms-auto hidden rounded border border-line-strong bg-surface px-1.5 font-mono text-[11px] sm:inline" dir="ltr">Ctrl K</kbd>
            </button>}
            <div className="ms-auto flex items-center gap-1">
              <LangSwitch compact />
              <ThemeSwitch />
              <span className="mx-2 hidden h-8 w-px bg-line sm:block" aria-hidden="true" />
              <UserMenu me={me} initials={initials} role={tx(`role.${me.role}`, me.role)} onLogout={onLogout} />
            </div>
          </>}
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
          {mailOnly ? (
            <Routes>
              <Route path="/mail" element={<Mail />} />
              <Route path="/mail/:id" element={<Mail />} />
              <Route path="*" element={<Navigate to="/mail" replace />} />
            </Routes>
          ) : <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/invoices/new" element={<NewInvoice />} />
            <Route path="/invoices/:id" element={<InvoiceDetail />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/contracts/*" element={<Contracts />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/inbox/:id" element={<InboxDetail />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/mail/:id" element={<Mail />} />
            <Route path="/settings/*" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>}
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
    </TopBarCtx.Provider>
  );
}

function UserMenu({ me, initials, role, onLogout }: { me: Me; initials: string; role: string; onLogout: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="relative">
      <button className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface-2" aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary">{initials}</span>
        <span className="hidden text-start leading-tight sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-semibold" dir="auto">{me.fullName || me.email}</span>
          <span className="block text-xs text-muted">{role}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-12 z-40 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <div className="border-b border-line px-3 py-2">
            <div className="text-[11px] text-muted">{t('auth.signed_in_as')}</div>
            <div className="truncate text-sm font-medium" dir="ltr">{me.email}</div>
          </div>
          <button role="menuitem" className="mt-1 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg" onClick={onLogout}>
            <Icon name="logOut" className="h-[18px] w-[18px]" flip />{t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export function LangSwitch({ compact }: { compact?: boolean } = {}) {
  const { lang, allowed, setLang, t } = useI18n();
  if (allowed.length < 2) return null;
  if (compact) {
    return (
      <label className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" title={t('lang.label')}>
        <Icon name="globe" className="pointer-events-none h-5 w-5" />
        <select className="absolute inset-0 cursor-pointer opacity-0" aria-label={t('lang.label')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          {allowed.map((l) => <option key={l} value={l}>{t(`lang.${l}` as MsgKey)}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{t('lang.label')}</span>
      <Icon name="globe" className="pointer-events-none absolute start-2.5 h-4 w-4 text-muted" />
      <select className="h-10 cursor-pointer appearance-none rounded-lg border border-transparent bg-transparent pe-3 ps-8 text-sm text-fg hover:bg-surface-2"
        value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        {allowed.map((l) => <option key={l} value={l}>{t(`lang.${l}` as MsgKey)}</option>)}
      </select>
    </label>
  );
}

function ThemeSwitch() {
  const { t } = useI18n();
  const [pref, setPref] = useTheme();
  const order: ThemePref[] = ['auto', 'light', 'dark'];
  const icon: Record<ThemePref, IconName> = { auto: 'monitor', light: 'sun', dark: 'moon' };
  const next = order[(order.indexOf(pref) + 1) % order.length]!;
  const label = `${t('theme.label')}: ${t(`theme.${pref}` as MsgKey)}`;
  return (
    <button className="btn-ghost btn-icon w-10" onClick={() => setPref(next)} aria-label={label} title={label}>
      <Icon name={icon[pref]} className="h-[18px] w-[18px]" />
    </button>
  );
}

function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);
}

export type { ReactNode };
