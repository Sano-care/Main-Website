import { PulseShell } from "../_components/PulseShell";
import { PulsePageHeader } from "../_components/PulsePageHeader";
import { MedicationsSurface } from "./MedicationsSurface";

// /pulse/medications — today's schedule, active meds, adherence and the Rx
// import banner. The surface fetches its own data from the Pulse API (active
// meds, today's doses, adherence, importable Rx) so marking a dose can re-pull
// the schedule + adherence together and keep them consistent.

export const dynamic = "force-dynamic";

export default function MedicationsPage() {
  return (
    <PulseShell next="/pulse/medications">
      <PulsePageHeader title="Medications" />
      <MedicationsSurface />
    </PulseShell>
  );
}
