# E‑Rechnung: Erkennung, Extraktion & Validierung

## Unterstützte Formate

- **XRechnung UBL** (`Invoice`, CustomizationID enthält „xrechnung“)
- **XRechnung CII** (`CrossIndustryInvoice`, CustomizationID „xrechnung“)
- **ZUGFeRD / Factur‑X** (PDF mit eingebettetem XML)
- **EN 16931‑konformes XML** (UBL/CII ohne XRechnung‑Customization)
- **Einfaches PDF** ohne strukturiertes XML → als solches gekennzeichnet
- **Unbekannt** → abgelehnt

Die XRechnung/ZUGFeRD‑Version ist **nicht** in der Kernlogik hardcodiert:
`classifyXml` liest die `CustomizationID` dynamisch; pro Version kann ein eigener
Adapter/Config ergänzt werden.

## Erkennung (`src/services/einvoice/detect.ts`)

Dateiendung/MIME werden **nie** allein vertraut. Erkennung über Magic‑Bytes:

- PDF (`%PDF`) → Suche nach eingebettetem XML (`zugferd.ts`): jeder
  `stream…endstream`‑Block wird geprüft und ggf. via `DecompressionStream`
  (deflate/deflate‑raw/gzip) entpackt; Bekannte Namen: `factur-x.xml`,
  `zugferd-invoice.xml`, `ZUGFeRD-invoice.xml`.
- XML → Parsing mit gehärtetem Parser (kein DTD/XXE), Klassifikation nach
  Wurzelelement + CustomizationID.
- Fehlt strukturiertes XML im PDF: „این فایل PDF معمولی است …“ (normales PDF).

## Extraktion (`parse.ts`)

Aus UBL und CII werden u. a. extrahiert: `supplier_name/address/tax_id/vat_id`,
`invoice_number`, `invoice_date`, `due_date`, `currency`, `net/tax/gross`,
`iban/bic`, `buyer_reference`, `purchase_order_reference`, `line_items`,
`profile_id`, `customization_id`, `document_type`. Beträge → Integer‑Cent, Daten →
`YYYY-MM-DD` (CII‑Format 102 wird normalisiert).

Bei ZUGFeRD ist das **eingebettete XML die maßgebliche Datenquelle**. Weicht ein
sichtbarer PDF‑Wert vom XML ab, wird dies als Warnung im Validierungsergebnis
festgehalten (`xml_pdf_mismatch`).

## Validierung — zwei Stufen

### BASIC (im Worker)

`basicValidate` prüft: Wohlgeformtheit (bereits durch den Parser garantiert),
Vorhandensein von Rechnungsnummer/Verkäufer/Datum/Währung/Endbetrag,
Zeilensummen‑Abgleich, IBAN‑Struktur (mod‑97). Duplikaterkennung separat.

### STRICT (KoSIT‑Adapter)

Der offizielle KoSIT‑Validator ist ein Java‑Dienst **außerhalb** des Workers.
Deshalb ein transport‑agnostisches Interface `StrictValidator`:

- `KositHttpValidator` — POST des XML an die konfigurierte URL, API‑Key aus dem
  verschlüsselten Secret‑Store, Timeout + Retry.
- `UnconfiguredValidator` — Standard, solange nichts konfiguriert ist: Status
  **`BASIC_CHECK_ONLY`**. Es wird **nie** „fully valid“ behauptet.
- `MockKositValidator` — nur für Tests/Entwicklung, klar als „nicht offiziell“
  gekennzeichnet.

### Validierungs‑Status

`PENDING`, `BASIC_VALID`, `BASIC_INVALID`, `STRICT_VALID`, `STRICT_INVALID`,
`BASIC_CHECK_ONLY`, `UNSUPPORTED_FORMAT`, `PROCESSING_ERROR`.

Version des Validators und des Rulesets werden in `validation_results`
gespeichert.

## Duplikaterkennung (`duplicate.ts`)

Kombiniert `file_sha256`, `supplier_tax_id/vat_id`, `supplier_name`,
`invoice_number`, `gross_amount`, `currency`. Stufen: `EXACT_DUPLICATE`,
`POSSIBLE_DUPLICATE`, `NOT_DUPLICATE`. Duplikate werden **nie automatisch
gelöscht**; der Nutzer kann eine Begründung für Annahme/Ablehnung hinterlegen.

## KoSIT im Panel aktivieren

Einstellungen → E‑Rechnung: `KoSIT Validator URL`, `KoSIT API Key`
(verschlüsselt, nur letzte vier Zeichen sichtbar), Timeout, Retries. Ohne URL
bleibt STRICT deaktiviert (`BASIC_CHECK_ONLY`).

## Integrationstests (workerd)

Für Tests gegen echte D1/R2/DO/Queue kann `@cloudflare/vitest-pool-workers`
verwendet werden (wrangler‑gestützte Config). Die reinen Logiktests
(`tests/*.test.ts`) laufen in Node und decken Geldmathematik, Hashing,
XML/XXE, UBL/CII‑Extraktion, §19‑Regeln und ZIP‑Integrität ab.
