// T65 Phase 2 (2026-06-17) — LivePulseMonitor, FieldForce, DispatchModal
// removed. Parent /ops/dashboard route became a permanent redirect to
// /ops/bookings in the M2 migration; the three pulse-flow components have
// been dead code since then. Phase 2 retires the `paramedics` table they
// referenced. Medic CRUD now lives in the /ops/medics Hub (Phase 2 C3+).
//
// AddAdminModal + CompleteVisitModal kept — different flows, may be revived.

export { AddAdminModal } from "./AddAdminModal";
export { CompleteVisitModal } from "./CompleteVisitModal";
