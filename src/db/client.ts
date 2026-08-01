/**
 * Thin D1 helpers. Every query uses bound parameters (prepared statements) —
 * no string interpolation of user input anywhere in the repository layer.
 */

export async function one<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  return (await stmt.first<T>()) ?? null;
}

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const res = await stmt.all<T>();
  return res.results ?? [];
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

/** Build a prepared statement (for batching in a transaction). */
export function stmt(db: D1Database, sql: string, ...params: unknown[]): D1PreparedStatement {
  return db.prepare(sql).bind(...params);
}

/** Run several statements atomically via D1 batch (implicit transaction). */
export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  return db.batch(statements);
}

/** Convert a JS boolean to D1 integer. */
export function bool(v: boolean | undefined | null): number {
  return v ? 1 : 0;
}
