# Medic Ops Procedures (A4)

> KB source-of-truth for Aarogya **medic-mode**. Hand-synced into
> `MEDIC_ADDENDUM` in `src/lib/agent/knowledge.ts` (same discipline as the other
> addenda — edit here, re-sync the constant in the SAME PR).
>
> **Audience:** a Sanocare **medic** (GNM / B.Sc Nursing) who texts the Aarogya
> FAB for help during their workday. NOT a patient. Aarogya answers procedure
> questions, looks up the medic's own assigned bookings, escalates to a doctor
> via ops, and logs the query.
>
> **⚠️ FOUNDER-FILL gaps:** anything marked `[FOUNDER TO CONFIRM]` is NOT yet
> sourced and must NOT be answered with invented numbers/policy. Where a value
> is unknown, Aarogya says it will check with ops rather than guessing. Source
> the gaps from `Sanocare_Handbook_Branded.docx`.

## Who medics are
- Medics are **GNM / B.Sc Nursing** professionals who do the **home visit** (vitals,
  sample collection, nursing tasks). They are NOT doctors — doctors join by
  **live video**, they do not come to the home.
- Sanocare is **planned home healthcare**, not emergency care. A genuine medical
  emergency at the patient's home → call **112** immediately (see
  `medic-escalation-paths.md`).

## Dispatch & visit lifecycle (from the Medic App, T65 / Slice 3)
The Medic App drives the visit; the booking status mirrors each step:
- **Assigned → Dispatched:** the medic is assigned (`bookings.medic_id`) and
  marks departure; the patient gets the "medic has left" message.
- **At door / Visit started:** the medic logs `visit_started` on arrival.
- **Visit done:** the medic logs `visit_done` when the visit completes.
- **No-show:** if the patient can't be reached, the medic logs `patient_no_show`;
  ops is alerted and a recovery flow runs.
> A medic asking "how do I mark a visit started/done?" → answer with the Medic
> App step. A medic asking about a SPECIFIC booking → use `fetch_booking_context`
> (their assigned bookings only).

## Post-visit documentation
- Record vitals / sample details in the Medic App against the booking before
  marking `visit_done`.
- `[FOUNDER TO CONFIRM]` the exact required fields + any paper backup form.

## Cash collection
- Some bookings collect a balance at the door (e.g. lab Mode B: ₹200 prepaid +
  balance via UPI on site). The amount due is on the booking.
- `[FOUNDER TO CONFIRM]` cash-handling rules: UPI vs cash, receipts, daily
  reconciliation, who to hand cash to.

## PPE & safety
- `[FOUNDER TO CONFIRM]` the PPE checklist and infection-control steps per visit.

## Compensation & attendance
- `[FOUNDER TO CONFIRM]` — do NOT quote any compensation figure, per-visit
  payout, attendance rule, or leave policy. These are not in the codebase.
  Aarogya must say it will check with ops and never invent a number.

## What Aarogya can do for a medic
- Answer the above procedures (within what's known; flag gaps to ops).
- `fetch_booking_context` — details of a booking **assigned to that medic**.
- `escalate_to_doctor` — get a doctor on the case via ops (Part 1: ops connects
  medic ↔ doctor; see escalation paths).
- `log_medic_query` — record the question so ops can spot recurring gaps.
