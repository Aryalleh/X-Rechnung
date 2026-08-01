/** Data export: CSV, full JSON, and a yearly ZIP bundle with a manifest. */
import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { all } from '../db/client';
import { buildZip, type ZipEntry } from '../lib/zip';
import { toArrayBuffer } from '../lib/crypto';
import { fetchObject } from '../services/archive-service';
import { audit } from '../services/audit-service';

export const exportRoutes = new Hono<HonoEnv>();

function csv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((col) => cell(r[col])).join(','))].join('\n');
}

async function outgoingCsv(db: D1Database, year?: number): Promise<string> {
  const rows = await all<Record<string, unknown>>(
    db,
    year
      ? `SELECT invoice_number, document_type, status, invoice_date, due_date, customer_id, currency, total_cents, issued_at
           FROM invoices WHERE substr(invoice_date,1,4)=?1 AND invoice_number IS NOT NULL ORDER BY invoice_number`
      : `SELECT invoice_number, document_type, status, invoice_date, due_date, customer_id, currency, total_cents, issued_at
           FROM invoices WHERE invoice_number IS NOT NULL ORDER BY invoice_number`,
    ...(year ? [String(year)] : []),
  );
  return csv(rows, ['invoice_number', 'document_type', 'status', 'invoice_date', 'due_date', 'customer_id', 'currency', 'total_cents', 'issued_at']);
}

exportRoutes.get('/outgoing.csv', async (c) => {
  const body = await outgoingCsv(c.env.DB);
  return c.body(body, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="outgoing-invoices.csv"' });
});

exportRoutes.get('/incoming.csv', async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, `SELECT invoice_number, supplier_name, invoice_date, due_date, currency, gross_amount_cents, validation_status, duplicate_status FROM received_invoices ORDER BY created_at DESC`);
  return c.body(csv(rows, ['invoice_number', 'supplier_name', 'invoice_date', 'due_date', 'currency', 'gross_amount_cents', 'validation_status', 'duplicate_status']), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="incoming-invoices.csv"' });
});

exportRoutes.get('/payments.csv', async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, `SELECT invoice_id, payment_date, amount_cents, payment_method, bank_reference FROM payments ORDER BY payment_date`);
  return c.body(csv(rows, ['invoice_id', 'payment_date', 'amount_cents', 'payment_method', 'bank_reference']), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="payments.csv"' });
});

/** Yearly ZIP bundle: CSVs + documents + a manifest. */
exportRoutes.get('/year/:year.zip', async (c) => {
  const year = Number(c.req.param('year'));
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];

  entries.push({ name: 'outgoing-invoices.csv', data: enc.encode(await outgoingCsv(c.env.DB, year)) });
  const incoming = await all<Record<string, unknown>>(c.env.DB, `SELECT invoice_number, supplier_name, invoice_date, currency, gross_amount_cents, validation_status FROM received_invoices WHERE substr(invoice_date,1,4)=?1`, String(year));
  entries.push({ name: 'incoming-invoices.csv', data: enc.encode(csv(incoming, ['invoice_number', 'supplier_name', 'invoice_date', 'currency', 'gross_amount_cents', 'validation_status'])) });
  const payments = await all<Record<string, unknown>>(c.env.DB, `SELECT invoice_id, payment_date, amount_cents, payment_method FROM payments WHERE substr(payment_date,1,4)=?1`, String(year));
  entries.push({ name: 'payments.csv', data: enc.encode(csv(payments, ['invoice_id', 'payment_date', 'amount_cents', 'payment_method'])) });
  const customers = await all<Record<string, unknown>>(c.env.DB, `SELECT customer_code, company_name, last_name, email, city FROM customers`);
  entries.push({ name: 'customers.csv', data: enc.encode(csv(customers, ['customer_code', 'company_name', 'last_name', 'email', 'city'])) });
  const auditRows = await all<Record<string, unknown>>(c.env.DB, `SELECT created_at, entity_type, entity_id, event_type, actor_email FROM audit_events WHERE substr(created_at,1,4)=?1`, String(year));
  entries.push({ name: 'audit-events.csv', data: enc.encode(csv(auditRows, ['created_at', 'entity_type', 'entity_id', 'event_type', 'actor_email'])) });

  // Documents + manifest.
  const docs = await all<{ id: string; document_role: string; r2_key: string; original_filename: string; sha256: string; size_bytes: number; created_at: string; retention_until: string; entity_type: string }>(
    c.env.DB,
    `SELECT id, document_role, r2_key, original_filename, sha256, size_bytes, created_at, retention_until, entity_type FROM documents WHERE substr(created_at,1,4)=?1`,
    String(year),
  );
  const manifest: Record<string, unknown>[] = [];
  for (const doc of docs) {
    const obj = await fetchObject(c.env.ARCHIVE_BUCKET, doc.r2_key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const folder = doc.entity_type === 'invoice' ? 'outgoing' : doc.entity_type === 'received_invoice' ? 'incoming' : 'email';
    const name = `documents/${folder}/${doc.original_filename ?? doc.id}`;
    entries.push({ name, data: bytes });
    manifest.push({ filename: name, document_type: doc.document_role, sha256: doc.sha256, size: doc.size_bytes, created_at: doc.created_at, retention_until: doc.retention_until });
  }
  entries.push({ name: 'documents-manifest.csv', data: enc.encode(csv(manifest, ['filename', 'document_type', 'sha256', 'size', 'created_at', 'retention_until'])) });
  entries.push({ name: 'README.txt', data: enc.encode(readme(year)) });

  await audit(c.env.DB, { entityType: 'system', eventType: 'EXPORT_CREATED', actorEmail: c.get('actor')!.email, metadata: { kind: 'year_zip', year, documents: manifest.length } });

  const zip = buildZip(entries);
  return new Response(toArrayBuffer(zip), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="x-rechnung-${year}.zip"`,
    },
  });
});

function readme(year: number): string {
  return `X-Rechnung Jahresarchiv ${year}\n\n` +
    `Inhalt:\n- outgoing-invoices.csv\n- incoming-invoices.csv\n- payments.csv\n- customers.csv\n` +
    `- audit-events.csv\n- documents-manifest.csv (filename, document_type, sha256, size, created_at, retention_until)\n` +
    `- documents/ (PDF, XML, EML)\n\n` +
    `Die SHA-256-Werte im Manifest ermöglichen die Integritätsprüfung jeder Datei.\n` +
    `Dieses Archiv dient der nachvollziehbaren Aufbewahrung und ersetzt keine Steuerberatung.\n`;
}
