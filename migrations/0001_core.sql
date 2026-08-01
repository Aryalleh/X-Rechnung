-- =============================================================================
-- X-Rechnung — Core schema (invoices, customers, seller, payments, documents,
-- received e-invoices, audit, sequence ledger mirror).
--
-- Money is always stored as INTEGER cents. Quantities are stored as TEXT
-- decimal strings to avoid floating point. All writes go through prepared
-- statements in the repository layer.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Application-wide small key/value settings not covered by system_settings.
-- (system_settings lives in 0002; app_settings holds low-level runtime flags.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key          TEXT PRIMARY KEY,
  value_json   TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Seller (Freiberufler) profile. Versioned: editing creates a new active row.
-- Issued invoices keep a full JSON snapshot, so old invoices are unaffected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seller_profiles (
  id                       TEXT PRIMARY KEY,
  version                  INTEGER NOT NULL DEFAULT 1,
  is_active                INTEGER NOT NULL DEFAULT 1,
  full_name                TEXT NOT NULL,
  business_name            TEXT,
  job_title                TEXT NOT NULL DEFAULT 'Videograf, Videoeditor und Videoproduzent',
  street                   TEXT NOT NULL,
  postal_code              TEXT NOT NULL,
  city                     TEXT NOT NULL,
  country                  TEXT NOT NULL DEFAULT 'DE',
  email                    TEXT NOT NULL,
  phone                    TEXT,
  website                  TEXT,
  steuernummer             TEXT,
  ust_idnr                 TEXT,
  kleinunternehmer_id      TEXT,
  account_holder           TEXT NOT NULL,
  iban                     TEXT NOT NULL,
  bic                      TEXT,
  bank_name                TEXT,
  logo_r2_key              TEXT,
  signature_r2_key         TEXT,
  default_payment_days     INTEGER NOT NULL DEFAULT 14,
  footer_text              TEXT,
  default_rights_text      TEXT,
  tax_exemption_text       TEXT NOT NULL DEFAULT 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  invoice_number_prefix    TEXT NOT NULL DEFAULT 'RE',
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_seller_active ON seller_profiles(is_active);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                     TEXT PRIMARY KEY,
  customer_code          TEXT NOT NULL UNIQUE,
  customer_type          TEXT NOT NULL DEFAULT 'BUSINESS'
                           CHECK (customer_type IN ('BUSINESS','PRIVATE')),
  company_name           TEXT,
  first_name             TEXT,
  last_name              TEXT,
  contact_person         TEXT,
  street                 TEXT,
  postal_code            TEXT,
  city                   TEXT,
  country                TEXT NOT NULL DEFAULT 'DE',
  email                  TEXT,
  phone                  TEXT,
  ust_idnr               TEXT,
  steuernummer           TEXT,
  leitweg_id             TEXT,
  buyer_reference        TEXT,
  order_reference        TEXT,
  payment_days           INTEGER,
  invoice_language       TEXT NOT NULL DEFAULT 'de',
  delivery_method        TEXT NOT NULL DEFAULT 'EMAIL'
                           CHECK (delivery_method IN ('EMAIL','MANUAL','POST')),
  internal_note          TEXT,
  is_active              INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_code    ON customers(customer_code);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_name);
CREATE INDEX IF NOT EXISTS idx_customers_email   ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_active  ON customers(is_active);

-- ---------------------------------------------------------------------------
-- Service templates (Leistungsvorlagen)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_templates (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  default_description  TEXT NOT NULL,
  unit                 TEXT NOT NULL DEFAULT 'Pauschale'
                         CHECK (unit IN ('Stunde','Tag','Pauschale','Stück','Kilometer','Projekt','Minute')),
  default_price_cents  INTEGER NOT NULL DEFAULT 0,
  category             TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_active ON service_templates(is_active);

-- ---------------------------------------------------------------------------
-- Projects (optional grouping)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT REFERENCES customers(id) ON DELETE SET NULL,
  project_number TEXT,
  name           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);

-- ---------------------------------------------------------------------------
-- Invoices (outgoing). Financial + party data is snapshotted at issue time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id                        TEXT PRIMARY KEY,
  status                    TEXT NOT NULL DEFAULT 'DRAFT'
                              CHECK (status IN ('DRAFT','READY_TO_ISSUE','ISSUING','ISSUED',
                                                'SENT','PARTIALLY_PAID','PAID','OVERDUE',
                                                'CANCELLATION_PENDING','CANCELLED')),
  document_type             TEXT NOT NULL DEFAULT 'RECHNUNG'
                              CHECK (document_type IN ('RECHNUNG','STORNORECHNUNG','GUTSCHRIFT')),
  invoice_number            TEXT UNIQUE,
  customer_id               TEXT REFERENCES customers(id) ON DELETE SET NULL,
  project_id                TEXT REFERENCES projects(id) ON DELETE SET NULL,
  project_number            TEXT,
  project_name              TEXT,
  seller_profile_id         TEXT REFERENCES seller_profiles(id) ON DELETE SET NULL,
  seller_snapshot_json      TEXT,
  customer_snapshot_json    TEXT,
  invoice_date              TEXT,
  service_date              TEXT,
  service_period_start      TEXT,
  service_period_end        TEXT,
  due_date                  TEXT,
  currency                  TEXT NOT NULL DEFAULT 'EUR',
  tax_scenario              TEXT NOT NULL DEFAULT 'KLEINUNTERNEHMER_DE'
                              CHECK (tax_scenario IN ('KLEINUNTERNEHMER_DE','REVERSE_CHARGE_EU_B2B',
                                                      'NON_EU_SERVICE','CUSTOM_TAX_SCENARIO')),
  subtotal_cents            INTEGER NOT NULL DEFAULT 0,
  discount_cents            INTEGER NOT NULL DEFAULT 0,
  total_cents               INTEGER NOT NULL DEFAULT 0,
  tax_exemption_text        TEXT,
  tax_text_snapshot         TEXT,
  payment_terms_snapshot    TEXT,
  template_version          TEXT,
  buyer_reference           TEXT,
  purchase_order_reference  TEXT,
  order_reference           TEXT,
  public_note               TEXT,
  internal_note             TEXT,
  canonical_json_hash       TEXT,
  idempotency_key           TEXT,
  reserved_number           TEXT,
  issued_at                 TEXT,
  sent_at                   TEXT,
  cancelled_at              TEXT,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_status    ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer  ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number    ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_date      ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_due       ON invoices(due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_idem ON invoices(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invoice line items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_items (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  description       TEXT NOT NULL,
  quantity_decimal  TEXT NOT NULL DEFAULT '1',
  unit              TEXT NOT NULL DEFAULT 'Pauschale',
  unit_price_cents  INTEGER NOT NULL DEFAULT 0,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  line_total_cents  INTEGER NOT NULL DEFAULT 0,
  rights_text       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);

-- ---------------------------------------------------------------------------
-- Relations between documents (Storno / Ersatz / Gutschrift links)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_relations (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  related_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  relation_type     TEXT NOT NULL
                      CHECK (relation_type IN ('CANCELS','CANCELLED_BY','REPLACES','REPLACED_BY','CREDIT_FOR')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_relations_invoice ON invoice_relations(invoice_id);

-- ---------------------------------------------------------------------------
-- Payments (kept separate; never mutate the issued PDF)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date   TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER'
                   CHECK (payment_method IN ('BANK_TRANSFER','CASH','PAYPAL','CARD','OTHER')),
  bank_reference TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date    ON payments(payment_date);

-- ---------------------------------------------------------------------------
-- Documents (R2 objects: PDF, XML, EML, JSON snapshots). Immutable archive.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY,
  entity_type       TEXT NOT NULL,   -- 'invoice' | 'received_invoice' | 'received_email' | 'export'
  entity_id         TEXT NOT NULL,
  document_role     TEXT NOT NULL,   -- 'pdf' | 'canonical_json' | 'source_xml' | 'raw_eml' | 'attachment' | ...
  r2_key            TEXT NOT NULL,
  original_filename TEXT,
  mime_type         TEXT,
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  sha256            TEXT,
  immutable         INTEGER NOT NULL DEFAULT 1,
  retention_until   TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_role   ON documents(document_role);
CREATE INDEX IF NOT EXISTS idx_documents_sha    ON documents(sha256);

-- ---------------------------------------------------------------------------
-- Outbound emails
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_emails (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  to_email       TEXT NOT NULL,
  cc_email       TEXT,
  bcc_email      TEXT,
  subject        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'QUEUED'
                   CHECK (status IN ('QUEUED','SENT','FAILED')),
  provider       TEXT,
  message_id     TEXT,
  error_text     TEXT,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  sent_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_outbound_invoice ON outbound_emails(invoice_id);

-- ---------------------------------------------------------------------------
-- Received emails (raw envelope metadata)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS received_emails (
  id             TEXT PRIMARY KEY,
  message_id     TEXT,
  from_email     TEXT,
  to_email       TEXT,
  subject        TEXT,
  received_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  raw_r2_key     TEXT,
  raw_sha256     TEXT,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'RECEIVED'
                   CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','ERROR')),
  error_text     TEXT
);
CREATE INDEX IF NOT EXISTS idx_received_emails_status ON received_emails(status);

-- ---------------------------------------------------------------------------
-- Received invoices (parsed from XML / ZUGFeRD / upload)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS received_invoices (
  id                      TEXT PRIMARY KEY,
  source                  TEXT NOT NULL DEFAULT 'UPLOAD'
                            CHECK (source IN ('EMAIL','UPLOAD')),
  received_email_id       TEXT REFERENCES received_emails(id) ON DELETE SET NULL,
  format                  TEXT,   -- XRECHNUNG_UBL | XRECHNUNG_CII | ZUGFERD | PDF_PLAIN | UNKNOWN
  profile_id              TEXT,
  customization_id        TEXT,
  document_type           TEXT,
  supplier_name           TEXT,
  supplier_address        TEXT,
  supplier_tax_id         TEXT,
  supplier_vat_id         TEXT,
  invoice_number          TEXT,
  invoice_date            TEXT,
  due_date                TEXT,
  service_date            TEXT,
  service_period          TEXT,
  currency                TEXT,
  net_amount_cents        INTEGER,
  tax_amount_cents        INTEGER,
  gross_amount_cents      INTEGER,
  payment_terms           TEXT,
  iban                    TEXT,
  bic                     TEXT,
  buyer_reference         TEXT,
  purchase_order_reference TEXT,
  contract_reference      TEXT,
  extracted_json          TEXT,     -- full structured extraction
  validation_status       TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (validation_status IN ('PENDING','BASIC_VALID','BASIC_INVALID',
                                                         'STRICT_VALID','STRICT_INVALID','BASIC_CHECK_ONLY',
                                                         'UNSUPPORTED_FORMAT','PROCESSING_ERROR')),
  duplicate_status        TEXT NOT NULL DEFAULT 'NOT_DUPLICATE'
                            CHECK (duplicate_status IN ('NOT_DUPLICATE','POSSIBLE_DUPLICATE','EXACT_DUPLICATE')),
  duplicate_of            TEXT REFERENCES received_invoices(id) ON DELETE SET NULL,
  duplicate_decision      TEXT,     -- user's accept/reject reason
  payment_status          TEXT NOT NULL DEFAULT 'UNPAID'
                            CHECK (payment_status IN ('UNPAID','PARTIALLY_PAID','PAID')),
  expense_category        TEXT,
  supplier_link_id        TEXT,
  file_sha256             TEXT,
  xml_pdf_mismatch        INTEGER NOT NULL DEFAULT 0,
  internal_note           TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_recv_inv_status    ON received_invoices(validation_status);
CREATE INDEX IF NOT EXISTS idx_recv_inv_supplier  ON received_invoices(supplier_name);
CREATE INDEX IF NOT EXISTS idx_recv_inv_number    ON received_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_recv_inv_sha       ON received_invoices(file_sha256);
CREATE INDEX IF NOT EXISTS idx_recv_inv_dup       ON received_invoices(duplicate_status);

CREATE TABLE IF NOT EXISTS received_invoice_items (
  id                  TEXT PRIMARY KEY,
  received_invoice_id TEXT NOT NULL REFERENCES received_invoices(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  description         TEXT,
  quantity_decimal    TEXT,
  unit                TEXT,
  unit_price_cents    INTEGER,
  line_total_cents    INTEGER,
  tax_category        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_recv_items_inv ON received_invoice_items(received_invoice_id);

CREATE TABLE IF NOT EXISTS received_invoice_files (
  id                  TEXT PRIMARY KEY,
  received_invoice_id TEXT NOT NULL REFERENCES received_invoices(id) ON DELETE CASCADE,
  file_role           TEXT NOT NULL,  -- source_xml | source_pdf | attachment
  r2_key              TEXT NOT NULL,
  original_filename   TEXT,
  mime_type           TEXT,
  size_bytes          INTEGER NOT NULL DEFAULT 0,
  sha256              TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_recv_files_inv ON received_invoice_files(received_invoice_id);

-- ---------------------------------------------------------------------------
-- Validation results (basic + strict/KoSIT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_results (
  id                  TEXT PRIMARY KEY,
  received_invoice_id TEXT NOT NULL REFERENCES received_invoices(id) ON DELETE CASCADE,
  level               TEXT NOT NULL CHECK (level IN ('BASIC','STRICT')),
  status              TEXT NOT NULL,
  validator_name      TEXT,
  validator_version   TEXT,
  ruleset_version     TEXT,
  report_json         TEXT,
  messages_json       TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_validation_inv ON validation_results(received_invoice_id);

-- ---------------------------------------------------------------------------
-- Sequence allocations mirror (source of truth is the Durable Object; this is
-- an auditable D1 copy of confirmed/void allocations).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequence_allocations (
  id              TEXT PRIMARY KEY,
  prefix          TEXT NOT NULL,
  year            INTEGER NOT NULL,
  sequence_number INTEGER NOT NULL,
  formatted       TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('RESERVED','CONFIRMED','VOID')),
  invoice_id      TEXT,
  idempotency_key TEXT,
  void_reason     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seq_unique ON sequence_allocations(prefix, year, sequence_number);
CREATE INDEX IF NOT EXISTS idx_seq_state ON sequence_allocations(state);

-- ---------------------------------------------------------------------------
-- Audit events (append-only). No UPDATE/DELETE in the repository layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id              TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  event_type      TEXT NOT NULL,
  actor_email     TEXT,
  request_id      TEXT,
  old_value_json  TEXT,
  new_value_json  TEXT,
  metadata_json   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_type   ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_time   ON audit_events(created_at);

-- ---------------------------------------------------------------------------
-- Job failures (queue / issue pipeline / cron)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_failures (
  id            TEXT PRIMARY KEY,
  job_type      TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  attempt       INTEGER NOT NULL DEFAULT 1,
  error_text    TEXT,
  payload_json  TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_jobfail_type     ON job_failures(job_type);
CREATE INDEX IF NOT EXISTS idx_jobfail_resolved ON job_failures(resolved);
