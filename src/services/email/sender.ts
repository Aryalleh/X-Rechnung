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

export interface OutboundMessage {
  from: string;
  fromName?: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  attachment?: { filename: string; mime: string; bytes: Uint8Array };
}

export interface SendResult {
  messageId: string;
  provider: string;
}

export interface EmailProvider {
  readonly name: string;
  send(env: Env, msg: OutboundMessage): Promise<SendResult>;
}

/** Build a raw RFC822 MIME message (multipart/mixed when there's an attachment). */
export function buildMime(msg: OutboundMessage): { raw: string; messageId: string } {
  const domain = msg.from.split('@')[1] ?? 'localhost';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const fromHeader = msg.fromName ? `${encodeWord(msg.fromName)} <${msg.from}>` : msg.from;
  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${msg.to}`,
    ...(msg.cc ? [`Cc: ${msg.cc}`] : []),
    ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []),
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    `Subject: ${encodeWord(msg.subject)}`,
    'MIME-Version: 1.0',
  ];

  if (!msg.attachment) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    const body = bytesToBase64(new TextEncoder().encode(msg.text));
    return { raw: `${headers.join('\r\n')}\r\n\r\n${chunk76(body)}\r\n`, messageId };
  }

  const boundary = `bnd_${crypto.randomUUID().replace(/-/g, '')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const textB64 = bytesToBase64(new TextEncoder().encode(msg.text));
  const attB64 = bytesToBase64(msg.attachment.bytes);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    chunk76(textB64),
    `--${boundary}`,
    `Content-Type: ${msg.attachment.mime}; name="${msg.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${msg.attachment.filename}"`,
    '',
    chunk76(attB64),
    `--${boundary}--`,
    '',
  ];
  return { raw: `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`, messageId };
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
    const email = new EmailMessage(msg.from, msg.to, raw);
    await env.EMAIL.send(email as unknown as object);
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

export async function resolveProvider(env: Env): Promise<EmailProvider> {
  if (providerOverride) return providerOverride;
  const { getGroup } = await import('../../db/repositories/settings-repo');
  const out = await getGroup(env.DB, 'EMAIL_OUTBOUND');
  const method = (out.method as string) ?? 'CLOUDFLARE_EMAIL_SERVICE';
  if (method === 'DISABLED') return new DisabledEmailProvider();
  return new CloudflareEmailProvider();
}
