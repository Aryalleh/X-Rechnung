# X-Rechnung

Rechnungssystem für **Freiberufler / Kleinunternehmer (§ 19 UStG)** — vollständig
auf **Cloudflare Workers**. Admin-Panel auf **Persisch (RTL)**, Rechnungen auf
**Deutsch**. Erstellen, Versenden, Empfangen (E-Rechnung) und revisionssicheres
Archivieren von Rechnungen.

> Dieses Programm ist für die nachvollziehbare Aufbewahrung von Dokumenten
> gedacht, ist aber **kein Ersatz für Steuerberatung** und macht Sie nicht
> automatisch „GoBD‑zertifiziert“.

## Highlights

- **Kleinunternehmer §19**: keine USt., keine „19 % / 7 % / 0 % MwSt.“, nur
  `Rechnungsbetrag` + Pflichthinweis „Gemäß § 19 UStG …“.
- **Geld nur in Integer‑Cent** (kein Float), Mengen als Dezimal‑Strings (BigInt).
- **Gap‑freie Nummerierung** über einen Durable Object mit RESERVED/CONFIRMED/VOID‑Ledger.
- **Idempotenter Ausgabe‑Prozess**: Snapshot → Canonical JSON → SHA‑256 → PDF → R2 → ISSUED.
- **E‑Rechnung Eingang**: XRechnung (UBL/CII), ZUGFeRD/Factur‑X, Upload + Email‑Worker.
- **Alles konfigurierbar im Panel** — nichts Geschäftliches ist hardcodiert
  (Owner‑Email, Domains, Steuernummern, Texte, Validator‑URL …).
- **Kein Bootstrap‑Secret hardcodiert**: der Setup‑Token wird beim ersten Start
  generiert und einmalig ins Log geschrieben.

## Architektur

Siehe [ARCHITECTURE.md](./ARCHITECTURE.md). Kurzform:

- **Hono** API + **React/Vite** SPA (über `ASSETS`).
- **D1** (strukturierte Daten, EU‑Jurisdiktion), **R2** (PDF/XML/EML/JSON, EU),
  **Durable Object** (Nummerierung), **Queues** (Hintergrund), **Browser Run** (PDF),
  **Email Routing/Worker** (Eingang) + `send_email` (Ausgang), **Cloudflare Access** (Login).

## Setup (Schritt für Schritt)

1. **Dependencies installieren**
   ```bash
   npm install
   ```
2. **Bei Cloudflare anmelden**
   ```bash
   npx wrangler login
   ```
3. **D1 in EU‑Jurisdiktion anlegen**
   ```bash
   npx wrangler d1 create x-rechnung --location=weur
   # database_id in wrangler.jsonc eintragen
   ```
4. **R2 in EU‑Jurisdiktion anlegen**
   ```bash
   npx wrangler r2 bucket create x-rechnung-archive --jurisdiction eu
   ```
5. **8‑Jahres‑Bucket‑Lock auf dem `archive/`‑Präfix** setzen (Object‑Lock /
   Retention). Prüfen Sie dies eigenständig — die App **behauptet keine**
   automatische Unveränderlichkeit, siehe „Archiv Lock: WARNING“ im System‑Status.
6. **Queue anlegen**
   ```bash
   npx wrangler queues create x-rechnung-documents
   npx wrangler queues create x-rechnung-documents-dlq
   ```
7. **Durable Object**: wird über `wrangler.jsonc` (`migrations` → `InvoiceSequence`) beim Deploy erstellt.
8. **Email Routing aktivieren** (Zone → Email → Email Routing) — oder später im Panel.
9. **Eingangs‑Adresse für E‑Rechnung** definieren (Panel → Einstellungen → E‑Rechnung Eingang).
10. **Cloudflare Access** einrichten — im Setup‑Wizard automatisch oder manuell.
11. **Browser Run** (Browser Rendering) für den Account aktivieren.
12. **Secrets setzen** (nur diese, nichts Geschäftliches):
    ```bash
    npx wrangler secret put DATA_ENCRYPTION_KEY   # openssl rand -base64 32 (optional)
    ```
13. **Migrationen ausführen**
    ```bash
    npm run migrate:remote        # bzw. migrate:local
    npm run seed:local            # optionale Beispieldaten (Templates + KD-0001)
    ```
14. **Local Development**
    ```bash
    npm run dev
    ```
15. **Tests**
    ```bash
    npm test
    ```
16. **Deploy**
    ```bash
    npm run deploy
    ```
17. **Ersten Seller‑Profile anlegen**: App öffnen → `/setup` → Owner + Cloudflare →
    danach Einstellungen → „مشخصات فریلنسر“.
18. **Email‑Empfang testen**: eine XRechnung an die konfigurierte Adresse senden.
19. **PDF‑Ausgabe testen**: Kunde `KD-0001`, Rechnung erstellen, „صدور نهایی“.

### Erstinbetriebnahme ohne Owner

Beim allerersten Aufruf ist der Zustand `SETUP_REQUIRED`. Der einmalige
Setup‑Token steht **nur im Log**:

```bash
npx wrangler tail
# => "X-RECHNUNG FIRST-RUN SETUP TOKEN (shown once): ...."
```

App auf der `workers.dev`‑Adresse öffnen → `/setup` → Token eingeben →
Owner‑Email, Cloudflare‑Account/Zone, Scoped API‑Token (nur transient) und Domain
angeben. Danach ist `/setup` geschlossen.

## Deployment‑Werte vs. Panel‑Werte

| Nur beim Deploy | Im Panel (D1) |
|---|---|
| `ENVIRONMENT`, optional `DATA_ENCRYPTION_KEY` | Owner‑Email, App‑Name, Domains |
| Bindings: `DB`, `ARCHIVE_BUCKET`, `INVOICE_SEQUENCE`, `DOCUMENT_QUEUE`, `BROWSER`, `EMAIL`, `ASSETS` | Steuernummern, Bank, Rechnungstexte, Präfixe, Zahlungsziel |
| — | Validator‑URL/Key, Ein-/Ausgangs‑Email, Cloudflare‑IDs |

Ein **Global API Key** wird nie akzeptiert — nur **Scoped API Tokens**.

## Weitere Dokumente

- [ARCHITECTURE.md](./ARCHITECTURE.md) · [SECURITY.md](./SECURITY.md)
- [VERFAHRENSDOKUMENTATION.md](./VERFAHRENSDOKUMENTATION.md)
- [DATA_EXPORT.md](./DATA_EXPORT.md) · [EINVOICE_VALIDATION.md](./EINVOICE_VALIDATION.md)
