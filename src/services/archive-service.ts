/**
 * R2 archive service.
 *
 * Objects are written under year/month-partitioned prefixes and are treated as
 * immutable: we never overwrite an existing key. Corrections always create a
 * new object under a new key. The bucket itself should carry an R2 object-lock
 * retention of 8 years on the `archive/` prefix (see README) — this service
 * additionally records retention_until in D1 metadata.
 */
import { DEFAULTS } from '../config/constants';
import { sha256Hex } from '../lib/crypto';
import { insertDocument } from '../db/repositories/document-repo';
import { AppError } from '../lib/errors';

export type ArchiveArea = 'outgoing' | 'incoming' | 'email' | 'export';

function partition(area: ArchiveArea, date: string, filename: string): string {
  const yyyy = date.slice(0, 4);
  const mm = date.slice(5, 7);
  // Random component prevents accidental key reuse / collisions.
  const rand = crypto.randomUUID().slice(0, 8);
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  return `archive/${area}/${yyyy}/${mm}/${rand}_${safe}`;
}

function retentionUntil(fromDate: string, years = DEFAULTS.retentionYears): string {
  const y = Number(fromDate.slice(0, 4)) + years;
  return `${y}${fromDate.slice(4, 10)}`;
}

export interface StoreOptions {
  db: D1Database;
  bucket: R2Bucket;
  area: ArchiveArea;
  date: string; // YYYY-MM-DD
  entityType: string;
  entityId: string;
  documentRole: string;
  filename: string;
  mimeType: string;
  body: ArrayBuffer | Uint8Array | string;
}

export interface StoredObject {
  r2Key: string;
  sha256: string;
  size: number;
  documentId: string;
}

/** Store an object immutably and record its document row + SHA-256. */
export async function storeImmutable(opts: StoreOptions): Promise<StoredObject> {
  const bytes =
    typeof opts.body === 'string'
      ? new TextEncoder().encode(opts.body)
      : opts.body instanceof Uint8Array
        ? opts.body
        : new Uint8Array(opts.body);
  const key = partition(opts.area, opts.date, opts.filename);

  // Refuse to overwrite (belt-and-braces; keys are randomized anyway).
  const existing = await opts.bucket.head(key);
  if (existing) throw new AppError('CONFLICT', `archive key already exists: ${key}`);

  const hash = await sha256Hex(bytes);
  await opts.bucket.put(key, bytes, {
    httpMetadata: { contentType: opts.mimeType },
    customMetadata: {
      sha256: hash,
      entityType: opts.entityType,
      entityId: opts.entityId,
      documentRole: opts.documentRole,
      retentionUntil: retentionUntil(opts.date),
    },
  });

  const doc = await insertDocument(opts.db, {
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    document_role: opts.documentRole,
    r2_key: key,
    original_filename: opts.filename,
    mime_type: opts.mimeType,
    size_bytes: bytes.byteLength,
    sha256: hash,
    retention_until: retentionUntil(opts.date),
  });

  return { r2Key: key, sha256: hash, size: bytes.byteLength, documentId: doc.id };
}

/** Fetch object bytes for an authenticated download. */
export async function fetchObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}
