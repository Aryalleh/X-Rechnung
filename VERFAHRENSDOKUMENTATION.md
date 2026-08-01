# Verfahrensdokumentation (X-Rechnung)

> Hinweis: Diese Dokumentation beschreibt die technischen Abläufe des Systems.
> Sie ersetzt **keine** individuelle Verfahrensdokumentation Ihres Betriebs und
> **keine Steuerberatung**. Das System behauptet **keine** GoBD‑Zertifizierung.

## 1. Wie das System arbeitet

X-Rechnung läuft vollständig auf Cloudflare Workers. Strukturierte Daten liegen
in D1 (EU), Dokumente (PDF/XML/EML/JSON) in R2 (EU). Der Zugang ist durch
Cloudflare Access geschützt; nur hinterlegte Admin‑E‑Mails erhalten Zutritt.

## 2. Kunde anlegen

Einstellungen → Kunden. Jeder Kunde erhält einen eindeutigen `customer_code`
(z. B. `KD-0001`, manuell oder automatisch). Doppelte Codes werden abgelehnt.

## 3. Rechnung erstellen und ausgeben

„Neue Rechnung“ → Kundencode eingeben (Enter) → Kunden‑ und Seller‑Daten werden
automatisch geladen → Leistungen wählen → Beträge/Datum → Vorschau → „Ausgabe“.
Beim finalen Ausgeben:
Validierung → Backend‑Neuberechnung der Beträge → Snapshots (Seller/Kunde) →
Canonical JSON → SHA‑256 → Nummernreservierung → HTML → PDF → Ablage in R2 →
Nummer bestätigt → Status `ISSUED`. Kleinunternehmer §19: keine USt.

## 4. Rechnungsnummern

Format `RE-YYYY-NNNNNN` (bzw. `ST`/`GS`). Pro Jahr ab 1, eindeutig, nie
wiederverwendet. Vergabe erst bei finaler Ausgabe über einen Durable Object mit
RESERVED/CONFIRMED/VOID‑Ledger und Idempotency‑Key. Schlägt die Ausgabe nach
Reservierung fehl, wird die Nummer **VOID** und der Grund im Audit‑Log
festgehalten.

## 5. Wann Dokumente gesperrt werden

Mit `ISSUED` sind Finanz‑, Kunden‑, Seller‑ und Positionsdaten unveränderlich.
Zahlungen, Mahnungen und interne Notizen liegen in separaten Tabellen und ändern
das ausgegebene PDF nicht.

## 6. Rechnungskorrektur

Ausgegebene Rechnungen werden nie hart gelöscht oder direkt editiert. Korrektur =
**Stornorechnung** (`ST-YYYY-NNNNNN`, negative Beträge, Verweis auf das Original)
und optional eine neue **Ersatzrechnung** mit eigener Nummer, verknüpft mit
Original und Storno.

## 7. Zahlungen erfassen

Rechnungsdetail → Zahlung (Datum, Betrag in Cent, Methode). Restbetrag und Status
(`PARTIALLY_PAID`/`PAID`) werden automatisch berechnet. Überzahlung nur mit
expliziter Bestätigung. Zahlungsdatum dient informativ dem EÜR‑Zufluss.

## 8. E‑Rechnung empfangen

Zwei Wege: (a) manueller Upload (`.xml`/`.pdf`), (b) eingehende E‑Mail an die
konfigurierte Adresse. Der Email‑Worker speichert die Roh‑E‑Mail als `.eml`,
extrahiert Header/Anhänge, hasht und archiviert jede Datei und stößt die
Verarbeitung an.

## 9. Wo Originaldateien liegen

R2 unter partitionierten, unveränderlichen Präfixen:
`archive/outgoing/YYYY/MM/`, `archive/incoming/YYYY/MM/`, `archive/email/YYYY/MM/`.
Originale werden nie überschrieben; Korrekturen erzeugen neue Objekte mit neuem
Key. Bei ZUGFeRD gilt das eingebettete XML als maßgebliche Datenquelle.

## 10. Wie Hashes erzeugt werden

Für jede archivierte Datei wird ein **SHA‑256** (Web Crypto) berechnet und in
`documents.sha256` sowie in den R2‑Metadaten gespeichert. Der Rechnungsinhalt
erhält zusätzlich einen Content‑Hash über das Canonical JSON.

## 11. Wer Zugriff hat

Nur über Cloudflare Access authentifizierte Admin‑E‑Mails. Rollenmodell:
`OWNER`, `ADMIN`, `ACCOUNTANT`, `READ_ONLY`. Mindestens ein aktiver Owner ist
stets vorhanden.

## 12. Backup

Datenlogik liegt in D1 und R2 (von Cloudflare repliziert). Zusätzlich: jährlicher
ZIP‑Export (CSV + Dokumente + Manifest mit SHA‑256) und Vollexport als JSON
(siehe DATA_EXPORT.md). Empfehlung: regelmäßiger Export an einen externen,
sicheren Speicherort.

## 13. Software‑Updates dokumentieren

Deployments erfolgen über `wrangler deploy` (versionierte Migrationen in
`migrations/`). Konfigurationsänderungen erzeugen `configuration_versions`
(Hashes statt sensibler Klartexte) und Konfigurations‑Audit‑Events.

## 14. Export für Betriebsprüfung

CSV/JSON/ZIP‑Exporte über das Panel bzw. `/api/export/*`. Der ZIP‑Jahresexport
enthält ein `documents-manifest.csv` mit `filename, document_type, sha256, size,
created_at, retention_until` zur Integritätsprüfung.

## 15. Fehler protokollieren und verfolgen

Fehler der Ausgabe‑Pipeline, des Queue‑Consumers und des Cron landen in
`job_failures`; der tägliche Cron versucht offene Issue‑Jobs erneut und meldet
fehlende Hashes/ungültige Validierungen. Alle relevanten Ereignisse stehen im
unveränderlichen `audit_events`‑Log.
