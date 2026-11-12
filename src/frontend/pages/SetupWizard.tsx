import { useState } from 'react';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { InstallMode, MsgKey } from '../i18n';
import { Alert, Field, Icon, Logo, PasswordInput, Spinner } from '../ui';
import { LangSwitch } from '../App';

/** Multi-step setup wizard. No setup secret: the first owner submission wins. */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const i18n = useI18n();
  const { t, lang, setMode } = i18n;
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pw2, setPw2] = useState('');
  const [owner, setOwner] = useState({ owner_name: '', owner_email: '', owner_password: '', recovery_email: '', timezone: 'Europe/Berlin', invoice_mode: 'both' as InstallMode });
  const [cf, setCf] = useState({ account_id: '', zone_id: '', zone_name: '', worker_script_name: 'invoice', app_domain: '', api_token: '' });

  async function run(fn: () => Promise<void>) {
    setErr(null);
    setBusy(true);
    try { await fn(); } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }

  const steps: MsgKey[] = ['setup.s_owner', 'setup.s_cloudflare', 'setup.s_finish'];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="mb-6 flex w-full max-w-xl items-center justify-between">
        <div className="flex items-center gap-2.5"><Logo /><span className="text-lg font-bold">X-Rechnung</span></div>
        <LangSwitch />
      </div>
      <div className="card w-full max-w-xl">
        <div className="border-b border-line px-6 py-5">
          <h1 className="text-xl font-bold">{t('setup.title')}</h1>
          <ol className="mt-4 flex items-center gap-2" aria-label={t('setup.step', { n: step, total: 3 })}>
            {steps.map((s, i) => {
              const n = i + 1;
              const state = n < step ? 'done' : n === step ? 'current' : 'todo';
              return (
                <li key={s} className="flex flex-1 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${state === 'todo' ? 'bg-surface-2 text-muted' : 'bg-primary text-on-primary'}`}>
                    {state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" /> : i18n.num(n)}
                  </span>
                  <span className={`truncate text-sm ${state === 'current' ? 'font-medium text-fg' : 'text-muted'}`}>{t(s)}</span>
                  {n < 3 && <span className="h-px flex-1 bg-line" />}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="px-6 py-5">
          {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}

          {step === 1 && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => {
              if (owner.owner_password !== pw2) throw new Error(t('set.pw_mismatch'));
              await api.post('/setup/owner', { ...owner, locale: lang });
              setStep(2);
            }); }}>
              <Field label={t('setup.owner_name')} htmlFor="s-name">
                <input id="s-name" className="input" required autoComplete="name" value={owner.owner_name} onChange={(e) => setOwner({ ...owner, owner_name: e.target.value })} />
              </Field>
              <Field label={t('setup.owner_email')} htmlFor="s-email">
                <input id="s-email" type="email" className="input" dir="ltr" required autoComplete="email" value={owner.owner_email} onChange={(e) => setOwner({ ...owner, owner_email: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('setup.owner_password')} htmlFor="s-pw" hint={t('set.pw_hint')}>
                  <PasswordInput id="s-pw" value={owner.owner_password} onChange={(v) => setOwner({ ...owner, owner_password: v })} autoComplete="new-password" required minLength={10} />
                </Field>
                <Field label={t('setup.owner_password_confirm')} htmlFor="s-pw2" error={pw2 && pw2 !== owner.owner_password ? t('set.pw_mismatch') : undefined}>
                  <PasswordInput id="s-pw2" value={pw2} onChange={setPw2} autoComplete="new-password" required minLength={10} invalid={Boolean(pw2 && pw2 !== owner.owner_password)} />
                </Field>
              </div>
              <Field label={`${t('setup.recovery_email')} (${t('common.optional')})`} htmlFor="s-rec">
                <input id="s-rec" type="email" className="input" dir="ltr" value={owner.recovery_email} onChange={(e) => setOwner({ ...owner, recovery_email: e.target.value })} />
              </Field>
              <fieldset>
                <legend className="label">{t('setup.profile')}</legend>
                <div className="grid gap-2">
                  {(['both', 'de', 'fa'] as InstallMode[]).map((m) => (
                    <label key={m} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${owner.invoice_mode === m ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2'}`}>
                      <input type="radio" name="mode" className="accent-[rgb(var(--primary))]" checked={owner.invoice_mode === m}
                        onChange={() => { setOwner({ ...owner, invoice_mode: m }); setMode(m); }} />
                      {t(`setup.profile_${m}` as MsgKey)}
                    </label>
                  ))}
                </div>
                <p className="hint">{t('setup.profile_hint')}</p>
              </fieldset>
              <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-muted">
                <Icon name="info" className="mt-0.5 h-4 w-4" />{t('setup.first_owner')}
              </div>
              <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : null}{t('common.continue')}</button>
            </form>
          )}

          {step === 2 && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => {
              await api.post('/setup/cloudflare', { owner_email: owner.owner_email, ...cf });
              setStep(3);
            }); }}>
              <p className="text-sm text-muted">{t('setup.cf_intro')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(cf) as (keyof typeof cf)[]).map((k) => (
                  <Field key={k} label={t(`setup.cf.${k}` as MsgKey)} htmlFor={`cf-${k}`} className={k === 'api_token' ? 'sm:col-span-2' : ''}>
                    <input id={`cf-${k}`} className="input" dir="ltr" required type={k === 'api_token' ? 'password' : 'text'} autoComplete="off"
                      value={cf[k]} onChange={(e) => setCf({ ...cf, [k]: e.target.value })} />
                  </Field>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : null}{t('setup.cf_create')}</button>
                <button type="button" className="btn-secondary" onClick={() => setStep(3)}>{t('setup.skip')}</button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted">{t('setup.finish_intro')}</p>
              <button className="btn-primary w-full" disabled={busy} onClick={() => void run(async () => {
                await api.post('/setup/complete', { owner_email: owner.owner_email });
                onDone();
              })}>{busy ? <Spinner /> : <Icon name="check" />}{t('setup.finish')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
