import { one, all, run } from '../client';
import { newId } from '../../lib/ids';

export interface DocumentRow {
  id: string;
  entity_type: string;
  entity_id: string;
  document_role: string;
  r2_key: string;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number;
  sha256: string | null;
  immutable: number;
  retention_until: string | null;
  created_at: string;
}

export async function insertDocument(
  db: D1Database,
  input: Omit<DocumentRow, 'id' | 'created_at' | 'immutable'> & { immutable?: boolean },
): Promise<DocumentRow> {
  const id = newId('doc');
  await run(
    db,
    `INSERT INTO documents
       (id, entity_type, entity_id, document_role, r2_key, original_filename, mime_type, size_bytes, sha256, immutable, retention_until)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
    id, input.entity_type, input.entity_id, input.document_role, input.r2_key, input.original_filename ?? null,
    input.mime_type ?? null, input.size_bytes, input.sha256 ?? null, input.immutable === false ? 0 : 1,
    input.retention_until ?? null,
  );
  return (await one<DocumentRow>(db, `SELECT * FROM documents WHERE id = ?1`, id))!;
}

export function listDocuments(db: D1Database, entityType: string, entityId: string): Promise<DocumentRow[]> {
  return all<DocumentRow>(
    db,
    `SELECT * FROM documents WHERE entity_type = ?1 AND entity_id = ?2 ORDER BY created_at`,
    entityType, entityId,
  );
}

export function getDocument(db: D1Database, id: string): Promise<DocumentRow | null> {
  return one<DocumentRow>(db, `SELECT * FROM documents WHERE id = ?1`, id);
}

export function findByRole(db: D1Database, entityType: string, entityId: string, role: string): Promise<DocumentRow | null> {
  return one<DocumentRow>(
    db,
    `SELECT * FROM documents WHERE entity_type = ?1 AND entity_id = ?2 AND document_role = ?3 ORDER BY created_at DESC LIMIT 1`,
    entityType, entityId, role,
  );
}

export function documentsMissingHash(db: D1Database): Promise<DocumentRow[]> {
  return all<DocumentRow>(db, `SELECT * FROM documents WHERE sha256 IS NULL OR sha256 = ''`);
}
