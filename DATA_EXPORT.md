# Data Export & Backup

Alle Exporte liegen hinter Cloudflare Access und werden im Audit‑Log als
`EXPORT_CREATED` erfasst.

## CSV‑Exporte

| Endpoint | Inhalt |
|---|---|
| `GET /api/export/outgoing.csv` | Ausgangsrechnungen |
| `GET /api/export/incoming.csv` | Eingegangene E‑Rechnungen |
| `GET /api/export/payments.csv` | Zahlungen |
| `GET /api/customers/export/csv` | Kunden |

## Voller Jahres‑ZIP‑Export

`GET /api/export/year/{year}.zip` erzeugt ein Bundle (Store‑ZIP, `src/lib/zip.ts`,
korrekte CRC‑32) mit:

```
outgoing-invoices.csv
incoming-invoices.csv
payments.csv
customers.csv
audit-events.csv
documents-manifest.csv     # filename, document_type, sha256, size, created_at, retention_until
documents/outgoing/*.pdf
documents/incoming/*.xml|*.pdf
documents/email/*.eml
README.txt
```

Das Manifest ermöglicht die **Integritätsprüfung** jeder Datei über ihren
SHA‑256‑Wert.

## Aufbewahrung / Retention

- Ausgehende/eingehende Rechnungen, XML, PDF, EML, Validierungsberichte und
  JSON‑Snapshots werden grundsätzlich **8 Jahre** aufbewahrt.
- `documents.retention_until` und die R2‑Metadaten halten Start/Ende fest.
- Der `archive/`‑Präfix sollte per **R2 Object‑Lock (8 Jahre)** gegen Löschen/
  Überschreiben gesichert werden. Der System‑Status zeigt „Archive Lock: WARNING“,
  solange dies nicht extern verifiziert ist — die App behauptet keine
  automatische Unveränderlichkeit.
- Änderungen der Retention nur in den Admin‑Einstellungen und mit Audit‑Event.

## Täglicher Cron

`scheduled` (03:00 UTC) prüft überfällige Rechnungen, wiederholt fehlgeschlagene
Issue‑Jobs, meldet Dokumente ohne Hash und ungültige Validierungen und schreibt
ein `CRON_MAINTENANCE`‑Audit‑Event.

## Backup‑Empfehlung

Regelmäßig den Jahres‑ZIP (oder Vollexport) an einen externen, sicheren Ort
kopieren. D1/R2 werden von Cloudflare repliziert, ersetzen aber kein externes
Offsite‑Backup.
