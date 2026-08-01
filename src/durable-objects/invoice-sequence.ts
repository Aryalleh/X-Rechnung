/**
 * InvoiceSequence — Durable Object providing gap-free, concurrency-safe
 * invoice numbering per (prefix, year) with a RESERVED / CONFIRMED / VOID
 * ledger and idempotency keys.
 *
 * Numbers are only ever handed out once. On issue we RESERVE; on success we
 * CONFIRM; on failure we VOID. A VOID number is never handed out again — the
 * counter only moves forward — which keeps the audit trail clean and honest
 * about failed issue attempts.
 *
 * All access to a given (prefix, year) is serialized through the same DO
 * instance (id derived from `${prefix}:${year}`), and each mutating request
 * is wrapped in `blockConcurrencyWhile` so double-clicks / racing requests
 * cannot allocate the same number.
 */

interface LedgerEntry {
  sequence: number;
  formatted: string;
  state: 'RESERVED' | 'CONFIRMED' | 'VOID';
  invoiceId?: string;
  idempotencyKey?: string;
  reason?: string;
  at: string;
}

interface CounterState {
  prefix: string;
  year: number;
  digits: number;
  last: number; // highest number ever handed out
}

export class InvoiceSequence {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\//, '');
    const body = request.method === 'POST' ? await request.json<Record<string, unknown>>().catch(() => ({})) : {};

    switch (action) {
      case 'reserve':
        return this.reserve(body);
      case 'confirm':
        return this.confirm(body);
      case 'void':
        return this.void(body);
      case 'ledger':
        return this.ledger();
      default:
        return json({ error: 'unknown action' }, 400);
    }
  }

  /** Reserve the next number. Idempotent by idempotencyKey. */
  private async reserve(body: Record<string, unknown>): Promise<Response> {
    const prefix = String(body.prefix ?? 'RE');
    const year = Number(body.year);
    const digits = Number(body.digits ?? 6);
    const invoiceId = body.invoiceId ? String(body.invoiceId) : undefined;
    const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : undefined;

    if (!Number.isInteger(year)) return json({ error: 'year required' }, 400);

    let result: LedgerEntry | undefined;
    await this.state.blockConcurrencyWhile(async () => {
      // Idempotency: return existing reservation for the same key.
      if (idempotencyKey) {
        const existing = await this.findByIdempotency(idempotencyKey);
        if (existing) {
          result = existing;
          return;
        }
      }

      const counter = await this.getCounter(prefix, year, digits);
      const next = counter.last + 1;
      const formatted = `${prefix}-${year}-${String(next).padStart(digits, '0')}`;
      const entry: LedgerEntry = {
        sequence: next,
        formatted,
        state: 'RESERVED',
        ...(invoiceId ? { invoiceId } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        at: new Date().toISOString(),
      };
      counter.last = next;
      await this.state.storage.put(`counter`, counter);
      await this.state.storage.put(`entry:${next}`, entry);
      if (idempotencyKey) await this.state.storage.put(`idem:${idempotencyKey}`, next);
      result = entry;
    });

    return json(result);
  }

  private async confirm(body: Record<string, unknown>): Promise<Response> {
    return this.transition(body, 'CONFIRMED');
  }

  private async void(body: Record<string, unknown>): Promise<Response> {
    return this.transition(body, 'VOID');
  }

  private async transition(body: Record<string, unknown>, target: 'CONFIRMED' | 'VOID'): Promise<Response> {
    const sequence = Number(body.sequence);
    const reason = body.reason ? String(body.reason) : undefined;
    if (!Number.isInteger(sequence)) return json({ error: 'sequence required' }, 400);

    let result: LedgerEntry | { error: string } = { error: 'not found' };
    await this.state.blockConcurrencyWhile(async () => {
      const entry = await this.state.storage.get<LedgerEntry>(`entry:${sequence}`);
      if (!entry) return;
      // CONFIRMED is terminal; VOID after CONFIRMED is not allowed.
      if (entry.state === 'CONFIRMED' && target === 'VOID') {
        result = { error: 'already confirmed' };
        return;
      }
      entry.state = target;
      if (reason) entry.reason = reason;
      entry.at = new Date().toISOString();
      await this.state.storage.put(`entry:${sequence}`, entry);
      result = entry;
    });

    if ('error' in result) return json(result, 409);
    return json(result);
  }

  private async ledger(): Promise<Response> {
    const map = await this.state.storage.list<LedgerEntry>({ prefix: 'entry:' });
    const entries = [...map.values()].sort((a, b) => a.sequence - b.sequence);
    const counter = await this.state.storage.get<CounterState>('counter');
    return json({ counter: counter ?? null, entries });
  }

  private async getCounter(prefix: string, year: number, digits: number): Promise<CounterState> {
    const existing = await this.state.storage.get<CounterState>('counter');
    if (existing) return existing;
    return { prefix, year, digits, last: 0 };
  }

  private async findByIdempotency(key: string): Promise<LedgerEntry | undefined> {
    const seq = await this.state.storage.get<number>(`idem:${key}`);
    if (seq === undefined) return undefined;
    return this.state.storage.get<LedgerEntry>(`entry:${seq}`);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
