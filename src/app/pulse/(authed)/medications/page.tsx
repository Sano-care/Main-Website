import { MedicationsSurface } from "./MedicationsSurface";

// /pulse/medications — today's schedule, active meds, adherence and the Rx
// import banner. The surface fetches its own data from the Pulse API (active
// meds, today's doses, adherence, importable Rx) so marking a dose can re-pull
// the schedule + adherence together and keep them consistent.
//
// Auth gate lives in the (authed) layout — this page assumes a signed-in
// customer. The /pulse v1 chrome (PulseAppBar + PulseDrawer) wraps the
// surface; the page no longer renders its own header.

export const dynamic = "force-dynamic";

export default function MedicationsPage() {
  return <MedicationsSurface />;
}
