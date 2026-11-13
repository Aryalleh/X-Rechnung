import { describe, it, expect } from 'vitest';
import { boxFilter, boxOf, canSee, scopeFor, scopeSql, senderAddresses, type MailScope, type MailSettings } from '../src/services/mail-service';

const settings = { fromEmail: 'info@aryalleh.ir', addresses: ['sales@aryalleh.ir', 'ali@aryalleh.ir'] } as unknown as MailSettings;
const assigned = ['ali@aryalleh.ir', 'sara@aryalleh.ir'];

describe('mailbox scope', () => {
  const ali: MailScope = { own: 'ali@aryalleh.ir', shared: false, assigned };
  const owner: MailScope = { own: null, shared: true, assigned };
  const ownerWithBox: MailScope = { own: 'boss@aryalleh.ir', shared: true, assigned: [...assigned, 'boss@aryalleh.ir'] };

  it('email-only user sees only their own mailbox', () => {
    expect(canSee(ali, 'ali@aryalleh.ir')).toBe(true);
    expect(canSee(ali, 'ALI@aryalleh.ir')).toBe(true);
    expect(canSee(ali, 'info@aryalleh.ir')).toBe(false);
    expect(canSee(ali, 'sara@aryalleh.ir')).toBe(false);
  });
  it('owner sees shared mail but not other users\' personal mailboxes', () => {
    expect(canSee(owner, 'info@aryalleh.ir')).toBe(true);
    expect(canSee(owner, null)).toBe(true);
    expect(canSee(owner, 'sara@aryalleh.ir')).toBe(false);
    expect(canSee(ownerWithBox, 'boss@aryalleh.ir')).toBe(true);
  });
  it('builds matching SQL', () => {
    const p: unknown[] = [];
    expect(scopeSql(ali, p)).toBe(`(lower(coalesce(mailbox,'')) = ?1)`);
    expect(p).toEqual(['ali@aryalleh.ir']);
    expect(scopeSql({ own: null, shared: false, assigned: [] }, [])).toBe('0=1');
  });
  it('owner can open any business mail, but sends only as before', () => {
    const o: MailScope = { ...ownerWithBox, all: true };
    expect(canSee(o, 'sara@aryalleh.ir')).toBe(true);
    expect(canSee(o, null)).toBe(true);
    expect(scopeSql(o, [])).toBe('1=1');
    expect(senderAddresses(settings, o)).toEqual(senderAddresses(settings, ownerWithBox));
  });
  it('splits the owner\'s mail into personal, platform and business mailboxes', () => {
    const own = 'boss@aryalleh.ir';
    const platform = 'info@aryalleh.ir';
    const box = (b: 'personal' | 'platform' | 'business'): MailScope => ({ ...ownerWithBox, all: true, filter: boxFilter(b, own, platform) });
    for (const [mb, b] of [[own, 'personal'], [platform, 'platform'], ['sara@aryalleh.ir', 'business'], ['sales@aryalleh.ir', 'business'], [null, 'business']] as const) {
      expect(boxOf(mb, own, platform)).toBe(b);
      for (const other of ['personal', 'platform', 'business'] as const) expect(canSee(box(other), mb)).toBe(other === b);
    }
    const p: unknown[] = [];
    expect(scopeSql(box('business'), p)).toBe(`(lower(coalesce(mailbox,'')) NOT IN (?1,?2))`);
    expect(p).toEqual([own, platform]);
    // No personal address assigned: the personal mailbox is empty.
    expect(scopeSql({ ...owner, all: true, filter: boxFilter('personal', null, platform) }, [])).toBe('(0=1)');
  });
  it('only the OWNER gets owner access and mailboxes', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) } as unknown as D1Database;
    await expect(scopeFor(db, { email: 'a@x', role: 'ADMIN', via: 'dev' }, { box: 'business' })).rejects.toThrow();
    await expect(scopeFor(db, { email: 'u@x', role: 'MAIL_USER', via: 'dev' }, { box: 'personal' })).rejects.toThrow();
    expect((await scopeFor(db, { email: 'a@x', role: 'ADMIN', via: 'dev' }, { owner: true })).all).toBeUndefined();
    expect((await scopeFor(db, { email: 'o@x', role: 'OWNER', via: 'dev' }, { owner: true })).all).toBe(true);
    // Phone sync (no options) keeps the classic own+shared scope.
    expect((await scopeFor(db, { email: 'o@x', role: 'OWNER', via: 'dev' })).all).toBeUndefined();
  });
  it('limits sender addresses', () => {
    expect(senderAddresses(settings, ali)).toEqual(['ali@aryalleh.ir']);
    expect(senderAddresses(settings, owner)).toEqual(['info@aryalleh.ir', 'sales@aryalleh.ir']);
  });
});
