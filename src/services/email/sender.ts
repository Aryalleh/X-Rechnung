/**
 * Outbound email adapter.
 *
 * The default provider uses the Cloudflare `send_email` binding. The interface
 * is provider-agnostic so an external ESP can be swapped in from the panel
 * (EMAIL_OUTBOUND settings) without touching call sites. Full email bodies are
 * never written to the general log.
 */
import type { Env } from '../../config/env';
import { bytesToBase64 } from '../../lib/crypto';

export interface OutboundAttachment { filename: string; mime: string; bytes: Uint8Array }

export interface OutboundMessage {
  from: string;
  fromName?: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  /** Optional HTML alternative (sent as multipart/alternative next to the text). */
  html?: string;
  attachment?: OutboundAttachment;
  attachments?: OutboundAttachment[];
  /** Threading: Message-ID of the mail being answered, and its References chain. */
  inReplyTo?: string;
  references?: string;
}

export interface SendResult {
  messageId: string;
  provider: string;
}

export interface EmailProvider {
  readonly name: string;
  send(env: Env, msg: OutboundMessage): Promise<SendResult>;
}

/** Split a comma/semicolon separated address list. */
export function addressList(v?: string | null): string[] {
  return (v ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

/** Every envelope recipient (To, Cc, Bcc), de-duplicated, bare addresses only. */
export function envelopeRecipients(msg: OutboundMessage): string[] {
  const all = [...addressList(msg.to), ...addressList(msg.cc), ...addressList(msg.bcc)]
    .map((a) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim().toLowerCase());
  return [...new Set(all)];
}

const b64 = (s: string | Uint8Array) => chunk76(bytesToBase64(typeof s === 'string' ? new TextEncoder().encode(s) : s));

/** Build a raw RFC822 MIME message: text (+ html alternative) (+ attachments). Bcc never appears in headers. */
export function buildMime(msg: OutboundMessage): { raw: string; messageId: string } {
  const domain = msg.from.split('@')[1] ?? 'localhost';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const fromHeader = msg.fromName ? `${encodeWord(msg.fromName)} <${msg.from}>` : msg.from;
  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${msg.to}`,
    ...(msg.cc ? [`Cc: ${msg.cc}`] : []),
    ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []),
    ...(msg.inReplyTo ? [`In-Reply-To: ${msg.inReplyTo}`] : []),
    ...(msg.references || msg.inReplyTo ? [`References: ${[msg.references, msg.inReplyTo].filter(Boolean).join(' ')}`] : []),
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    `Subject: ${encodeWord(msg.subject)}`,
    'MIME-Version: 1.0',
  ];
  const leaf = (type: string, body: string, extra: string[] = []) =>
    ({ head: [`Content-Type: ${type}`, 'Content-Transfer-Encoding: base64', ...extra], body });
  const multi = (kind: string, parts: { head: string[]; body: string }[]) => {
    const boundary = `bnd_${crypto.randomUUID().replace(/-/g, '')}`;
    const body = parts.map((p) => `--${boundary}\r\n${p.head.join('\r\n')}\r\n\r\n${p.body}`).join('\r\n') + `\r\n--${boundary}--\r\n`;
    return { head: [`Content-Type: multipart/${kind}; boundary="${boundary}"`], body };
  };

  const text = leaf('text/plain; charset=utf-8', b64(msg.text));
  const content = msg.html ? multi('alternative', [text, leaf('text/html; charset=utf-8', b64(msg.html))]) : text;
  const atts = [...(msg.attachment ? [msg.attachment] : []), ...(msg.attachments ?? [])];
  const root = atts.length
    ? multi('mixed', [content, ...atts.map((a) => leaf(`${a.mime}; name="${asciiName(a.filename)}"`, b64(a.bytes), [`Content-Disposition: attachment; ${fileParam(a.filename)}`]))])
    : content;
  return { raw: `${[...headers, ...root.head].join('\r\n')}\r\n\r\n${root.body}${root.body.endsWith('\r\n') ? '' : '\r\n'}`, messageId };
}

function asciiName(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
}
/** filename="ascii" plus RFC 2231 filename* for non-ASCII names. */
function fileParam(name: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(name)) return `filename="${name.replace(/"/g, "'")}"`;
  return `filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function chunk76(s: string): string {
  return s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}
function encodeWord(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(s))}?=`;
}

/** Cloudflare send_email provider. */
export class CloudflareEmailProvider implements EmailProvider {
  readonly name = 'CLOUDFLARE_EMAIL_SERVICE';
  async send(env: Env, msg: OutboundMessage): Promise<SendResult> {
    const { EmailMessage } = await import('cloudflare:email');
    const { raw, messageId } = buildMime(msg);
    // One EmailMessage per envelope recipient: the binding takes a single "to".
    for (const rcpt of envelopeRecipients(msg)) {
      await env.EMAIL.send(new EmailMessage(msg.from, rcpt, raw) as unknown as object);
    }
    return { messageId, provider: this.name };
  }
}

/** Disabled provider — used when outbound email is turned off in settings. */
export class DisabledEmailProvider implements EmailProvider {
  readonly name = 'DISABLED';
  async send(): Promise<SendResult> {
    throw new Error('Outbound email is disabled in settings');
  }
}

let providerOverride: EmailProvider | null = null;
export function setEmailProvider(p: EmailProvider | null): void {
  providerOverride = p;
}

/** Provider for system mail (invoices, contracts, password links): every attempt is copied to the mailbox "Sent" folder. */
export async function resolveProvider(env: Env, opts: { log?: boolean; related?: { type: string; id: string } } = {}): Promise<EmailProvider> {
  const base = await resolveBaseProvider(env);
  if (opts.log === false) return base;
  return {
    name: base.name,
    async send(e: Env, msg: OutboundMessage): Promise<SendResult> {
      const { recordOutbound } = await import('../mail-service');
      try {
        const res = await base.send(e, msg);
        await recordOutbound(e, msg, { messageId: res.messageId, related: opts.related }).catch(() => undefined);
        return res;
      } catch (err) {
        await recordOutbound(e, msg, { error: err instanceof Error ? err.message : String(err), related: opts.related }).catch(() => undefined);
        throw err;
      }
    },
  };
}

export async function resolveBaseProvider(env: Env): Promise<EmailProvider> {
  if (providerOverride) return providerOverride;
  const { getGroup } = await import('../../db/repositories/settings-repo');
  const out = await getGroup(env.DB, 'EMAIL_OUTBOUND');
  const method = (out.method as string) ?? 'CLOUDFLARE_EMAIL_SERVICE';
  if (method === 'DISABLED') return new DisabledEmailProvider();
  return new CloudflareEmailProvider();
}
