# X-Rechnung — Full Application Description

> A complete, current description of what the application is, who it serves, every
> feature, how it works, and its architecture, security and limitations. Written
> from the live codebase (not aspirational). For a visual/UI spec see
> [`../DESIGN_HANDOFF.md`](../DESIGN_HANDOFF.md); for architecture internals see
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

---

## 1. What it is

X-Rechnung is a complete, single-tenant **invoicing and e-invoice-archiving system
that runs entirely on Cloudflare Workers**. One freelancer or micro-business owns an
instance; there is no public sign-up. It creates, issues, sends, receives, validates
and immutably archives invoices, and it generates legally-styled invoice PDFs in
**German, English or Persian**. The admin panel is **Persian, right-to-left** by
default, and fully localized in all three languages with light/dark themes.

It is built to be **honest about compliance**: it is designed for traceable document
retention but explicitly does **not** claim GoBD certification and is **not** a
substitute for tax advice.

## 2. Who it serves (three tax regimes in one product)

The same app adapts its tax behavior to the seller and the invoice currency:

1. **German freelancer / Kleinunternehmer (§ 19 UStG).** No VAT is ever charged or
   shown (no "19 % / 7 % / 0 % MwSt."): only a single amount plus the mandatory
   "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet." note. EUR.
2. **Iranian micro-business / freelancer (کسب‌وکار خرد).** Rial/Toman invoices with
   **no VAT**; the invoice states VAT is not included.
3. **Iranian VAT-registered business.** Rial/Toman invoices **with VAT** at the
   seller's configured rate (default 10 % — the general rate, configurable because
   it is set yearly by the budget law). Invoices are **type 1** (buyer identified by
   national ID / economic code, so the buyer gets a VAT credit — سامانه مؤدیان) or
   **type 2** (consumer; buyer identity not required).

A general/custom VAT scenario and placeholders for EU reverse-charge / non-EU exist
in the data model for future use. The system never makes a tax decision with AI, and
warns that cross-border/EU/B2G cases may need a Steuerberater.

## 3. Localization, currencies and the "remove-zeros" plan

- **Languages:** Persian (fa), German (de), English (en). Full UI i18n (~1200 keys/lang)
  with a runtime language switch; **RTL** for Persian, Persian digits (۱۲۳٬۴۵۶).
- **Install mode** (chosen at setup): `fa` (Iran only), `de` (Germany only), or `both`
  (all three languages/currencies). It sets defaults and filters the pickers.
- **Currencies:** EUR (cents), IRR (ریال), IRT (تومان), and **IRT_NEW** — the future
  redenominated unit with sub-unit **قران**. Amounts are always stored as **integer
  minor units of the invoice's currency** (never floats).
- **Redenomination ("حذف صفر"):** 1 new unit = 10 000 old Rial, قران as sub-unit. The
  feature is **off by default, undated and configurable** (قران-per-unit, effective
  date) and is **never auto-applied** to existing invoices — issued invoices keep their
  stored currency. A conversion helper exists for reporting.

## 4. Feature set

### 4.1 First-run setup
No setup secret. On first deploy the app is in `SETUP_REQUIRED` and only `/setup` works.
The **first person to submit the owner form becomes OWNER**; at that moment a random
**setup-claim** is issued to that browser (HttpOnly cookie; only its SHA-256 hash is
stored) so the remaining wizard steps can't be hijacked and no second owner can be
created mid-setup. The wizard (stepped, RTL) collects: owner name/email/recovery, the
**install mode**, and (optionally) Cloudflare connection details to auto-create the
**Access application + owner-only policy + custom domain**. Completing setup clears the
claim and permanently closes `/setup`. Roles modeled: OWNER / ADMIN / ACCOUNTANT /
READ_ONLY; owner transfer is a safe create→verify→activate→demote flow.

### 4.2 Seller profile (issuer)
Versioned: editing creates a new active version; issued invoices keep a full JSON
**snapshot**, so old invoices never change. Holds identity, address, tax IDs
(Steuernummer / USt-IdNr / Kleinunternehmer-ID, and Iranian national ID / economic code
+ VAT status/rate), bank details, logo/signature, default payment terms, invoice texts,
and the §19 text (mandatory in Kleinunternehmer mode).

### 4.3 Customers
Unique `customer_code` (auto `KD-0001…` or manual; duplicates rejected). Sectioned
create/edit form (Identity / Address / Contact / Iran IDs / Tax & references) in a modal,
reused by the invoice flow. Business/private, EU + Iranian tax fields, Leitweg-ID, buyer
reference, per-customer payment terms, language, notes. Fast search (code/name/company/
email, accent-insensitive), CSV import/export, linked invoices with paid/open totals.

### 4.4 Service templates (Leistungsvorlagen)
Reusable line presets (name, German description, unit, default price, category) — the
videography set (Konzeption, Videodreh, Schnitt, Color Grading, Nutzungsrechte, …) is
seeded. Units: Stunde/Tag/Pauschale/Stück/Kilometer/Projekt/Minute.

### 4.5 Creating an invoice (the core flow)
Quick path: **enter customer code → Enter → customer + seller auto-load → pick/add line
items → issue**. Per invoice: currency, output language, project, dates/period, references.
Line items support manual entry with currency-aware money parsing and per-line discount
and rights text. Document-level extras: **discount** (percent or fixed), **VAT rate**
(auto per regime, incl. Iranian rules), **advance payment** (Anzahlung), and an
**installment schedule** (due date + amount rows). A live summary shows
subtotal → discount → net → VAT → **total** → advance → **amount due**. All money math is
**backend-authoritative** (BigInt, integer minor units, half-away-from-zero rounding);
frontend numbers are preview only.

### 4.6 Numbering & the idempotent issue pipeline
Numbers are `RE-YYYY-NNNNNN` (and `ST-`/`GS-` for Storno/Gutschrift), per-year from 1,
unique, never reused. They are assigned only at final issue, via a **Durable Object**
with a RESERVED/CONFIRMED/VOID ledger + idempotency keys (safe against double-click/races).
Issue pipeline: validate → recompute totals → seller+customer **snapshots** → canonical
JSON → **SHA-256** content hash → reserve number → status ISSUING → render HTML → **PDF via
Browser Rendering** → store canonical JSON + PDF **immutably in R2** with SHA-256 → assign
number + ISSUED (D1 transaction) → confirm number → audit. On any failure the reserved
number is **VOIDed (never reused)**, the reason is logged, and the operation is retryable;
an incomplete document is never shown as valid.

### 4.7 Invoice PDF (the customer-facing document)
One layout, three languages (Persian mirrored), matching a provided reference: accent bar,
bold business heading, small-caps meta, striped line-item table, financial summary
(subtotal/discount/net/VAT/total/advance/amount due), tax/§19 note, **installment schedule**,
and a contact/bank footer. Persian uses **embedded Vazirmatn** (base64, so it always
renders), Persian digits, and the footer on the **left**; the owner can upload a custom
font. Accent color and brand heading are configurable. PDFs are text-based/searchable
(not claimed as PDF/A). Draft previews are watermarked.

### 4.8 Corrections, payments, sending
Issued invoices are never edited or hard-deleted. Corrections use a **Stornorechnung**
(negative amounts, references the original) and an optional fresh **Ersatzrechnung**, all
linked. **Payments** are recorded separately (date/amount/method), compute paid/remaining
and auto-set PARTIALLY_PAID/PAID; an advance payment is seeded as a real payment at issue;
installments can be toggled paid. **Email**: localized template with the PDF attached, via
the Cloudflare send binding (swappable provider), with message-id/retry/error tracking.
Statuses: DRAFT → READY_TO_ISSUE → ISSUING → ISSUED → SENT → PARTIALLY_PAID → PAID →
OVERDUE / CANCELLATION_PENDING → CANCELLED.

### 4.9 Receiving e-invoices (E-Rechnung Eingang)
Two intakes: **manual upload** (.xml/.pdf, signature-checked — declared MIME is never
trusted) and an **inbound Email Worker** that archives the raw `.eml`, extracts/hashes
attachments and ingests them. Detection covers **XRechnung (UBL + CII)**, **ZUGFeRD /
Factur-X** (embedded XML extracted from the PDF), EN 16931 XML, and plain PDF. XML is
parsed with a **hardened parser that rejects DTDs/entities (no XXE)**. Structured fields
are extracted (supplier, amounts, IBAN, references, line items). Validation has two levels:
**basic** in-Worker checks, and **strict** via a pluggable **KoSIT adapter** (HTTP, with an
unconfigured/mock fallback that never claims "fully valid" — status stays `BASIC_CHECK_ONLY`).
**Duplicate detection** (file hash / supplier+number+amount) flags EXACT/POSSIBLE and never
auto-deletes. The inbox lists everything with validation + duplicate badges; the original
file, raw email and hashes are downloadable (private, behind auth).

### 4.10 Archive, export, retention, audit
Everything is archived immutably in R2 under year/month prefixes
(`archive/outgoing|incoming|email/YYYY/MM/`) with SHA-256 recorded in D1 and R2 metadata;
corrections create new objects (never overwrite). Retention defaults to **8 years**
(R2 object-lock recommended on the `archive/` prefix). Exports: CSV (outgoing, incoming,
payments, customers), and a **yearly ZIP** bundle (CSVs + documents + a `documents-manifest.csv`
with filename/type/sha256/size/date/retention). A daily **cron** marks overdue invoices,
retries failed issue jobs, flags documents missing a hash, and reports failed validations.
An **append-only audit log** records every significant event; secrets are redacted.

### 4.11 Dashboard & system status
Dashboard: KPI cards (open, overdue, paid revenue per currency, unpaid received, invalid
e-invoices, failed jobs), a recent-invoices table, and an "informational only, not a tax
return" disclaimer. A **System Status** page shows health chips (OK/WARNING/ERROR/
NOT_CONFIGURED/TESTING) for D1, R2, Durable Object, Queue, Browser Rendering, Access,
domain, inbound/outbound email, KoSIT validator, secret store and seller profile.

## 5. Architecture & technology

- **Runtime:** one Cloudflare Worker with four entry points — `fetch` (Hono API + SPA via
  the `ASSETS` binding), `email` (inbound e-invoice), `queue` (background jobs), `scheduled`
  (daily cron) — plus the `InvoiceSequence` Durable Object.
- **Backend:** TypeScript (strict), **Hono** router, layered: routes → services →
  prepared-statement repositories; **Zod** validation; typed errors with localized messages.
- **Frontend:** **React + Vite** SPA, RTL-first, **token-driven design system** (semantic
  CSS-variable tokens, light/dark), a component library (`ui.tsx`: icons, toasts, modals,
  money inputs, status badges, empty/loading states), a command palette, and full fa/de/en
  i18n (`i18n.tsx`).
- **Storage/compute bindings:** **D1** (structured data, EU), **R2** (PDF/XML/EML/JSON, EU),
  **Durable Object** (numbering), **Queues** (background), **Browser Rendering** (HTML→PDF),
  **send_email** (outbound), **Cloudflare Access** (login/SSO).
- **Money:** integer minor units + BigInt everywhere; no floats.

### Data model (D1, 5 migrations)
Core: `app_settings, seller_profiles, customers, service_templates, projects, invoices,
invoice_items, invoice_relations, invoice_installments, payments, documents, outbound_emails,
received_emails, received_invoices (+ items/files), validation_results, sequence_allocations,
audit_events, job_failures`. Settings/admin: `setup_state, system_settings, admin_users,
admin_sessions, cloudflare_integrations, cloudflare_sync_jobs, managed_domains, email_channels,
configuration_versions, configuration_audit_events, secret_store`. Later migrations add
currency/language, discount/tax/installments, and Iranian tax fields.

## 6. Security & compliance posture

- **Auth:** whole panel/API/files behind **Cloudflare Access**; the Worker **verifies the
  Access JWT** against the team JWKS (signature, aud, iss, exp) — it never trusts the header
  alone — and matches an active admin.
- **Web hardening:** CSP, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options,
  HSTS in prod; **CSRF** (origin + `X-Requested-With`); SameSite cookies; rate limits on
  setup/issue/upload.
- **Data:** **prepared statements only** (no SQL injection); **XXE-safe XML**; file uploads
  size- and signature-checked; path-traversal-safe R2 keys; private bucket with
  authenticated, no-store downloads.
- **Secrets:** nothing business/tenant is hardcoded — owner email, domains, tax numbers,
  texts, validator URL/key, Cloudflare IDs all live in D1; sensitive values are **AES-GCM
  encrypted** (`secret_store`) and never logged (only last-4 shown); only scoped Cloudflare
  API tokens are accepted, used transiently.
- **Immutability & audit:** issued invoices locked; snapshots + content hashes; append-only,
  redacted audit log; versioned configuration history.
- **Honesty:** never claims GoBD certification or "fully valid" without the official KoSIT
  validator; states it is not tax advice.

## 7. Deployment & operations

Runs on Cloudflare Workers (deployable via `npm run deploy` or Cloudflare Workers Builds).
Create D1 (EU) + R2 (EU) + Queues; enable Browser Rendering + Email Routing; set the one
optional secret `DATA_ENCRYPTION_KEY` (enables encrypted secret storage; without it the app
still runs with that feature disabled). `npm run deploy` builds the SPA, **applies D1
migrations**, and deploys. The daily cron handles maintenance. Full runbook in `README.md`
(German) and `README.fa.md` (Persian).

## 8. Current status & limitations

- **Implemented & tested** (unit tests): money/discount/VAT/advance math, numbering &
  idempotency, Kleinunternehmer and Iranian VAT rules, hashing, XXE-safe XML, UBL/CII/ZUGFeRD
  extraction, duplicate detection, ZIP integrity, currency/Persian-digit formatting.
- **Depends on Cloudflare account features** at deploy time: Browser Rendering, R2, Queues,
  Email Routing/verified sender, Access — these are provisioned per the README, not in code.
- **KoSIT strict validation** requires an external Java validator endpoint; until configured,
  only basic validation runs and the app never reports "fully valid".
- **ZUGFeRD extraction** is a pragmatic heuristic over PDF streams (handles typical files).
- **Not** a certified GoBD archive and **not** tax advice; cross-border/EU cases are flagged
  for professional review.

## 9. Repository map & related docs

```
src/worker.ts            entry (fetch/email/queue/scheduled) + Durable Object export
src/routes/*             Hono routers (setup, settings, customers, invoices, payments,
                         received, documents, templates, export, system)
src/services/*           business logic (invoice, issue, payment, cancellation, iran-tax,
                         einvoice/*, pdf/*, email/*, archive, audit, secret, settings, setup,
                         sequence, cloudflare-api)
src/db/repositories/*    prepared-statement repositories
src/lib/*                money, crypto, format, xml, zip, schemas, errors, ids
src/frontend/*           React SPA: ui.tsx, i18n.tsx, currency.ts, pages/*, components/*
migrations/*             0001 core · 0002 settings/admin · 0003 currency+language ·
                         0004 discount/tax/installments · 0005 Iranian tax · seed.sql
docs/openapi.yaml        API overview
```
Related: `README.md` / `README.fa.md` (setup), `ARCHITECTURE.md`, `SECURITY.md`,
`VERFAHRENSDOKUMENTATION.md`, `DATA_EXPORT.md`, `EINVOICE_VALIDATION.md`,
`DESIGN_HANDOFF.md`.
