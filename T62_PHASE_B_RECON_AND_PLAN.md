# T62 Phase B — Recon & Plan of Record (Sanocare Pulse Web v0)

**Status:** Plan approved by founder 2026-06-04. Phase B = code, split into B1 + B2 (fresh continuations).
**Branch:** `pulse-v0-vitals-meds` · **PR:** #31 · **Tag (post-merge):** `pulse-v0-vitals-meds`
**This file is the canonical plan-of-record.** The next CC session should NOT re-recon — read this first.

> **NAMING:** "Patient Portal" is deprecated. The surface is **Sanocare Pulse** / **Pulse Web**.
> URLs `/pulse/*`, APIs `/api/pulse/*`. Add a `/portal/* → /pulse/*` redirect. No "portal" in copy,
> comments, or file names. The original brief (`T62_Patient_Portal_Vitals_Medications_CC_Brief.md`)
> is superseded on naming, `/pulse` paths, and `customers` (not `patients`) by the 4 Jun strategic context.

---

## 1. Recon — verified facts (build against THESE, not the brief's DDL)

### Branch topology
- `main` = `dbcdac9`.
- `pulse-v0-vitals-meds` = `1cf0607` = `main` + 1 commit (Phase A: `035_vital_readings.sql`, `036_medications.sql`).
- `web-v2-mobile-first-hero` = `83e6818` = `main` + T61 work. **Sibling** of pulse off `main` (neither contains the other).

### Live schema (M035/M036/M037 applied to prod — authoritative over the brief)
The brief's DDL said `patient_id → patients`. **Reality: `customer_id → public.customers`.** Build against live:

- **`vital_readings`**: `id, customer_id (FK customers ON DELETE CASCADE), kind, value_numeric, value_secondary, unit (default 'auto'), taken_at, context_note, source (manual|rx_import|device, default manual), created_at`.
  `kind ∈ {bp, sugar_fasting, sugar_postprandial, sugar_random, weight_kg, temperature_c, spo2_pct, pulse_bpm, other}`.
  **No `archived_at`** → vitals DELETE is a HARD delete.
  Indexes: `(customer_id, taken_at DESC)`, `(customer_id, kind, taken_at DESC)`.
- **`medications`**: `id, customer_id (FK), name, dose, frequency_label, times_per_day (0..6, default 1), scheduled_times jsonb, start_date (default CURRENT_DATE), end_date, reason, source (manual|rx_import), source_rx_id (FK prescriptions ON DELETE SET NULL), imported_needs_review boolean default false, refill_warning_threshold_days (default 5), supply_qty, supply_updated_at, created_at`.
  **`imported_needs_review` already exists** — use it (the brief omitted it).
- **`medication_intake_log`**: `id, medication_id (FK medications ON DELETE CASCADE), scheduled_at, taken_at, state (pending|taken|skipped|missed, default pending), notes, created_at`.
- **`customers`**: `id, customer_code, full_name, phone, email, date_of_birth, gender, address_line, area, city, pincode, notes, created_at, created_by`.
- **`prescriptions`**: has **no direct customer link** — joins via `booking_id`. Relevant cols: `id, prescription_code, status (default draft), sent_at, whatsapp_sent_at, booking_id, session_id, doctor_id, patient_name, patient_view_token`.
- **`prescription_items`** (Rx line items, importer source): `id, prescription_id, ordinal, drug_name, dose, frequency (free text), duration (free text), instructions, medicine_sku`.

### Infra availability
- ON main/pulse: `src/lib/time/formatIST.ts` ✅, `verifyToken` in `src/lib/otp/token.ts` ✅, `src/app/portal/page.tsx` (Construction stub) ✅, `src/components/MobileStickyBar.tsx` ✅, OTP verify route `src/app/api/auth/verify-otp/route.ts` ✅.
- **NOT on pulse** (web-v2 only): `SectionReveal`, `AnimatedCounter`, `BookingCTAStrip`, `FloatingWhatsApp`, `MobileMenu`.
- **Absent everywhere (to create):** `src/lib/design/tokens.ts`, `src/app/pulse/*`, `src/app/api/pulse/*`.

---

## 2. Decisions locked (a–e)

**(a) Implementation order** — the 13 steps stand, with corrections: `customer_id` throughout · `/pulse` + `/api/pulse` + `/portal→/pulse` redirect · `getCurrentCustomer` wraps the existing OTP-cookie + `verifyToken` → `customers` lookup (reuse, NO parallel auth) · vitals DELETE = hard · **pulse creates `src/lib/design/tokens.ts`** (lands first; T61 consumes later).

**(b) T61 reuse — APPROVED:** cherry-pick **`SectionReveal` + `AnimatedCounter`** from `web-v2` into pulse **at the start of B1**. SKIP `BookingCTAStrip` / `FloatingWhatsApp` / `MobileMenu` (marketing-surface-specific). Identical file content → trivial rebase resolution when T61 merges to main.

**(c) Charting — CONFIRMED:** `chart.js@^4` + `react-chartjs-2@^5`, tree-shaken: `LineController, LineElement, PointElement, LinearScale, TimeScale, CategoryScale, Tooltip, Filler`.

**(d) Empty-state copy — APPROVED (verbatim):**
- Vitals (none): *"Track your BP, sugar, and weight over time. Watch the trends. Catch changes early."* → **`+ Log your first reading`**
- Medications (none, no Rx): *"Keep every medicine in one place — schedules, doses, and a tap to mark each one taken."* → **`+ Add your first medication`**
- Medications (none, recent Rx exists): append *"We found a prescription from Dr {name}, {date}. Import it to set up your schedule in one tap."* → **`Import from prescription`** (primary) + **`+ Add manually`** (secondary, so import never feels mandatory)

**(e) Execution — APPROVED:** B1 then B2 as separate fresh continuations (context discipline).

---

## 3. Importer spec (LOCKED) — `POST /api/pulse/medications/import-from-rx?rx_id=`

- **Ownership:** `prescriptions JOIN bookings ON prescriptions.booking_id = bookings.id WHERE bookings.customer_id = <me>`. Reject if the Rx isn't the signed-in customer's.
- **"Recent + unimported"** (for the banner + guard): `prescriptions.status = 'sent'` AND `prescriptions.sent_at >= now() - 7 days` AND `NOT EXISTS (SELECT 1 FROM medications WHERE source_rx_id = prescriptions.id)`.
- **Source rows:** `prescription_items` for that `prescription_id` → `medications` with `source='rx_import'`, `source_rx_id` set.
- **Lossy mapper** (`frequency`/`duration` are free text): map drug_name→name, dose→dose, frequency→`frequency_label` + parse to `times_per_day` + `scheduled_times`; duration→`end_date` (start_date + parsed days).
  - twice-daily → `['08:00','20:00']` · once-daily → `['09:00']` · three-times → `['08:00','14:00','21:00']` · four-times → `['07:00','13:00','19:00','23:00']` (all IST).
  - Unparseable frequency → `times_per_day=1`, `['09:00']`.
  - **`imported_needs_review = true`** whenever any of `times_per_day` / `scheduled_times` / `end_date` came from a heuristic default (surface a "review" pill in the UI).

---

## 4. ⚠️ Migration-number collision — resolve at MERGE TIME, not now

`pulse-v0-vitals-meds` has `035_vital_readings.sql` + `036_medications.sql`. The WhatsApp branch (`feat/whatsapp-agent-week1`) has `035_whatsapp_agent.sql`. Both already applied to prod (timestamped → DB is correct). The **file numbers collide** only when both branches merge to main.
**Action (deferred):** whichever of T62 / WhatsApp merges **second** renames its `035` (and, if needed, downstream) to the next free slot. **Do NOT touch either branch's file numbering until then.**

---

## 5. B1 / B2 scope (each a fresh continuation)

- **B1** (steps 4–7 + 12): cherry-pick `SectionReveal` + `AnimatedCounter` from web-v2 → `src/lib/design/tokens.ts` → `getCurrentCustomer` → `<PulseShell>` → `/pulse/login` (OTP + name-capture, auto-create customer) → the **12 `/api/pulse/*` routes** (5 vitals + 7 medications, all auth-gated) → `/portal→/pulse` redirect in `next.config`. Commit checkpoint; preview deploy.
- **B2** (steps 8–11 + 13–16): `chart.js`+`react-chartjs-2` install → `/pulse/vitals` (recent + trends chart + add) → `/pulse/medications` (today's schedule + active list + adherence + Rx import banner) → `/pulse` home (replace Construction with the two hero tiles per `Sanocare_Pulse_Web_Mockup_v1.html`) → IST verification (zero `toLocaleString`; `formatIST` everywhere) → lint+build+test → desktop-Chrome + Android-emulation self-QA → take PR #31 out of Draft, request review. Founder does real-hardware QA (iPhone Safari + Android Chrome).

**Standing rules:** preview deploy before review · no PII in PR description · founder reviews before merge · all datetimes via `formatIST` (ESLint guardrail, no `eslint-disable` without cause) · respect `prefers-reduced-motion`.
