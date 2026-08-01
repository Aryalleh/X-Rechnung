# Architektur

## Überblick

Ein einziger Cloudflare Worker stellt vier Entry‑Points bereit:

| Entry | Zweck |
|---|---|
| `fetch` | Hono‑API (`/api/*`) + Auslieferung der React‑SPA (`ASSETS`) |
| `email` | Email‑Worker für eingehende E‑Rechnung |
| `queue` | Hintergrundverarbeitung (Retry Issue, Re‑Validation) |
| `scheduled` | Täglicher Cron (Overdue, Retries, Integritätsprüfungen) |

Zusätzlich exportiert der Worker die Durable‑Object‑Klasse `InvoiceSequence`.

## Schichten (Separation of Concerns)

```
routes/        Hono-Router: HTTP, Zod-Validierung, standardisierte Antworten
services/      Geschäftslogik (issue, payment, cancellation, einvoice, pdf, email)
  einvoice/    detect → parse → validate (basic + KoSIT-Adapter) → duplicate → ingest
  pdf/         template (HTML) + renderer (Browser Run)
  email/       sender (Adapter) + invoice-email
db/repositories/  Prepared-Statement-Repositories (kein String-Interpolieren)
lib/           money, crypto, format, xml, zip, errors, ids, schemas
middleware/    access (JWT), security (Header/CSRF), setup-gate, rate-limit
durable-objects/  InvoiceSequence (Nummern-Ledger)
config/        Env-Typen, Konstanten (Enums, Default-Texte, Labels)
```

Adapter‑Muster für auswechselbare Abhängigkeiten:
`EmailProvider` (Cloudflare/extern), `StrictValidator` (KoSIT/Unconfigured/Mock),
PDF‑Generator (Browser Run / injizierbar für Tests).

## Bindings

| Binding | Ressource |
|---|---|
| `DB` | D1 (EU) — strukturierte Daten |
| `ARCHIVE_BUCKET` | R2 (EU) — PDF, XML, EML, JSON |
| `INVOICE_SEQUENCE` | Durable Object — Nummerierung |
| `DOCUMENT_QUEUE` | Queue — Hintergrundjobs |
| `BROWSER` | Browser Run — HTML → PDF |
| `EMAIL` | `send_email` — Ausgang |
| `ASSETS` | Static Assets — SPA |

## Datenmodell (Auszug)

`seller_profiles` (versioniert), `customers`, `service_templates`, `invoices`,
`invoice_items`, `invoice_relations`, `payments`, `documents`, `outbound_emails`,
`received_emails`, `received_invoices` (+ items/files), `validation_results`,
`sequence_allocations`, `audit_events`, `job_failures`.

Panel/Setup: `setup_state`, `system_settings`, `admin_users`, `admin_sessions`,
`cloudflare_integrations`, `cloudflare_sync_jobs`, `managed_domains`,
`email_channels`, `configuration_versions`, `configuration_audit_events`,
`secret_store`.

## Ausgabe‑Pipeline (idempotent)

```
Draft → validieren → Beträge im Backend neu berechnen → Snapshots (Seller/Kunde)
→ Canonical JSON → SHA-256 → Nummer im DO RESERVIEREN → Status ISSUING
→ HTML → PDF (Browser Run) → JSON+PDF in R2 (immutable, SHA-256)
→ D1-Transaktion (Nummer + ISSUED) → Nummer CONFIRM → Audit
```

Bei Fehler: reservierte Nummer wird **VOID** (nie wiederverwendet), Grund ins
Audit/Job‑Failure‑Log, Vorgang **retry‑bar**. Kein unvollständiges Dokument wird
je als gültig angezeigt.

## Nummerierung (Durable Object)

Ein DO‑Instance pro `(prefix, year)` (`idFromName("RE:2026")`) serialisiert alle
Zugriffe. `blockConcurrencyWhile` + Idempotency‑Key verhindern doppelte Nummern
bei Doppelklick/Race. Ledger: `RESERVED`/`CONFIRMED`/`VOID`; der Zähler bewegt
sich nur vorwärts. Präfixe: `RE`/`ST`/`GS`.

## Frontend

React + Vite, RTL/Persisch, gebaut nach `dist/client`, ausgeliefert über `ASSETS`
(SPA‑Fallback). Kein Finanz‑Rechnen im Frontend — Zeilensummen sind reine
Vorschau; maßgeblich ist stets die Backend‑Berechnung.
