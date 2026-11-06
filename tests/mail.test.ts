import { describe, expect, it } from 'vitest';
import { buildMime, envelopeRecipients } from '../src/services/email/sender';
import { bodiesOf, htmlToText, parseAddress, parseEmail } from '../src/email/mime';

const enc = (s: string) => new TextEncoder().encode(s);

describe('mailbox MIME', () => {
  it('round-trips text, html, attachments and reply headers', () => {
    const { raw, messageId } = buildMime({
      from: 'billing@example.com', fromName: 'Müller & Co', to: 'a@x.de', cc: 'B <b@x.de>', bcc: 'secret@x.de',
      subject: 'Rechnung März – فاکتور', text: 'Hallo\nسلام', html: '<p>Hallo <b>Welt</b></p>',
      attachments: [{ filename: 'Rechnung-März.pdf', mime: 'application/pdf', bytes: enc('%PDF-1.4 test') }],
      inReplyTo: '<orig@x.de>', references: '<root@x.de>',
    });
    expect(raw).not.toContain('secret@x.de');
    const p = parseEmail(enc(raw));
    expect(p.subject).toBe('Rechnung März – فاکتور');
    expect(p.messageId).toBe(messageId);
    expect(p.headers['in-reply-to']).toBe('<orig@x.de>');
    expect(p.headers['references']).toBe('<root@x.de> <orig@x.de>');
    const b = bodiesOf(p);
    expect(b.text).toBe('Hallo\nسلام');
    expect(b.html).toBe('<p>Hallo <b>Welt</b></p>');
    expect(b.attachments).toHaveLength(1);
    expect(new TextDecoder().decode(b.attachments[0]!.body)).toBe('%PDF-1.4 test');
    expect(parseAddress(p.from)).toEqual({ name: 'Müller & Co', email: 'billing@example.com' });
  });

  it('lists every envelope recipient once', () => {
    expect(envelopeRecipients({ from: 'f@x', to: 'A <a@x.de>, b@x.de', cc: 'a@x.de', bcc: 'c@x.de', subject: '', text: '' }))
      .toEqual(['a@x.de', 'b@x.de', 'c@x.de']);
  });

  it('turns html into readable text without markup', () => {
    expect(htmlToText('<style>p{}</style><p>Hi&nbsp;there</p><p>2 &lt; 3</p>')).toBe('Hi there\n2 < 3');
  });
});
