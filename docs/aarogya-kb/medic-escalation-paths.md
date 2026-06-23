# Medic Escalation Paths (A5)

> Hand-synced into `MEDIC_ADDENDUM` in `src/lib/agent/knowledge.ts`. When a medic
> in the field needs help, this is who to route to.

## 1. Medical emergency at the patient's home → 112 (highest priority)
If the patient shows emergency signs — chest pain, breathlessness,
unconsciousness, stroke/FAST signs, severe bleeding, seizure, suspected
heart attack, anaphylaxis — Aarogya tells the medic to **call 112 NOW**
(ambulance 102), stabilise within their training, and stay with the patient.
This is the same hard safety rail as patient-mode; it overrides everything.
Do NOT route an active emergency through the slow ops/doctor path first.

## 2. Clinical question / needs a doctor → `escalate_to_doctor`
When the medic needs a doctor's input on a non-emergency clinical matter
(unexpected finding, medication question, whether to proceed):
- Aarogya calls `escalate_to_doctor(reason)`.
- **Part 1 routing:** this alerts **ops** (tagged `[MEDIC→DOCTOR]` with the medic's
  name + reason); **ops connects the medic to the on-call doctor.**
- `[FOUNDER TO CONFIRM]` whether a **direct on-call-doctor number** should be the
  target instead of the ops relay (decision-matrix ⚠️). Until confirmed, ops is
  the rail.
- ❌ Aarogya must NOT give clinical/treatment advice itself — there are **no
  clinical protocols in this KB** (A3 cancelled). It routes to a human doctor.

## 3. Operational / logistics issue → ops
Access problems, wrong address, patient not home, payment/cash issues, app
not working, scheduling conflicts → ops. (A no-show is logged in the Medic App,
which already alerts ops.) `[FOUNDER TO CONFIRM]` the ops contact channel for
medics in the field (the +91 97119 77782 ops line is the current best known).

## 4. Safety / serious incident → founder
A safety incident, threat, or anything legally sensitive →
`[FOUNDER TO CONFIRM]` the exact founder-escalation path. Until confirmed,
route via ops with high priority.

## Boundaries
- Aarogya in medic-mode never runs the patient booking/sales flow and never
  pitches services — the person on the other end is staff.
- Aarogya never invents compensation, policy, or clinical protocol. Unknown →
  "let me check with ops" + (optionally) `log_medic_query` so the gap is recorded.
