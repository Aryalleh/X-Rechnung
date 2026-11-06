# X-Rechnung — Design Handoff

> For the designer. This maps **every screen, component, token, state and flow as
> the app is built today** — plus the real gaps worth your time. The app already
> has a coherent, token-driven design system (indigo "Flat Design", light + dark,
> full RTL, fa/de/en). So this is mostly a **refinement + fill-the-gaps** brief,
> not a from-scratch redesign. Everything below matches the live code 1:1.

**Product:** invoicing for **German freelancers (Kleinunternehmer §19)**, **Iranian
freelancers**, and **small Iranian businesses**. Admin UI defaults to **Persian, RTL**;
invoices render in **German / English / Persian**.

---

## 0. Two design surfaces

| Surface | Audience | Direction | Status |
|---|---|---|---|
| **A. Admin app** | the owner | RTL (fa) / LTR (de,en) | **designed & themed** — refine visuals, fill gaps |
| **B. Invoice PDF** | the owner's customers | de/en LTR, fa RTL | **designed to a reference** — refine, add logo/stamp |

---

## 1. What already exists (so you don't redo it)

- A **semantic token system** (CSS variables) with **light + dark** themes, auto/light/dark toggle.
- A **component library** (`src/frontend/ui.tsx`): Icon set, Logo, PageHeader, Section, Field,
  Alert, Spinner, Loading, EmptyState, StatusBadge, Badge, **Toast**, **Modal**, **MoneyInput**,
  theme hooks, enum `<Options>`.
- **Full i18n** (`i18n.tsx`, ~1200 lines) in **fa / de / en** with a language switch, and an
  install-mode that limits which languages/currencies appear.
- **App shell**: sidebar nav + sticky top bar + **command palette** (`Ctrl/⌘-K` or `/`) +
  mobile drawer + language switch + theme switch.
- **Status badges** with a defined tone map, **filters + search** on lists, **RTL mirroring**,
  visible focus rings, reduced-motion support.

Your job is to make it look *great* and close the specific gaps in §8 — not to invent the system.

---

## 2. Design tokens (source of truth: `styles.css` + `tailwind.config.js`)

All colors are CSS variables as `R G B` triplets, referenced via Tailwind semantic names
(`bg`, `surface`, `surface-2`, `line`, `line-strong`, `fg`, `muted`, `primary`,
`primary-hover`, `primary-soft`, `primary-fg`, `on-primary`, `success/warning/danger/info`
each with a `-soft` variant). Swap a value in one place → both themes update.

### Light (default)
```
bg #F8FAFC   surface #FFFFFF   surface-2 #F1F5F9
line #E2E8F0 line-strong #CBD5E1
fg #0F172A   muted #475569
primary #4F46E5  primary-hover #4338CA  primary-soft #EEF2FF  primary-fg #4338CA  on-primary #FFF
success #15803D/soft #DCFCE7 · warning #B45309/soft #FEF3C7 · danger #B91C1C/soft #FEE2E2 · info #0369A1/soft #E0F2FE
```
### Dark (`.dark` on <html>)
```
bg #020617  surface #0F172A  surface-2 #1E293B
line #1E293B line-strong #334155
fg #F1F5F9  muted #94A3B8
primary #4F46E5 primary-hover #6366F1 primary-soft #1E1B4B primary-fg #A5B4FC
success #4ADE80 · warning #FBBF24 · danger #F87171 · info #38BDF8 (+ dark `-soft`s)
```

### Type
- Fonts: **Inter Variable** (LTR) / **Vazirmatn Variable** (RTL) via `--font-sans`;
  base **15px**, line-height **1.55**. Amounts use **tabular figures**.
- In use: page title `text-2xl` bold, section `text-base font-semibold`, body `text-sm`,
  labels `13px` medium muted, hints/meta `text-xs`.

### Shape / motion
- Radius: inputs/buttons `rounded-lg` (8px), cards `rounded-xl` (14px), badges pill.
- Transition default **150ms**. Focus: 2px primary outline, offset 2px, **focus-visible only**.
- `.flip-rtl` flips directional icons in RTL.

**Designer deliverable:** you may re-skin these values (and I'll wire them), but keep the
**semantic names**. A formal type scale + elevation scale would be welcome additions.

---

## 3. App shell (every signed-in screen)

- **Left sidebar (264px, sticky):** Logo + app name + tagline, then nav items (icon + label):
  Dashboard · Invoices · New Invoice · Customers · Inbox (E-Rechnung) · Settings. Active =
  `primary-soft` bg + `primary-fg`. On mobile the sidebar becomes a **drawer** (hamburger).
- **Top bar (64px, sticky, blurred):** mobile menu button · a **search/command trigger**
  (full-width, shows `Ctrl K`) · **language switch** (globe, only if ≥2 languages allowed) ·
  **theme switch** (auto/sun/moon cycle).
- **Command palette** (`Ctrl/⌘-K` or `/`): global search/launcher — currently customer-focused.
  **Refine the palette UX** (recent, grouped results, keyboard hints).
- Content: centered, `max-w-6xl`, 16/24px gutters.
- **Boot states:** full-screen spinner while loading; network-error screen with retry.

---

## 4. Component inventory (exists — restyle, don't rebuild)

| Component | Notes / states |
|---|---|
| **Icon** | 32 inline SVGs: `dashboard file filePlus users inbox settings search plus x trash download upload send check alert info sun moon monitor globe menu eye bookmark chevronDown chevronRight user building banknote clock package pencil ban activity save`. **You may supply a refined icon set (Lucide-style) — keep these names.** |
| **Logo** | placeholder mark — **needs a real logo + tenant logo slot.** |
| **PageHeader** | title + subtitle + actions row. |
| **Section** | titled card block (optional icon + actions). |
| **Field** | label + control + hint + **error** state. |
| **Alert** | tones info/success/warning/danger, optional close; `role=alert` for danger. |
| **Toast** | provider + `useToast`; bottom, auto-dismiss, tone icon. |
| **Modal** | header/body/footer, wide variant, close button, backdrop. |
| **StatusBadge / Badge** | pill; status→tone map in §5. |
| **Spinner / Loading / EmptyState** | list loading + empty patterns (empty = icon in soft circle + title + action). |
| **MoneyInput** | currency-aware numeric input (parses `1.234,56` / `۱٬۲۳۴٫۵۶`). |
| **Options** | renders enum selects from i18n. |
| **buttons** | `.btn-primary` (indigo) · `.btn-secondary` (outlined) · `.btn-ghost` · `.btn-danger` · `.btn-sm` · `.btn-icon`. h-40 (h-44 on mobile for touch). |
| **inputs** | `.input` (h-40/44 mobile), hover/focus/disabled states, `.label`, `.hint`. |
| **table.data** | sticky-feel header (muted uppercase), row hover, `row-link` clickable rows. |

**Still missing (please design):** charts, date-picker styling, file-upload dropzone,
slide-over/side-panel, masked-secret field pattern, status timeline, email-compose modal,
tooltip, pagination, illustration/empty-state art, the real logo + icon set.

---

## 5. Status & badge semantics (tone map is live)

**Invoice status → tone:** DRAFT = neutral · READY_TO_ISSUE/ISSUING = info · ISSUED/SENT =
primary · PARTIALLY_PAID = warning · PAID = success · OVERDUE = danger ·
CANCELLATION_PENDING = warning · CANCELLED = neutral + strikethrough.
**E-invoice validation:** PENDING/UNSUPPORTED = neutral · BASIC_VALID/STRICT_VALID = success ·
BASIC_INVALID/STRICT_INVALID/PROCESSING_ERROR = danger · BASIC_CHECK_ONLY = warning.
**System status chips:** OK = success · WARNING = warning · ERROR = danger · NOT_CONFIGURED =
neutral · TESTING = info. Never rely on color alone — each badge carries a localized label.

---

## 6. Screens as-built (+ polish notes)

- **Setup Wizard** `/setup` (pre-auth, stepped, RTL): owner account (name, email, recovery,
  **install profile** fa-only/de-only/both) → Cloudflare connect (optional) → finish. The
  first person to submit becomes OWNER (no token UI anymore). *Polish: make it feel premium;
  review the stepper + review step.*
- **Dashboard** `/`: KPI cards (open, overdue, paid revenue, unpaid received, invalid
  e-invoices, failed jobs) + informational-only disclaimer. *Gap: **charts** (revenue trend,
  invoices/month, open-by-customer, expenses) + a recent-activity list — not built yet.*
- **Invoices** `/invoices`: PageHeader + CSV export + New Invoice; **search** (by number /
  customer / code) + **status filter tabs**; table (number · customer+doc type · date · due ·
  amount · StatusBadge); Loading/Empty states. *Polish: filter bar density, pagination, saved views.*
- **New Invoice** `/invoices/new` ★: the core flow — customer lookup (CustomerSearch /
  command-style) → auto-load → project/date/**currency**/**language** → service templates →
  **manual line items** (MoneyInput, quantity parsing) → **financial section** (discount %/fixed,
  **VAT rate** incl. Iranian rules, advance payment, **installments editor**) → live summary
  (subtotal→discount→net→VAT→total→advance→amount due; or §19 note) → save draft / preview /
  **issue**. *Polish: consider a 2-pane form + live preview; make the fast path feel instant.*
- **Invoice Detail** `/invoices/:id`: header + actions (preview, download PDF, issue, send
  email, Storno); items + total + §19; payments (add payment: date/amount/method) with paid vs
  remaining; installments (toggle paid); related docs. *Gap: status timeline, email-compose modal,
  confirm dialogs for Storno, immutable/locked visual.*
- **Customers** `/customers`: search + CSV + create; table (code · type · company/name · email ·
  city · active). *Polish: group the ~15-field form into sections in a Modal/slide-over; add a
  customer detail page (their invoices + paid/open totals — API already returns these); CSV import UI.*
- **Inbox (E-Rechnung)** `/inbox`: CSV + **upload (.xml/.pdf)**; table (supplier · number · date ·
  amount · format · validation badge · duplicate · source). *Biggest visual gap: the **detail
  view** — extracted fields, readable XML viewer, validation messages, duplicate accept/reject,
  record-payment, download original/raw-email/hash.*
- **Settings** `/settings/*` (left sub-nav): Seller profile · General · **Currency & "حذف صفر"
  redenomination** · Invoice (prefixes/texts/**accent color**/**brand heading**/custom font) ·
  E-Rechnung & Validator (KoSIT, masked key) · Users & roles · Cloudflare · **System status**
  (component chips). *Polish: one consistent settings pattern — section cards, descriptions,
  dirty-state save bar, masked-secret "reveal last 4 / replace / delete", test-and-confirm.*

---

## 7. Invoice PDF (Surface B) — already matches the reference

One layout, three languages (fa mirrored). Top accent bar → sender line + recipient / bold
**brand heading** → big title + small-caps meta column → striped line-item table → financial
summary (subtotal, discount, net, VAT, **total**, advance, **amount due**) → §19/tax note →
**installment schedule** → payment sentence + thanks + signature → contact/bank footer.
Persian: full RTL, Persian digits, **embedded Vazirmatn**, **footer on the LEFT**, optional
uploaded font. Accent color + brand heading are tenant-configurable; Kleinunternehmer shows no
VAT line. *Designer: logo placement, optional second accent, print margins, a draft/paid stamp.
I can regenerate de/en/fa PNG/PDF renders on request.*

---

## 8. Where your effort matters most (priority)

1. **Visual refinement pass** of the whole admin (spacing rhythm, hierarchy, the indigo system
   feeling premium in light + dark) — the bones are there.
2. **Dashboard charts** + recent activity (design 3–4 accessible chart cards + states).
3. **Inbox detail view** (currently thin) — highest-value new screen.
4. **New Invoice** layout polish (2-pane + live preview) — the core loop.
5. **Settings** consistent form pattern + masked-secret component.
6. **Icon set + real logo + empty-state illustrations** (replace the placeholder inline SVGs).

---

## 9. Facts to design against

- **i18n fa/de/en**, RTL-first; language switch appears only when the install mode allows ≥2.
  Keep LTR for emails/IBAN/codes (inputs already force `dir="ltr"` there).
- **Light + dark** are both first-class — design both; don't infer one from the other.
- **Accessibility:** WCAG-AA contrast, visible `:focus-visible` rings, labels on all controls,
  status never by color alone, `prefers-reduced-motion` respected, 44px touch targets on mobile.
- **Responsive:** 375 / 768 / 1024 / 1440; tables → stacked on mobile; sidebar → drawer < 1024px.
- **Numbers/money:** tabular figures; de `1.250,00 €`, fa `۲۵۰٬۰۰۰ تومان`, en `€1,250.00`.
- **Tokens live in** `src/frontend/styles.css` (values) + `tailwind.config.js` (names);
  components in `src/frontend/ui.tsx`; copy in `src/frontend/i18n.tsx`.

Hand me a token set (colors/type/space/radius/shadow for light+dark), an icon set, and Figma
components matching §4 names, and I'll wire them in directly.
