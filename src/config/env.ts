/**
 * Worker bindings and environment.
 *
 * Only ENVIRONMENT and (optionally) DATA_ENCRYPTION_KEY are deployment-level
 * values. Everything business-related is read from D1 at runtime.
 */
export interface Env {
  // --- Infrastructure bindings ---
  DB: D1Database;
  ARCHIVE_BUCKET: R2Bucket;
  INVOICE_SEQUENCE: DurableObjectNamespace;
  DOCUMENT_QUEUE: Queue<QueueMessage>;
  BROWSER: Fetcher;
  EMAIL: SendEmail;
  ASSETS: Fetcher;

  // --- Bootstrap-only values (non-business) ---
  ENVIRONMENT: string;
  /** Optional. If absent, encrypted secret storage is disabled (degraded). */
  DATA_ENCRYPTION_KEY?: string;
}

/** Cloudflare `send_email` binding shape. */
export interface SendEmail {
  send(message: unknown): Promise<void>;
}

/** Messages placed on DOCUMENT_QUEUE. */
export type QueueMessage =
  | { type: 'PROCESS_RECEIVED_EMAIL'; receivedEmailId: string }
  | { type: 'PROCESS_RECEIVED_INVOICE'; receivedInvoiceId: string }
  | { type: 'VALIDATE_RECEIVED_INVOICE'; receivedInvoiceId: string; level: 'BASIC' | 'STRICT' }
  | { type: 'RETRY_ISSUE'; invoiceId: string; idempotencyKey: string }
  | { type: 'SEND_INVOICE_EMAIL'; outboundEmailId: string };
