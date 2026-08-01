# Security

## Authentifizierung & Autorisierung

- Das gesamte Panel, die API und alle privaten Dateien liegen hinter
  **Cloudflare Access**.
- Der Worker **verifiziert das Access‑JWT** gegen die JWKS des Teams
  (`/cdn-cgi/access/certs`), prüft Signatur (RS256), `aud`, `iss` und `exp` — es
  wird **nicht** dem bloßen Header vertraut (`src/middleware/access.ts`).
- Team‑Domain und `aud` stammen aus D1 (`cloudflare_integrations`), nicht aus dem
  Code.
- Die `email`‑Claim muss einem **aktiven** `admin_user` entsprechen; Rollen:
  `OWNER`/`ADMIN`/`ACCOUNTANT`/`READ_ONLY`.
- Dev‑Escape‑Hatch nur, wenn `ENVIRONMENT !== production` **und** Access noch
  nicht konfiguriert ist.

## HTTP‑Härtung

- **CSP** (kein Inline‑Script), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`, HSTS in Prod.
- **CSRF**: mutierende Requests brauchen passenden `Origin`/Host **und**
  `X-Requested-With: XMLHttpRequest`. Kombiniert mit SameSite‑Cookies + Access.
- **Rate‑Limits** auf Setup, Issue und Upload (in‑Isolate + persistenter
  Setup‑Attempt‑Zähler in D1).

## Datenbank

- **Ausschließlich Prepared Statements** (`db.prepare().bind()`); keine
  String‑Interpolation von Nutzereingaben → kein SQL‑Injection.
- Foreign Keys aktiv; Statuswechsel & Snapshots in Transaktionen (`db.batch`).

## Datei‑ und XML‑Sicherheit

- Datei‑Uploads: Größenlimit, **Magic‑Byte/Signatur‑Prüfung** — der angegebene
  MIME/Dateiname wird nie allein vertraut (`src/lib/file-signature.ts`).
- XML wird mit einem **gehärteten Parser** verarbeitet: **DOCTYPE/DTD und
  ENTITY‑Deklarationen werden abgelehnt**, nur die fünf vordefinierten + numerische
  Entities werden aufgelöst → **kein XXE**, keine externen Entities
  (`src/lib/xml.ts`, Test `tests/xml.test.ts`).
- ZIP‑Upload nur nach manueller Sicherheitsprüfung (im Upload‑Endpoint abgelehnt,
  bis explizit freigegeben).
- **Path Traversal**: R2‑Keys werden serverseitig aus partitionierten Präfixen +
  Zufallskomponente gebildet; Dateinamen werden bereinigt.

## Secrets

- Keine Secrets/API‑Keys im Quellcode oder in `wrangler.jsonc`.
- Sensible Panel‑Secrets (KoSIT‑API‑Key, optionaler CF‑Token) werden mit
  **AES‑GCM** verschlüsselt in `secret_store` abgelegt (`DATA_ENCRYPTION_KEY`),
  eindeutige IV pro Secret; nie im Klartext gespeichert, nie geloggt, nur die
  letzten vier Zeichen werden angezeigt. Ohne `DATA_ENCRYPTION_KEY` ist
  Secret‑Storage **deaktiviert** (Status `NOT_CONFIGURED`), statt still im
  Klartext zu speichern.
- **Global API Key** wird nie akzeptiert — ausschließlich Scoped Tokens; CF‑Token
  standardmäßig transient (nur während der Operation im Speicher).

## Logging & Datenschutz

- Audit‑Payloads werden **redigiert** (Tokens, Keys, Passwörter →
  `[REDACTED]`, `src/services/audit-service.ts`).
- Keine vollständigen personenbezogenen/Bank‑Daten und keine kompletten
  E‑Mail‑Inhalte im allgemeinen Log.

## R2 & Downloads

- Bucket ist **privat**; Dateien werden nur über authentifizierte Endpoints
  (hinter Access) mit `Cache-Control: private, no-store` ausgeliefert
  (`src/routes/documents.ts`). Keine öffentlichen Bucket‑URLs.

## Lockout‑Schutz (Owner/Domain/Access)

Änderungen folgen dem Muster **CREATE NEW → VERIFY → TEST → ACTIVATE → DEACTIVATE OLD**
(nie „delete old, create new“). Der letzte aktive Owner kann nicht deaktiviert
werden; Ownership‑Transfer erst nach erfolgreichem Test‑Login der neuen Adresse.
