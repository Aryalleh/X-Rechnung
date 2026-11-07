import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { MsgKey } from '../i18n';
import { Alert, EmptyState, Field, Icon, Loading, Spinner, useToast } from '../ui';
import type { IconName } from '../ui';

type Folder = 'INBOX' | 'STARRED' | 'SENT' | 'ARCHIVE' | 'TRASH';
interface Row {
  id: string; folder: string; direction: 'IN' | 'OUT'; from_email: string | null; from_name: string | null; to_email: string | null;
  subject: string | null; snippet: string | null; has_attachments: number; is_read: number; is_starred: number; status: string; created_at: string;
}
interface Att { id: string; filename: string; mime_type: string; size_bytes: number; content_id: string | null }
interface Detail extends Row {
  mailbox: string | null; cc_email: string | null; text_body: string | null; has_html: boolean; message_id: string | null;
  raw_r2_key: string | null; error_text: string | null; related_type: string | null; related_id: string | null; sent_by: string | null;
  attachments: Att[]; thread: { id: string; direction: string; from_email: string | null; from_name: string | null; subject: string | null; snippet: string | null; created_at: string; status: string }[];
}
interface Counts { folders: Record<string, { total: number; unread: number }>; starred: number }
export interface MailSettingsT { domain: string; addresses: string[]; invoiceAddresses: string[]; forwardTo: string | null; fromEmail: string; fromName: string; replyTo: string | null; signature: string }
export interface MailStatus {
  domain: string | null; sendBinding: boolean; mx: { ok: boolean; records: string[] }; spf: { ok: boolean; value: string | null }; dkim: { ok: boolean };
  fromEmail: string | null; lastInbound: string | null; lastOutbound: string | null; failed: number; senders: string[]; settings: MailSettingsT | null;
  me: { address: string | null; canManage: boolean; shared: boolean };
}
interface Draft { from: string; to: string; cc: string; bcc: string; subject: string; text: string; files: { filename: string; mime: string; data: string; size: number }[]; reply_to_id?: string; forward_id?: string; showCc: boolean }

const FOLDERS: { key: Folder; icon: IconName }[] = [
  { key: 'INBOX', icon: 'inbox' }, { key: 'STARRED', icon: 'star' }, { key: 'SENT', icon: 'send' }, { key: 'ARCHIVE', icon: 'archive' }, { key: 'TRASH', icon: 'trash' },
];
const MAX_BYTES = 20 * 1024 * 1024;

export function Mail() {
  const i18n = useI18n();
  const { t, num, locale } = i18n;
  const toast = useToast();
  const nav = useNavigate();
  const { id } = useParams();
  const [folder, setFolder] = useState<Folder>('INBOX');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadCounts = useCallback(() => api.get<Counts>('/mail/counts').then(setCounts).catch(() => {}), []);
  const loadList = useCallback(() => {
    const p = new URLSearchParams({ folder, limit: '100' });
    if (q.trim()) p.set('q', q.trim());
    return api.get<{ rows: Row[]; total: number }>(`/mail?${p}`).then((r) => { setRows(r.rows); setTotal(r.total); }).catch((e) => { setRows([]); setErr(errorText(e, i18n)); });
  }, [folder, q, i18n]);
  useEffect(() => { const h = setTimeout(() => void loadList(), q ? 250 : 0); return () => clearTimeout(h); }, [loadList, q]);
  useEffect(() => { void loadCounts(); }, [loadCounts, id]);
  useEffect(() => { api.get<MailStatus>('/mail/status').then(setStatus).catch(() => {}); }, []);
  // /mail?to=… (e.g. "Write email" on a contact) opens a new message.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const to = params.get('to');
    if (!to || !status) return;
    setDraft({ from: status.me.address || status.senders[0] || '', to, cc: '', bcc: '', subject: '', text: '', files: [], showCc: false });
    setParams({}, { replace: true });
  }, [params, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { void loadList(); void loadCounts(); };
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return new Intl.DateTimeFormat(locale, today ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short' }).format(d);
  };
  const compose = (patch: Partial<Draft> = {}) => setDraft({
    from: status?.me.address || status?.senders[0] || '', to: '', cc: '', bcc: '', subject: '', text: '', files: [], showCc: false, ...patch,
  });

  const canManage = !!status?.me.canManage;
  const setupMode = id === 'setup' && canManage;
  const devicesMode = id === 'devices';
  const configured = (status?.senders.length ?? 0) > 0;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-4rem)] sm:-mx-8 sm:-my-8">
      {/* Folders */}
      <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface p-4 lg:flex">
        <button className="btn-primary mb-6 h-11 w-full" onClick={() => compose()} disabled={!configured} title={configured ? undefined : t('mail.need_setup')}>
          <Icon name="pencil" />{t('mail.compose')}
        </button>
        <nav className="flex flex-col gap-1" aria-label={t('mail.folders')}>
          {FOLDERS.map((f) => {
            const c = f.key === 'STARRED' ? counts?.starred ?? 0 : f.key === 'INBOX' ? counts?.folders.INBOX?.unread ?? 0 : f.key === 'TRASH' || f.key === 'ARCHIVE' ? 0 : 0;
            const active = folder === f.key && !setupMode && !devicesMode;
            return (
              <button key={f.key} onClick={() => { setFolder(f.key); if (id) nav('/mail'); }}
                className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active ? 'bg-primary-soft text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
                <Icon name={f.icon} className="h-[18px] w-[18px]" />
                <span className="flex-1 text-start">{t(`mail.f_${f.key}` as MsgKey)}</span>
                {c > 0 && <span className={`tabular rounded-full px-2 text-[11px] font-semibold ${f.key === 'INBOX' ? 'bg-primary text-on-primary' : 'text-muted'}`}>{num(c)}</span>}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-line pt-4">
          <Link to="/mail/devices" className={`mb-1 flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium ${devicesMode ? 'bg-primary-soft text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
            <Icon name="phone" className="h-[18px] w-[18px]" /><span className="flex-1">{t('mail.devices')}</span>
          </Link>
          {canManage && <Link to="/mail/setup" className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium ${setupMode ? 'bg-primary-soft text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
            <Icon name="server" className="h-[18px] w-[18px]" /><span className="flex-1">{t('mail.server')}</span>
            {status && <span className={`h-2 w-2 rounded-full ${status.mx.ok && configured ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />}
          </Link>}
          {status && (
            <div className="mt-3 space-y-3 px-3 text-xs text-muted">
              {status.me.shared && status.senders.some((a) => a !== status.me.address) && (
                <div className="space-y-1">
                  <div className="eyebrow text-[10px]">{t('mail.shared_box')}</div>
                  {status.senders.filter((a) => a !== status.me.address).slice(0, 4).map((a) => <div key={a} className="truncate" dir="ltr">{a}</div>)}
                </div>
              )}
              <div className="space-y-1">
                <div className="eyebrow text-[10px]">{t('mail.personal_box')}</div>
                {status.me.address ? <div className="truncate" dir="ltr">{status.me.address}</div> : <div>{t('mail.no_mailbox')}</div>}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* List */}
      <section className={`flex min-w-0 flex-col border-e border-line bg-surface md:w-[24rem] md:shrink-0 xl:w-[28rem] ${id ? 'max-md:hidden' : 'flex-1 md:flex-none'}`}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input h-10 ps-9" placeholder={t('mail.search')} aria-label={t('mail.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn-ghost btn-icon h-10 w-10" aria-label={t('mail.refresh')} onClick={refresh}><Icon name="refresh" /></button>
          <button className="btn-primary btn-icon h-10 w-10 lg:hidden" aria-label={t('mail.compose')} onClick={() => compose()} disabled={!configured}><Icon name="pencil" /></button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 lg:hidden">
          {FOLDERS.map((f) => (
            <button key={f.key} onClick={() => { setFolder(f.key); if (id) nav('/mail'); }} className={`h-8 whitespace-nowrap rounded-full px-3 text-xs font-medium ${folder === f.key ? 'bg-primary text-on-primary' : 'bg-surface-2 text-muted'}`}>{t(`mail.f_${f.key}` as MsgKey)}</button>
          ))}
          <Link to="/mail/devices" className="flex h-8 items-center whitespace-nowrap rounded-full bg-surface-2 px-3 text-xs font-medium text-muted">{t('mail.devices')}</Link>
          {canManage && <Link to="/mail/setup" className="flex h-8 items-center whitespace-nowrap rounded-full bg-surface-2 px-3 text-xs font-medium text-muted">{t('mail.server')}</Link>}
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted">
          <span className="font-semibold uppercase tracking-wider">{t(`mail.f_${folder}` as MsgKey)}</span>
          <span className="tabular">{num(total)}</span>
        </div>
        {err && <div className="px-3"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
        <div className="flex-1 overflow-y-auto">
          {!rows ? <Loading /> : rows.length === 0 ? (
            <EmptyState icon="mail" title={q ? t('mail.no_results') : t('mail.empty')} />
          ) : (
            <ul>
              {rows.map((r) => {
                const who = r.direction === 'OUT' ? `${t('mail.to')}: ${r.to_email ?? ''}` : (r.from_name || r.from_email || '—');
                const unread = !r.is_read && r.direction === 'IN';
                return (
                  <li key={r.id}>
                    <button onClick={() => nav(`/mail/${r.id}`)}
                      className={`flex w-full gap-3 border-b border-line px-4 py-3 text-start transition-colors ${id === r.id ? 'bg-primary-soft/60' : 'hover:bg-surface-2'}`}>
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <bdi className={`min-w-0 flex-1 truncate text-sm ${unread ? 'font-bold' : 'font-medium'}`}>{who}</bdi>
                          <span className="shrink-0 text-[11px] text-muted">{fmtTime(r.created_at)}</span>
                        </span>
                        <span className={`mt-0.5 flex items-center gap-1.5 text-[13px] ${unread ? 'font-semibold text-fg' : 'text-fg/90'}`}>
                          <bdi className="min-w-0 flex-1 truncate">{r.subject || t('mail.no_subject')}</bdi>
                          {r.status === 'FAILED' && <span className="badge-status bg-danger-soft text-danger">{t('mail.failed')}</span>}
                          {!!r.has_attachments && <Icon name="paperclip" className="h-3.5 w-3.5 shrink-0 text-muted" />}
                          {!!r.is_starred && <Icon name="star" className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />}
                        </span>
                        <bdi className="mt-0.5 block truncate text-xs text-muted">{r.snippet}</bdi>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Reader / setup */}
      <section className={`min-w-0 flex-1 overflow-y-auto bg-bg ${id ? '' : 'max-md:hidden'}`}>
        {setupMode ? (
          <div className="mx-auto max-w-3xl p-4 sm:p-8">
            <button className="btn-ghost btn-sm mb-4 md:hidden" onClick={() => nav('/mail')}><Icon name="arrowLeft" flip />{t('mail.back')}</button>
            <MailServerCard onSaved={(s) => setStatus(s)} />
          </div>
        ) : devicesMode ? (
          <div className="mx-auto max-w-3xl p-4 sm:p-8">
            <button className="btn-ghost btn-sm mb-4 md:hidden" onClick={() => nav('/mail')}><Icon name="arrowLeft" flip />{t('mail.back')}</button>
            <MailDevices />
          </div>
        ) : id ? (
          <Reader key={id} id={id} onChanged={refresh} fmtTime={fmtTime}
            onCompose={(p) => compose(p)} onBack={() => nav('/mail')} toast={toast} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-line-strong shadow-sm"><Icon name="mail" className="h-8 w-8" /></span>
            <p className="text-sm">{t('mail.pick')}</p>
            {status && !configured && (canManage ? <Link to="/mail/setup" className="btn-primary btn-sm"><Icon name="server" />{t('mail.setup_now')}</Link> : <p className="text-xs">{t('mail.no_mailbox_hint')}</p>)}
          </div>
        )}
      </section>

      {draft && <Compose draft={draft} setDraft={setDraft} senders={status?.senders ?? []} onSent={(ok) => { setDraft(null); toast(ok ? t('mail.sent') : t('mail.send_failed'), ok ? 'success' : 'danger'); refresh(); }} />}
    </div>
  );
}

function Reader({ id, onChanged, onCompose, onBack, fmtTime, toast }: {
  id: string; onChanged: () => void; onCompose: (p: Partial<Draft>) => void; onBack: () => void; fmtTime: (iso: string) => string;
  toast: (m: string, tone?: 'success' | 'danger') => void;
}) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const nav = useNavigate();
  const [m, setM] = useState<Detail | null | undefined>(undefined);
  const [images, setImages] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(400);
  useEffect(() => { api.get<Detail>(`/mail/${id}`).then((d) => { setM(d); onChanged(); }).catch(() => setM(null)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (m === undefined) return <Loading />;
  if (m === null) return <EmptyState icon="mail" title={t('mail.not_found')} />;
  const full = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const act = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    try { await fn(); onChanged(); after?.(); } catch (e) { toast(errorText(e, i18n), 'danger'); } finally { setBusy(null); }
  };
  const patch = (body: Record<string, unknown>) => act('patch', () => api.patch(`/mail/${m.id}`, body), () => setM({ ...m, ...body } as Detail));
  const quote = () => `\n\n${t('mail.quote_head', { date: full(m.created_at), who: m.from_name || m.from_email || '' })}\n${(m.text_body ?? '').split('\n').map((l) => `> ${l}`).join('\n')}`;
  const re = (s: string | null) => (/^re:/i.test(s ?? '') ? s ?? '' : `Re: ${s ?? ''}`);
  const replyFrom = m.direction === 'IN' ? m.mailbox ?? undefined : m.from_email ?? undefined;
  const relatedTo = m.related_type === 'received_invoice' ? `/inbox/${m.related_id}` : m.related_type === 'invoice' ? `/invoices/${m.related_id}` : m.related_type === 'contract' ? `/contracts/${m.related_id}` : null;

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <div className="mb-4 flex flex-wrap items-center gap-1">
        <button className="btn-ghost btn-icon h-9 w-9 md:hidden" aria-label={t('mail.back')} onClick={onBack}><Icon name="arrowLeft" flip /></button>
        {m.direction === 'IN' && <>
          <button className="btn-secondary btn-sm" onClick={() => onCompose({ to: m.from_email ?? '', subject: re(m.subject), text: quote(), reply_to_id: m.id, ...(replyFrom ? { from: replyFrom } : {}) })}><Icon name="reply" flip />{t('mail.reply')}</button>
          <button className="btn-ghost btn-sm" onClick={() => onCompose({ to: m.from_email ?? '', cc: [m.to_email, m.cc_email].filter(Boolean).join(', ').split(',').map((x) => x.trim()).filter((x) => x && !x.includes(m.mailbox ?? '\u0000')).join(', '), showCc: true, subject: re(m.subject), text: quote(), reply_to_id: m.id, ...(replyFrom ? { from: replyFrom } : {}) })}><Icon name="replyAll" flip />{t('mail.reply_all')}</button>
        </>}
        <button className="btn-ghost btn-sm" onClick={() => onCompose({ subject: `Fwd: ${m.subject ?? ''}`, text: `\n\n---------- ${t('mail.fwd_head')} ----------\n${t('mail.from')}: ${m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}\n${t('mail.date')}: ${full(m.created_at)}\n${t('mail.subject')}: ${m.subject ?? ''}\n${t('mail.to')}: ${m.to_email ?? ''}\n\n${m.text_body ?? ''}`, forward_id: m.id })}><Icon name="forward" flip />{t('mail.forward')}</button>
        <span className="ms-auto" />
        <button className="btn-ghost btn-icon h-9 w-9" aria-label={t('mail.star')} aria-pressed={!!m.is_starred} onClick={() => void patch({ is_starred: !m.is_starred })}>
          <Icon name="star" className={m.is_starred ? 'h-4 w-4 fill-warning text-warning' : 'h-4 w-4'} />
        </button>
        {m.direction === 'IN' && <button className="btn-ghost btn-icon h-9 w-9" aria-label={t('mail.mark_unread')} title={t('mail.mark_unread')} onClick={() => void act('unread', () => api.patch(`/mail/${m.id}`, { is_read: false }), onBack)}><Icon name="mail" /></button>}
        {m.folder !== 'ARCHIVE' && m.folder !== 'TRASH' && <button className="btn-ghost btn-icon h-9 w-9" aria-label={t('mail.archive')} title={t('mail.archive')} onClick={() => void act('arch', () => api.patch(`/mail/${m.id}`, { folder: 'ARCHIVE' }), onBack)}><Icon name="archive" /></button>}
        {(m.folder === 'ARCHIVE' || m.folder === 'TRASH') && <button className="btn-ghost btn-sm" onClick={() => void act('restore', () => api.patch(`/mail/${m.id}`, { folder: m.direction === 'IN' ? 'INBOX' : 'SENT' }), onBack)}>{t('mail.restore')}</button>}
        <button className="btn-ghost btn-icon h-9 w-9 hover:text-danger" aria-label={m.folder === 'TRASH' ? t('mail.delete_forever') : t('mail.delete')} title={m.folder === 'TRASH' ? t('mail.delete_forever') : t('mail.delete')}
          onClick={() => void act('del', () => api.del(`/mail/${m.id}`), onBack)}>{busy === 'del' ? <Spinner /> : <Icon name="trash" />}</button>
        {m.raw_r2_key && <a className="btn-ghost btn-icon h-9 w-9" href={`/api/mail/${m.id}/raw`} aria-label={t('mail.download_eml')} title={t('mail.download_eml')}><Icon name="download" /></a>}
      </div>

      <article className="card overflow-hidden">
        <header className="border-b border-line p-6">
          <h1 className="text-xl font-bold leading-snug"><bdi>{m.subject || t('mail.no_subject')}</bdi></h1>
          <div className="mt-4 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary-fg">{(m.from_name || m.from_email || '?').slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <bdi className="font-semibold">{m.from_name || m.from_email}</bdi>
                {m.from_name && <span className="text-xs text-muted" dir="ltr">&lt;{m.from_email}&gt;</span>}
              </div>
              <div className="truncate text-xs text-muted">{t('mail.to')}: <span dir="ltr">{m.to_email}</span>{m.cc_email && <> · Cc: <span dir="ltr">{m.cc_email}</span></>}</div>
            </div>
            <time className="shrink-0 text-xs text-muted" dateTime={m.created_at}>{full(m.created_at)}</time>
          </div>
          {m.status === 'FAILED' && <div className="mt-4"><Alert tone="danger">{t('mail.failed_detail')}: <span dir="ltr">{m.error_text}</span></Alert></div>}
          {relatedTo && (
            <Link to={relatedTo} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary-fg hover:underline">
              <Icon name={m.related_type === 'contract' ? 'fileSign' : 'file'} className="h-3.5 w-3.5" />{t(`mail.rel_${m.related_type}` as MsgKey)}
            </Link>
          )}
        </header>

        {m.has_html ? (
          <div>
            {!images && (
              <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-6 py-2 text-xs text-muted">
                <span>{t('mail.images_blocked')}</span>
                <button className="font-semibold text-primary-fg hover:underline" onClick={() => setImages(true)}>{t('mail.show_images')}</button>
              </div>
            )}
            <iframe ref={frame} title={m.subject ?? 'mail'} src={`/api/mail/${m.id}/html${images ? '?images=1' : ''}`}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="w-full border-0 bg-white" style={{ height: h }}
              onLoad={() => { try { const b = frame.current?.contentDocument?.documentElement; if (b) setH(Math.min(4000, Math.max(200, b.scrollHeight + 16))); } catch { /* cross-origin */ } }} />
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words p-6 text-sm leading-relaxed" dir="auto">{m.text_body || <span className="text-muted">{t('mail.empty_body')}</span>}</div>
        )}

        {m.attachments.length > 0 && (
          <footer className="border-t border-line p-6">
            <div className="eyebrow mb-3">{t('mail.attachments', { n: i18n.num(m.attachments.length) })}</div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {m.attachments.filter((a) => !a.content_id || !m.has_html).map((a) => {
                const einv = m.direction === 'IN' && /\.(xml|pdf)$/i.test(a.filename);
                return (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"><Icon name="paperclip" className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" dir="auto">{a.filename}</div>
                      <div className="text-xs text-muted">{fmtSize(a.size_bytes, locale)}</div>
                      {einv && m.related_type !== 'received_invoice' && (
                        <button className="mt-1 text-xs font-semibold text-primary-fg hover:underline" disabled={!!busy}
                          onClick={() => void act(`imp-${a.id}`, () => api.post<{ receivedInvoiceId: string | null }>(`/mail/${m.id}/attachments/${a.id}/import`).then((r) => {
                            toast(t('mail.imported'));
                            if (r.receivedInvoiceId) nav(`/inbox/${r.receivedInvoiceId}`);
                          }))}>
                          {busy === `imp-${a.id}` ? <Spinner /> : null}{t('mail.import_einvoice')}
                        </button>
                      )}
                    </div>
                    <a className="btn-ghost btn-icon h-9 w-9" href={`/api/mail/${m.id}/attachments/${a.id}?download=1`} aria-label={`${t('mail.download')} ${a.filename}`}><Icon name="download" /></a>
                  </li>
                );
              })}
            </ul>
          </footer>
        )}
      </article>

      {m.thread.length > 0 && (
        <section className="mt-6">
          <div className="eyebrow mb-3">{t('mail.thread')}</div>
          <ul className="space-y-2">
            {m.thread.map((x) => (
              <li key={x.id}>
                <Link to={`/mail/${x.id}`} className="card flex items-center gap-3 p-3 hover:border-line-strong">
                  <Icon name={x.direction === 'OUT' ? 'send' : 'inbox'} className="h-4 w-4 shrink-0 text-muted" flip={x.direction === 'OUT'} />
                  <bdi className="w-40 shrink-0 truncate text-sm font-medium">{x.from_name || x.from_email}</bdi>
                  <bdi className="min-w-0 flex-1 truncate text-xs text-muted">{x.snippet}</bdi>
                  <span className="shrink-0 text-xs text-muted">{fmtTime(x.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Compose({ draft, setDraft, senders, onSent }: { draft: Draft; setDraft: (d: Draft | null) => void; senders: string[]; onSent: (ok: boolean) => void }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [min, setMin] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const size = useMemo(() => draft.files.reduce((n, f) => n + f.size, 0), [draft.files]);
  // Address suggestions (contacts + customers) for the last address being typed.
  const [suggest, setSuggest] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    const parts = draft.to.split(',');
    const cur = parts[parts.length - 1]!.trim();
    if (cur.length < 2 || cur.includes('@') && /\.[a-z]{2,}$/i.test(cur)) { setSuggest([]); return; }
    const head = parts.slice(0, -1).map((x) => x.trim()).filter(Boolean);
    const h = setTimeout(() => {
      api.get<{ name: string; email: string }[]>(`/pim/contacts/suggest?q=${encodeURIComponent(cur)}`)
        .then((r) => setSuggest(r.map((x) => ({ value: [...head, x.email].join(', '), label: x.name || x.email })))).catch(() => setSuggest([]));
    }, 200);
    return () => clearTimeout(h);
  }, [draft.to]);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const added: Draft['files'] = [];
    for (const f of Array.from(list)) {
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(f); });
      added.push({ filename: f.name, mime: f.type || 'application/octet-stream', data, size: f.size });
    }
    if (size + added.reduce((n, f) => n + f.size, 0) > MAX_BYTES) { setErr(t('mail.too_large')); return; }
    set({ files: [...draft.files, ...added] });
  }
  async function send() {
    setErr(null);
    if (!draft.to.trim()) { setErr(t('mail.need_to')); return; }
    setBusy(true);
    try {
      const r = await api.post<{ status: string; error?: string }>('/mail/send', {
        from: draft.from || undefined, to: draft.to, cc: draft.cc || undefined, bcc: draft.bcc || undefined, subject: draft.subject, text: draft.text,
        attachments: draft.files.map(({ filename, mime, data }) => ({ filename, mime, data })),
        reply_to_id: draft.reply_to_id, forward_id: draft.forward_id,
      });
      if (r.status !== 'SENT') { setErr(`${t('mail.send_failed')}: ${r.error ?? ''}`); return; }
      onSent(true);
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }

  return (
    <div className="fixed bottom-0 end-0 z-40 flex w-full flex-col overflow-hidden rounded-t-xl border border-line bg-surface shadow-2xl sm:end-6 sm:w-[38rem]" role="dialog" aria-label={t('mail.new_message')}>
      <div className="flex items-center gap-2 bg-fg px-4 py-2.5 text-bg">
        <span className="flex-1 truncate text-sm font-semibold">{draft.subject || t('mail.new_message')}</span>
        <button className="rounded p-1 hover:bg-white/10" aria-label={min ? t('mail.expand') : t('mail.minimize')} onClick={() => setMin(!min)}><Icon name="chevronDown" className={`h-4 w-4 ${min ? 'rotate-180' : ''}`} /></button>
        <button className="rounded p-1 hover:bg-white/10" aria-label={t('common.close')} onClick={() => setDraft(null)}><Icon name="x" className="h-4 w-4" /></button>
      </div>
      {!min && <>
        <div className="divide-y divide-line border-b border-line text-sm">
          {senders.length > 1 && (
            <label className="flex items-center gap-2 px-4"><span className="w-14 text-muted">{t('mail.from')}</span>
              <select className="h-10 flex-1 bg-transparent outline-none" dir="ltr" value={draft.from} onChange={(e) => set({ from: e.target.value })}>{senders.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
          )}
          <label className="flex items-center gap-2 px-4"><span className="w-14 text-muted">{t('mail.to')}</span>
            <input className="h-10 flex-1 bg-transparent outline-none" dir="ltr" autoFocus={!draft.to} value={draft.to} onChange={(e) => set({ to: e.target.value })} placeholder="name@example.com" list="mail-suggest" autoComplete="off" />
            <datalist id="mail-suggest">{suggest.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</datalist>
            {!draft.showCc && <button type="button" className="text-xs font-medium text-muted hover:text-fg" onClick={() => set({ showCc: true })}>Cc/Bcc</button>}
          </label>
          {draft.showCc && <>
            <label className="flex items-center gap-2 px-4"><span className="w-14 text-muted">Cc</span><input className="h-10 flex-1 bg-transparent outline-none" dir="ltr" value={draft.cc} onChange={(e) => set({ cc: e.target.value })} /></label>
            <label className="flex items-center gap-2 px-4"><span className="w-14 text-muted">Bcc</span><input className="h-10 flex-1 bg-transparent outline-none" dir="ltr" value={draft.bcc} onChange={(e) => set({ bcc: e.target.value })} /></label>
          </>}
          <label className="flex items-center gap-2 px-4"><span className="w-14 text-muted">{t('mail.subject')}</span><input className="h-10 flex-1 bg-transparent outline-none" dir="auto" value={draft.subject} onChange={(e) => set({ subject: e.target.value })} /></label>
        </div>
        <textarea className="h-72 resize-none bg-surface p-4 text-sm leading-relaxed outline-none" dir="auto" autoFocus={!!draft.to} aria-label={t('mail.body')}
          value={draft.text} onChange={(e) => set({ text: e.target.value })} onFocus={(e) => { if (draft.reply_to_id || draft.forward_id) e.currentTarget.setSelectionRange(0, 0); }} />
        {draft.files.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-4 pb-2">
            {draft.files.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-xs">
                <Icon name="paperclip" className="h-3 w-3" /><span className="max-w-[12rem] truncate" dir="auto">{f.filename}</span><span className="text-muted">{fmtSize(f.size, locale)}</span>
                <button aria-label={`${t('common.delete')} ${f.filename}`} onClick={() => set({ files: draft.files.filter((_, j) => j !== i) })}><Icon name="x" className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        )}
        {draft.forward_id && <p className="px-4 pb-2 text-xs text-muted">{t('mail.fwd_attachments')}</p>}
        {err && <div className="px-4"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button className="btn-primary" onClick={() => void send()} disabled={busy}>{busy ? <Spinner /> : <Icon name="send" flip />}{t('mail.send')}</button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <button className="btn-ghost btn-icon h-10 w-10" aria-label={t('mail.attach')} title={t('mail.attach')} onClick={() => fileRef.current?.click()}><Icon name="paperclip" /></button>
          <span className="ms-auto text-xs text-muted">{size ? fmtSize(size, locale) : ''}</span>
          <button className="btn-ghost btn-icon h-10 w-10 hover:text-danger" aria-label={t('mail.discard')} title={t('mail.discard')} onClick={() => setDraft(null)}><Icon name="trash" /></button>
        </div>
      </>}
    </div>
  );
}

type MailForm = { mail_domain: string; addresses: string; invoice_addresses: string; forward_to: string; from_email: string; from_name: string; reply_to: string; signature: string };

/** Mail server status (DNS checks) and the mailbox/sender settings. Also used on the Team & Email page. */
interface Device { id: string; device_id: string; device_type: string | null; model: string | null; friendly_name: string | null; os: string | null; user_agent: string | null; blocked: number; first_seen: string; last_seen: string }

/** Connect phone mail apps over Exchange ActiveSync: settings to type in + connected devices. */
function MailDevices() {
  const i18n = useI18n();
  const { t, date } = i18n;
  const toast = useToast();
  const [d, setD] = useState<{ server: string; username: string; login: string; hasPassword: boolean; devices: Device[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.get<NonNullable<typeof d>>('/mail/devices').then(setD).catch((e) => setErr(errorText(e, i18n))), [i18n]);
  useEffect(() => { void load(); }, [load]);
  const act = async (dev: Device, action: 'block' | 'allow' | 'delete') => {
    try {
      if (action === 'delete') await api.del(`/mail/devices/${dev.id}`); else await api.post(`/mail/devices/${dev.id}/${action}`, {});
      toast(t('common.saved')); await load();
    } catch (e) { setErr(errorText(e, i18n)); }
  };
  const copy = (v: string) => { void navigator.clipboard?.writeText(v).then(() => toast(t('mail.dev_copied'))); };
  if (!d) return err ? <Alert tone="danger">{err}</Alert> : <Loading />;
  const rows: [string, string, boolean][] = [
    [t('mail.dev_email'), d.username, true],
    [t('mail.dev_server'), d.server, true],
    [t('mail.dev_user'), d.username, true],
    [t('mail.dev_password'), t('mail.dev_password_val'), false],
    [t('mail.dev_domain'), t('mail.dev_domain_val'), false],
    [t('mail.dev_ssl'), t('mail.dev_ssl_val'), false],
  ];
  const steps = (k: MsgKey) => t(k).split('\n');
  return (
    <div className="grid min-w-0 gap-6">
      {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
      <section className="card min-w-0 p-5 sm:p-6">
        <h2 className="text-lg font-bold">{t('mail.devices_title')}</h2>
        <p className="mt-1 text-[13px] text-muted">{t('mail.devices_sub')}</p>
        {!d.hasPassword && <div className="mt-4"><Alert tone="warning">{t('mail.dev_need_pw')}</Alert></div>}
        <dl className="mt-5 divide-y divide-line rounded-lg border border-line">
          {rows.map(([k, v, mono]) => (
            <div key={k} className="flex items-center gap-3 px-4 py-3">
              <dt className="w-24 shrink-0 text-[13px] text-muted sm:w-32">{k}</dt>
              <dd className={`min-w-0 flex-1 text-sm font-medium ${mono ? 'truncate font-mono' : ''}`} dir={mono ? 'ltr' : 'auto'}>{v}</dd>
              {mono && <button className="btn-ghost btn-sm" onClick={() => copy(v)}>{t('mail.dev_copy')}</button>}
            </div>
          ))}
        </dl>
        <div className="mt-5 grid gap-4 2xl:grid-cols-2">
          {(['android', 'ios'] as const).map((p) => (
            <div key={p} className="rounded-lg bg-surface-2 p-4">
              <h3 className="text-sm font-semibold">{t(`mail.dev_${p}_title` as MsgKey)}</h3>
              <ol className="mt-2 list-decimal space-y-1 ps-5 text-[13px] text-muted">{steps(`mail.dev_${p}_steps` as MsgKey).map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">{t('mail.dev_outlook_note')}</p>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-semibold">{t('mail.dev_list')}</h2>
          <button className="btn-ghost btn-icon h-9 w-9" aria-label={t('mail.refresh')} onClick={() => void load()}><Icon name="refresh" /></button>
        </div>
        {d.devices.length === 0 ? <div className="px-6 py-8 text-center text-sm text-muted">{t('mail.dev_none')}</div> : (
          <ul className="divide-y divide-line">
            {d.devices.map((dev) => (
              <li key={dev.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <span className={`flex h-10 w-10 items-center justify-center rounded-full ${dev.blocked ? 'bg-surface-2 text-muted' : 'bg-primary-soft text-primary-fg'}`}><Icon name="phone" className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{dev.friendly_name || dev.model || dev.device_type || dev.device_id}</div>
                  <div className="truncate text-xs text-muted">{[dev.device_type, dev.os].filter(Boolean).join(' · ')} · {t('mail.dev_last_seen')} {date(dev.last_seen)}</div>
                </div>
                {dev.blocked ? (
                  <>
                    <span className="badge-status bg-warning-soft text-warning">{t('mail.dev_blocked')}</span>
                    <button className="btn-secondary btn-sm" onClick={() => void act(dev, 'allow')}>{t('mail.dev_allow')}</button>
                    <button className="btn-ghost btn-sm" onClick={() => void act(dev, 'delete')}>{t('mail.dev_forget')}</button>
                  </>
                ) : <button className="btn-secondary btn-sm" onClick={() => void act(dev, 'block')}>{t('mail.dev_remove')}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function MailServerCard({ onSaved }: { onSaved?: (s: MailStatus) => void }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const toast = useToast();
  const [st, setSt] = useState<MailStatus | null>(null);
  const [f, setF] = useState<MailForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.get<MailStatus>('/mail/status').then((s) => {
    setSt(s);
    if (!s.settings) return s;
    setF({
      mail_domain: s.settings.domain, addresses: s.settings.addresses.join(', '), invoice_addresses: s.settings.invoiceAddresses.join(', '),
      forward_to: s.settings.forwardTo ?? '', from_email: s.settings.fromEmail, from_name: s.settings.fromName, reply_to: s.settings.replyTo ?? '', signature: s.settings.signature,
    });
    return s;
  }), []);
  useEffect(() => { void load().catch(() => setErr(t('common.error'))); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  if (st && !st.settings) return null;
  if (!st || !f) return err ? <Alert tone="danger">{err}</Alert> : <Loading />;

  async function save() {
    setErr(null); setBusy(true);
    try {
      const domain = f!.mail_domain.trim().toLowerCase() || (f!.from_email.split('@')[1] ?? '');
      await api.put('/settings/group/EMAIL_INBOUND', { mail_domain: domain, addresses: f!.addresses, invoice_addresses: f!.invoice_addresses, forward_to: f!.forward_to });
      await api.put('/settings/group/EMAIL_OUTBOUND', { from_email: f!.from_email.trim().toLowerCase(), from_name: f!.from_name, reply_to: f!.reply_to, signature: f!.signature });
      toast(t('common.saved'));
      const s = await load();
      onSaved?.(s);
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }
  const dt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');
  const checks: { ok: boolean; label: string; hint: string }[] = [
    { ok: !!st.domain, label: t('mail.chk_domain'), hint: st.domain ?? t('mail.chk_domain_hint') },
    { ok: st.mx.ok, label: t('mail.chk_mx'), hint: st.mx.records.length ? st.mx.records.join(', ') : t('mail.chk_mx_hint') },
    { ok: st.spf.ok, label: t('mail.chk_spf'), hint: st.spf.value ?? t('mail.chk_spf_hint') },
    { ok: st.dkim.ok, label: t('mail.chk_dkim'), hint: t('mail.chk_dkim_hint') },
    { ok: st.sendBinding && !!st.fromEmail, label: t('mail.chk_send'), hint: st.fromEmail ?? t('mail.chk_send_hint') },
  ];
  const ready = checks.every((c) => c.ok);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{t('mail.server_title')}</h2>
            <p className="mt-1 text-[13px] text-muted">{t('mail.server_sub')}</p>
          </div>
          <span className={`badge-status ${ready ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>{ready ? t('mail.ready') : t('mail.incomplete')}</span>
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${c.ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}><Icon name={c.ok ? 'check' : 'alert'} className="h-3 w-3" /></span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="truncate text-xs text-muted" dir="auto">{c.hint}</div>
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
          <div><dt className="text-muted">{t('mail.last_in')}</dt><dd className="mt-0.5 font-medium">{dt(st.lastInbound)}</dd></div>
          <div><dt className="text-muted">{t('mail.last_out')}</dt><dd className="mt-0.5 font-medium">{dt(st.lastOutbound)}</dd></div>
          <div><dt className="text-muted">{t('mail.failed_count')}</dt><dd className={`mt-0.5 font-medium ${st.failed ? 'text-danger' : ''}`}>{i18n.num(st.failed)}</dd></div>
        </dl>
        {!ready && (
          <ol className="mt-5 list-decimal space-y-1.5 rounded-lg bg-primary-soft/60 p-4 ps-8 text-[13px] text-primary-fg">
            <li>{t('mail.step1')}</li>
            <li>{t('mail.step2')}</li>
            <li>{t('mail.step3')}</li>
            <li>{t('mail.step4')}</li>
          </ol>
        )}
      </section>

      <form className="card space-y-5 p-6" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
        <h2 className="text-base font-bold">{t('mail.settings_title')}</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('mail.s_from_email')} htmlFor="m-from" hint={t('mail.s_from_email_hint')}>
            <input id="m-from" type="email" className="input" dir="ltr" placeholder="rechnung@example.com" value={f.from_email} onChange={(e) => setF({ ...f, from_email: e.target.value })} />
          </Field>
          <Field label={t('mail.s_from_name')} htmlFor="m-name">
            <input id="m-name" className="input" dir="auto" value={f.from_name} onChange={(e) => setF({ ...f, from_name: e.target.value })} />
          </Field>
          <Field label={t('mail.s_domain')} htmlFor="m-dom" hint={t('mail.s_domain_hint')}>
            <input id="m-dom" className="input" dir="ltr" placeholder="example.com" value={f.mail_domain} onChange={(e) => setF({ ...f, mail_domain: e.target.value })} />
          </Field>
          <Field label={t('mail.s_reply_to')} htmlFor="m-rt">
            <input id="m-rt" type="email" className="input" dir="ltr" value={f.reply_to} onChange={(e) => setF({ ...f, reply_to: e.target.value })} />
          </Field>
          <Field label={t('mail.s_addresses')} htmlFor="m-addr" hint={t('mail.s_addresses_hint')} className="sm:col-span-2">
            <input id="m-addr" className="input" dir="ltr" placeholder="info@example.com, kontakt@example.com" value={f.addresses} onChange={(e) => setF({ ...f, addresses: e.target.value })} />
          </Field>
          <Field label={t('mail.s_invoice_addresses')} htmlFor="m-inv" hint={t('mail.s_invoice_addresses_hint')} className="sm:col-span-2">
            <input id="m-inv" className="input" dir="ltr" placeholder="rechnungseingang@example.com" value={f.invoice_addresses} onChange={(e) => setF({ ...f, invoice_addresses: e.target.value })} />
          </Field>
          <Field label={t('mail.s_forward')} htmlFor="m-fw" hint={t('mail.s_forward_hint')} className="sm:col-span-2">
            <input id="m-fw" type="email" className="input" dir="ltr" value={f.forward_to} onChange={(e) => setF({ ...f, forward_to: e.target.value })} />
          </Field>
          <Field label={t('mail.s_signature')} htmlFor="m-sig" className="sm:col-span-2">
            <textarea id="m-sig" className="input" rows={3} dir="auto" value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : <Icon name="save" />}{t('common.save')}</button>
        </div>
      </form>
    </div>
  );
}

function fmtSize(bytes: number, locale: string): string {
  const u = bytes < 1024 ? ['byte', bytes] : bytes < 1024 ** 2 ? ['kilobyte', bytes / 1024] : ['megabyte', bytes / 1024 ** 2];
  return new Intl.NumberFormat(locale, { style: 'unit', unit: u[0] as string, unitDisplay: 'short', maximumFractionDigits: 1 }).format(u[1] as number);
}
