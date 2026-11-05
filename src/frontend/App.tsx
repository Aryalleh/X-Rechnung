import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api } from './api';
import { I18nProvider, useI18n } from './i18n';
import type { InstallMode, Lang, MsgKey } from './i18n';
import { Icon, Logo, Spinner, ToastProvider, useTheme } from './ui';
import type { IconName, ThemePref } from './ui';
import { CommandPalette } from './components/CustomerSearch';
import { SetupWizard } from './pages/SetupWizard';
import { Dashboard } from './pages/Dashboard';
import { Customers } from './pages/Customers';
import { NewInvoice } from './pages/NewInvoice';
import { InvoiceDetail } from './pages/InvoiceDetail';
import { Invoices } from './pages/Invoices';
import { Inbox } from './pages/Inbox';
import { Settings } from './pages/Settings';

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
  return (
    <I18nProvider initialMode={isSetup ? null : boot.invoiceMode} serverLocale={boot.locale}>
      <ToastProvider>
        {isSetup ? (
          <Routes>
            <Route path="/setup" element={<SetupWizard onDone={() => window.location.assign('/')} />} />
            <Route path="*" element={<Navigate to="/setup" replace />} />
          </Routes>
        ) : (
          <Shell appName={boot.appName} />
        )}
      </ToastProvider>
    </I18nProvider>
  );
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
  { to: '/customers', key: 'nav.customers', icon: 'users' },
  { to: '/inbox', key: 'nav.inbox', icon: 'inbox' },
  { to: '/settings', key: 'nav.settings', icon: 'settings' },
];

function Shell({ appName }: { appName: string }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { t } = useI18n();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { setDrawer(false); }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'n') nav('/invoices/new');
      else if (e.key === 'c') nav('/customers');
      else if (e.key === '/') { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label={t('nav.menu')}>
      <div className="mb-4 flex items-center gap-2.5 px-2 pt-1">
        <Logo />
        <div className="min-w-0">
          <div className="truncate font-bold leading-tight">{appName || t('app.name')}</div>
          <div className="truncate text-xs text-muted">{t('app.tagline')}</div>
        </div>
      </div>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/' || n.to === '/invoices'}
          className={({ isActive }) => `flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${isActive ? 'bg-primary-soft text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
          <Icon name={n.icon} className="h-[18px] w-[18px]" />
          {t(n.key)}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-e border-line bg-surface lg:block">{sidebar}</aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 max-w-[85vw] bg-surface shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button className="btn-ghost btn-icon w-10 lg:hidden" onClick={() => setDrawer(true)} aria-label={t('nav.menu')}><Icon name="menu" className="h-5 w-5" /></button>
          <button onClick={() => setPalette(true)}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 text-sm text-muted transition-colors hover:border-line-strong sm:max-w-md">
            <Icon name="search" />
            <span className="truncate">{t('nav.search')}</span>
            <kbd className="ms-auto hidden rounded border border-line-strong px-1.5 font-mono text-[11px] sm:inline" dir="ltr">Ctrl K</kbd>
          </button>
          <div className="ms-auto flex items-center gap-1">
            <LangSwitch />
            <ThemeSwitch />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/invoices/new" element={<NewInvoice />} />
            <Route path="/invoices/:id" element={<InvoiceDetail />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/settings/*" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

export function LangSwitch() {
  const { lang, allowed, setLang, t } = useI18n();
  if (allowed.length < 2) return null;
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
