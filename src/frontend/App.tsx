import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api } from './api';
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
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Bootstrap>('/system/bootstrap').then(setBoot).catch((e) => setError(String(e.message)));
  }, []);

  if (error) return <CenterMsg>{error}</CenterMsg>;
  if (!boot) return <CenterMsg>در حال بارگذاری…</CenterMsg>;

  if (boot.setupState !== 'ACTIVE') {
    return (
      <Routes>
        <Route path="/setup" element={<SetupWizard onDone={() => window.location.assign('/')} />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return <Shell appName={boot.appName} />;
}

function Shell({ appName }: { appName: string }) {
  const nav = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); nav('/'); }
      else if (e.key === 'n' && !isTyping()) nav('/invoices/new');
      else if (e.key === 'c' && !isTyping()) nav('/customers');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <span className="text-lg font-bold text-brand-600">{appName || 'X-Rechnung'}</span>
          <nav className="flex flex-wrap gap-1 text-sm">
            <Tab to="/">داشبورد</Tab>
            <Tab to="/invoices">فاکتورها</Tab>
            <Tab to="/invoices/new">فاکتور جدید</Tab>
            <Tab to="/customers">مشتریان</Tab>
            <Tab to="/inbox">E-Rechnung دریافتی</Tab>
            <Tab to="/settings">تنظیمات</Tab>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
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
  );
}

function Tab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `rounded-lg px-3 py-1.5 ${isActive ? 'bg-brand-50 text-brand-700 dark:bg-gray-800' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`
      }
    >
      {children}
    </NavLink>
  );
}

function CenterMsg({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-gray-500">{children}</div>;
}

function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
}
