import { describe, it, expect } from 'vitest';
import { canSee, scopeFor, scopeSql, senderAddresses, type MailScope, type MailSettings } from '../src/services/mail-service';

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
  it('owner supervisor view sees every mailbox, but sends only as before', () => {
    const sup: MailScope = { ...owner, all: true };
    expect(canSee(sup, 'sara@aryalleh.ir')).toBe(true);
    expect(canSee(sup, 'ali@aryalleh.ir')).toBe(true);
    expect(canSee(sup, null)).toBe(true);
    const p: unknown[] = [];
    expect(scopeSql(sup, p)).toBe('1=1');
    expect(p).toEqual([]);
    expect(senderAddresses(settings, sup)).toEqual(senderAddresses(settings, owner));
  });
  it('only the OWNER may open the supervisor view', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }), all: async () => ({ results: [] }) }) } as unknown as D1Database;
    await expect(scopeFor(db, { email: 'a@x', role: 'ADMIN', via: 'dev' }, { all: true })).rejects.toThrow();
    await expect(scopeFor(db, { email: 'u@x', role: 'MAIL_USER', via: 'dev' }, { all: true })).rejects.toThrow();
    expect((await scopeFor(db, { email: 'o@x', role: 'OWNER', via: 'dev' }, { all: true })).all).toBe(true);
    expect((await scopeFor(db, { email: 'o@x', role: 'OWNER', via: 'dev' })).all).toBeUndefined();
  });
  it('limits sender addresses', () => {
    expect(senderAddresses(settings, ali)).toEqual(['ali@aryalleh.ir']);
    expect(senderAddresses(settings, owner)).toEqual(['info@aryalleh.ir', 'sales@aryalleh.ir']);
  });
});
