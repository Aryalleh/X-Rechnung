import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Alert, Field, Icon, Logo, PasswordInput, Spinner } from '../ui';
import { LangSwitch } from '../App';

/** Password sign-in. Generic error text: never reveals whether an e-mail exists. */
export function Login({ appName, onLoggedIn }: { appName: string; onLoggedIn: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => { emailRef.current?.focus(); }, []);

  async function submit() {
    setErr(null); setBusy(true);
    try {
      await api.post('/auth/login', { email: email.trim(), password });
      onLoggedIn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setErr(code === 'RATE_LIMITED' ? t('verr.login_locked') : code === 'NETWORK' ? t('common.error_network') : t('verr.login_invalid'));
      setPassword('');
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="mb-6 flex w-full max-w-sm items-center justify-between">
        <div className="flex min-w-0 items-center gap-2.5"><Logo /><span className="truncate text-lg font-bold">{appName || t('app.name')}</span></div>
        <LangSwitch />
      </div>
      <main className="card w-full max-w-sm">
        <div className="border-b border-line px-6 py-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary-fg"><Icon name="lock" className="h-5 w-5" /></div>
          <h1 className="text-xl font-bold">{t('auth.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('auth.subtitle')}</p>
        </div>
        <form className="space-y-4 px-6 py-5" noValidate={false} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {err && <div role="alert"><Alert tone="danger">{err}</Alert></div>}
          <Field label={t('auth.email')} htmlFor="l-email">
            <input ref={emailRef} id="l-email" type="email" className="input" dir="ltr" required autoComplete="username"
              inputMode="email" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('auth.password')} htmlFor="l-pw">
            <PasswordInput id="l-pw" value={password} onChange={setPassword} autoComplete="current-password" required invalid={Boolean(err)} />
          </Field>
          <button className="btn-primary h-11 w-full justify-center" disabled={busy || !email || !password}>
            {busy ? <Spinner /> : <Icon name="lock" />}{t('auth.submit')}
          </button>
          <p className="text-xs text-muted">{t('auth.forgot_hint')}</p>
        </form>
      </main>
    </div>
  );
}
