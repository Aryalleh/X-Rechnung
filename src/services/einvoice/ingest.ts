/**
 * Ingest orchestration for incoming e-invoices (upload OR email attachment).
 *
 * Pipeline: verify size/signature → archive original immutably → detect format
 * → (if structured) parse → basic validate → duplicate check → persist. The
 * original file is never modified. In ZUGFeRD, the embedded XML is the
 * authoritative structured source and is archived alongside the PDF.
 */
import type { Env } from '../../config/env';
import { sha256Hex } from '../../lib/crypto';
import { berlinToday } from '../../lib/format';
import { AppError } from '../../lib/errors';
import { storeImmutable } from '../archive-service';
import { audit } from '../audit-service';
import { getEInvoiceSettings } from '../settings-service';
import { detectFormat } from './detect';
import { parseInvoiceXml, type ExtractedInvoice } from './parse';
import { basicValidate, strictValidate } from './validate';
import { detectDuplicate } from './duplicate';
import {
  createReceivedInvoice, addReceivedFile, setValidationStatus, setDuplicate, recordValidationResult,
} from '../../db/repositories/received-repo';

export interface IngestInput {
  bytes: Uint8Array;
  filename: string;
  declaredMime: string;
  source: 'EMAIL' | 'UPLOAD';
  receivedEmailId?: string;
  actorEmail?: string;
}

export interface IngestResult {
  receivedInvoiceId: string | null;
  format: string;
  structured: boolean;
  validationStatus: string;
  duplicateStatus: string;
  note?: string;
}

export async function ingestFile(env: Env, input: IngestInput): Promise<IngestResult> {
  const settings = await getEInvoiceSettings(env.DB);
  if (input.bytes.byteLength > settings.max_file_bytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', `file ${input.bytes.byteLength} > ${settings.max_file_bytes}`);
  }

  const fileSha = await sha256Hex(input.bytes);
  const today = berlinToday();

  const detection = await detectFormat(input.bytes);

  // Not a structured e-invoice (plain PDF or unknown): archive + record, no parse.
  if (!detection.structured || !detection.xmlRoot) {
    // Still archive the file for the record, but mark clearly.
    const isPdf = detection.format === 'PDF_PLAIN';
    if (!isPdf && detection.format === 'UNKNOWN') {
      throw new AppError('NOT_STRUCTURED_EINVOICE', detection.note);
    }
    // Store plain PDF as a received document with UNSUPPORTED_FORMAT structured status.
    const empty: ExtractedInvoice = emptyExtraction(detection.format);
    const rid = await createReceivedInvoice(env.DB, empty, { source: input.source, ...(input.receivedEmailId ? { receivedEmailId: input.receivedEmailId } : {}), fileSha256: fileSha });
    const stored = await storeImmutable({
      db: env.DB, bucket: env.ARCHIVE_BUCKET, area: 'incoming', date: today,
      entityType: 'received_invoice', entityId: rid, documentRole: 'source_pdf',
      filename: input.filename, mimeType: 'application/pdf', body: input.bytes,
    });
    await addReceivedFile(env.DB, rid, { role: 'source_pdf', r2Key: stored.r2Key, filename: input.filename, mime: 'application/pdf', size: stored.size, sha256: stored.sha256 });
    await setValidationStatus(env.DB, rid, 'UNSUPPORTED_FORMAT');
    await recordValidationResult(env.DB, rid, 'BASIC', 'UNSUPPORTED_FORMAT', { messages: [detection.note ?? 'PDF ohne strukturiertes XML'] });
    await audit(env.DB, { entityType: 'received_invoice', entityId: rid, eventType: 'EINVOICE_PARSED', actorEmail: input.actorEmail ?? null, metadata: { format: detection.format, structured: false } });
    return { receivedInvoiceId: rid, format: detection.format, structured: false, validationStatus: 'UNSUPPORTED_FORMAT', duplicateStatus: 'NOT_DUPLICATE', ...(detection.note ? { note: detection.note } : {}) };
  }

  // Structured: parse.
  const extracted = parseInvoiceXml(detection.xmlRoot, detection.format);
  const rid = await createReceivedInvoice(env.DB, extracted, {
    source: input.source,
    ...(input.receivedEmailId ? { receivedEmailId: input.receivedEmailId } : {}),
    fileSha256: fileSha,
  });

  // Archive the original file.
  const isPdfCarrier = detection.format === 'ZUGFERD';
  const originalMime = isPdfCarrier ? 'application/pdf' : 'application/xml';
  const originalRole = isPdfCarrier ? 'source_pdf' : 'source_xml';
  const storedOriginal = await storeImmutable({
    db: env.DB, bucket: env.ARCHIVE_BUCKET, area: 'incoming', date: today,
    entityType: 'received_invoice', entityId: rid, documentRole: originalRole,
    filename: input.filename, mimeType: originalMime, body: input.bytes,
  });
  await addReceivedFile(env.DB, rid, { role: originalRole, r2Key: storedOriginal.r2Key, filename: input.filename, mime: originalMime, size: storedOriginal.size, sha256: storedOriginal.sha256 });

  // For ZUGFeRD, also archive the extracted structured XML (authoritative source).
  if (isPdfCarrier && detection.xml) {
    const storedXml = await storeImmutable({
      db: env.DB, bucket: env.ARCHIVE_BUCKET, area: 'incoming', date: today,
      entityType: 'received_invoice', entityId: rid, documentRole: 'source_xml',
      filename: `${input.filename}.factur-x.xml`, mimeType: 'application/xml', body: detection.xml,
    });
    await addReceivedFile(env.DB, rid, { role: 'source_xml', r2Key: storedXml.r2Key, filename: 'factur-x.xml', mime: 'application/xml', size: storedXml.size, sha256: storedXml.sha256 });
  }

  await audit(env.DB, { entityType: 'received_invoice', entityId: rid, eventType: 'EINVOICE_PARSED', actorEmail: input.actorEmail ?? null, metadata: { format: extracted.format } });

  // Basic validation.
  const basic = basicValidate(extracted);
  await recordValidationResult(env.DB, rid, 'BASIC', basic.status, { validatorName: 'in-worker', messages: basic.messages });

  // Strict validation (KoSIT if configured; otherwise BASIC_CHECK_ONLY).
  let finalStatus: string = basic.status;
  const strict = await strictValidate(env, detection.xml!);
  await recordValidationResult(env.DB, rid, 'STRICT', strict.status, {
    validatorName: strict.validatorName, validatorVersion: strict.validatorVersion,
    rulesetVersion: strict.rulesetVersion, report: strict.report, messages: strict.messages,
  });
  if (strict.status === 'STRICT_VALID' || strict.status === 'STRICT_INVALID') finalStatus = strict.status;
  else if (basic.status === 'BASIC_VALID') finalStatus = strict.status === 'BASIC_CHECK_ONLY' ? 'BASIC_CHECK_ONLY' : basic.status;
  await setValidationStatus(env.DB, rid, finalStatus);
  await audit(env.DB, { entityType: 'received_invoice', entityId: rid, eventType: 'EINVOICE_VALIDATED', metadata: { status: finalStatus } });

  // Duplicate detection.
  const dup = await detectDuplicate(env.DB, extracted, fileSha, rid);
  await setDuplicate(env.DB, rid, dup.level, dup.matchId);
  if (dup.level !== 'NOT_DUPLICATE') {
    await audit(env.DB, { entityType: 'received_invoice', entityId: rid, eventType: 'DUPLICATE_DETECTED', metadata: { level: dup.level, match: dup.matchId, reason: dup.reason } });
  }

  return { receivedInvoiceId: rid, format: extracted.format, structured: true, validationStatus: finalStatus, duplicateStatus: dup.level };
}

function emptyExtraction(format: string): ExtractedInvoice {
  return {
    format: format as ExtractedInvoice['format'],
    profileId: null, customizationId: null, documentType: null, supplierName: null, supplierAddress: null,
    supplierTaxId: null, supplierVatId: null, invoiceNumber: null, invoiceDate: null, dueDate: null,
    serviceDate: null, servicePeriod: null, currency: null, netAmountCents: null, taxAmountCents: null,
    grossAmountCents: null, paymentTerms: null, iban: null, bic: null, buyerReference: null,
    purchaseOrderReference: null, contractReference: null, lines: [],
  };
}
