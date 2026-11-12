-- Customer signs first, the provider countersigns afterwards.
-- New status CUSTOMER_SIGNED = customer has signed, waiting for the provider's countersignature.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt (no other table references it).
PRAGMA defer_foreign_keys = true;

CREATE TABLE contracts_new (
  id                     TEXT PRIMARY KEY,
  contract_number        TEXT NOT NULL UNIQUE,
  title                  TEXT NOT NULL,
  language               TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de', 'en', 'fa')),
  template_id            TEXT,
  customer_id            TEXT REFERENCES customers(id),
  customer_snapshot_json TEXT,
  seller_snapshot_json   TEXT,
  body                   TEXT NOT NULL,          -- template text incl. {{variables}} (draft)
  variables_json         TEXT NOT NULL DEFAULT '{}',
  resolved_body          TEXT,                   -- frozen at send: variables substituted, [[fields]] kept
  content_hash           TEXT,                   -- SHA-256 of the frozen content + parties
  status                 TEXT NOT NULL DEFAULT 'DRAFT'
                           CHECK (status IN ('DRAFT', 'SENT', 'VIEWED', 'CUSTOMER_SIGNED', 'SIGNED', 'CANCELLED')),
  sign_token_hash        TEXT,
  sign_token_expires_at  TEXT,
  seller_signer_name     TEXT,
  seller_signature       TEXT,                   -- PNG data URL
  seller_signed_at       TEXT,
  field_values_json      TEXT,                   -- customer's [[field]] values
  signer_name            TEXT,
  signer_email           TEXT,
  signature              TEXT,                   -- customer's PNG data URL
  signed_at              TEXT,
  signer_ip              TEXT,
  signer_user_agent      TEXT,
  viewed_at              TEXT,
  viewer_ip              TEXT,
  sent_at                TEXT,
  sent_to_email          TEXT,
  signed_pdf_document_id TEXT,
  created_by             TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO contracts_new SELECT * FROM contracts;
DROP TABLE contracts;
ALTER TABLE contracts_new RENAME TO contracts;

CREATE INDEX IF NOT EXISTS idx_contracts_status   ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_token ON contracts(sign_token_hash) WHERE sign_token_hash IS NOT NULL;
