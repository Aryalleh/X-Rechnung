import { useState } from 'react';
import { api } from '../api';

/** RTL Persian multi-step setup wizard. Nothing is hardcoded — owner, locale
 * and (optionally) Cloudflare Access/domain are all entered here. */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [owner, setOwner] = useState({ owner_name: '', owner_email: '', recovery_email: '', locale: 'fa', timezone: 'Europe/Berlin' });
  const [cf, setCf] = useState({ account_id: '', zone_id: '', zone_name: '', worker_script_name: 'x-rechnung', api_token: '', app_domain: '' });

  async function verify() {
    setErr(null);
    try { await api.post('/setup/verify-token', { setup_token: token }); setStep(2); }
    catch (e) { setErr((e as Error).message); }
  }
  async function saveOwner() {
    setErr(null);
    try { await api.post('/setup/owner', { setup_token: token, ...owner }); setStep(3); }
    catch (e) { setErr((e as Error).message); }
  }
  async function connectCf() {
    setErr(null);
    try { await api.post('/setup/cloudflare', { setup_token: token, owner_email: owner.owner_email, ...cf }); setStep(4); }
    catch (e) { setErr((e as Error).message); }
  }
  async function complete() {
    setErr(null);
    try { await api.post('/setup/complete', { setup_token: token, owner_email: owner.owner_email }); onDone(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      <div className="card w-full max-w-xl">
        <h1 className="mb-1 text-xl font-bold">راه‌اندازی اولیه X-Rechnung</h1>
        <p className="mb-4 text-sm text-gray-500">مرحله {step} از ۴</p>
        {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              کد راه‌اندازی یک‌بارمصرف در لاگ Worker چاپ شده است. آن را با
              <code className="mx-1 rounded bg-gray-100 px-1 dark:bg-gray-800">wrangler tail</code>
              مشاهده و اینجا وارد کنید.
            </p>
            <div><label className="label">Setup Token</label><input className="input" value={token} onChange={(e) => setToken(e.target.value)} /></div>
            <button className="btn-primary" onClick={verify}>تأیید کد</button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div><label className="label">نام مالک</label><input className="input" value={owner.owner_name} onChange={(e) => setOwner({ ...owner, owner_name: e.target.value })} /></div>
            <div><label className="label">ایمیل مالک (Owner Email)</label><input className="input" dir="ltr" value={owner.owner_email} onChange={(e) => setOwner({ ...owner, owner_email: e.target.value })} /></div>
            <div><label className="label">ایمیل بازیابی (اختیاری)</label><input className="input" dir="ltr" value={owner.recovery_email} onChange={(e) => setOwner({ ...owner, recovery_email: e.target.value })} /></div>
            <button className="btn-primary" onClick={saveOwner}>ذخیره و ادامه</button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              اتصال Cloudflare Access و دامنه. توکن فقط در همین مرحله استفاده و ذخیره نمی‌شود.
              برای شروع می‌توانید از این مرحله عبور کنید و بعداً از پنل تنظیمات انجام دهید.
            </p>
            {(['account_id', 'zone_id', 'zone_name', 'worker_script_name', 'app_domain', 'api_token'] as const).map((k) => (
              <div key={k}><label className="label">{k}</label>
                <input className="input" dir="ltr" type={k === 'api_token' ? 'password' : 'text'}
                  value={cf[k]} onChange={(e) => setCf({ ...cf, [k]: e.target.value })} /></div>
            ))}
            <div className="flex gap-2">
              <button className="btn-primary" onClick={connectCf}>ساخت Access و دامنه</button>
              <button className="btn-ghost" onClick={() => setStep(4)}>فعلاً رد شو</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              راه‌اندازی تقریباً کامل است. پس از تأیید، مسیر <code>/setup</code> بسته و کد راه‌اندازی باطل می‌شود.
            </p>
            <button className="btn-primary" onClick={complete}>تکمیل راه‌اندازی</button>
          </div>
        )}
      </div>
    </div>
  );
}
