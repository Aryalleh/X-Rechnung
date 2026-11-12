import { describe, expect, it } from 'vitest';
import { HIERARCHY_VERSION, hierarchyOutdated } from '../src/eas/activesync';
import { contactProps } from '../src/eas/pim';
import { encode, el } from '../src/eas/wbxml';

/** Minimal D1 stand-in: records UPDATE statements. */
function fakeDb() {
  const writes: unknown[][] = [];
  const db = { prepare: (sql: string) => ({ bind: (...p: unknown[]) => ({ run: async () => { writes.push([sql, ...p]); return {}; } }) }) };
  return { db, writes };
}
const ctxWith = (device: Record<string, unknown>) => {
  const { db, writes } = fakeDb();
  return { ctx: { env: { DB: db }, device: { id: 'd1', ...device } } as never, writes };
};

describe('folder hierarchy hint', () => {
  it('tells a phone set up before contacts/notes/tasks to re-read the folder list', async () => {
    const { ctx, writes } = ctxWith({ hierarchy_key: null, hierarchy_hint_at: null });
    expect(await hierarchyOutdated(ctx)).toBe(true);
    expect(writes).toHaveLength(1);
    // Throttled: a client that ignores the hint keeps syncing mail normally.
    expect(await hierarchyOutdated(ctx)).toBe(false);
  });

  it('does nothing for a phone that already has the current folder list', async () => {
    const { ctx, writes } = ctxWith({ hierarchy_key: String(HIERARCHY_VERSION), hierarchy_hint_at: null });
    expect(await hierarchyOutdated(ctx)).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it('hints again after the throttle window', async () => {
    const { ctx } = ctxWith({ hierarchy_key: '1', hierarchy_hint_at: new Date(Date.now() - 3_600_000).toISOString() });
    expect(await hierarchyOutdated(ctx)).toBe(true);
  });
});

describe('contact encoding', () => {
  it('drops fields that are not ActiveSync contact properties instead of failing the whole Sync', () => {
    const c = { data_json: JSON.stringify({ FirstName: 'Sara', Nickname: 'S', notes: 'x', Email1Address: 'sara@example.com' }), body: null, categories_json: null } as never;
    const props = contactProps(c, [{ type: 1 }]).filter(Boolean) as ReturnType<typeof el>[];
    expect(props.map((p) => p.tag)).toEqual(['Contacts:FirstName', 'Contacts:Email1Address']);
    expect(() => encode(el('AirSync:ApplicationData', props))).not.toThrow();
  });
});
