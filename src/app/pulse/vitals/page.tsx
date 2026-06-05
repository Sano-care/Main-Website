import { PulseShell } from "../_components/PulseShell";
import { PulsePageHeader } from "../_components/PulsePageHeader";
import { getCurrentCustomer } from "../_lib/getCurrentCustomer";
import { isVitalKind, type VitalKind } from "@/app/api/pulse/_lib/validation";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { VitalReading } from "../_lib/pulseTypes";
import { VitalsSurface } from "./VitalsSurface";

// /pulse/vitals — recent readings + trends chart + add-reading sheet.
//
// Server-renders the first page of readings so the surface paints instantly on
// mobile, then hands off to the client VitalsSurface for tabs, charting and
// logging. `?add=<kind>` (set by the home "+ Log" affordance) opens the
// add-sheet pre-set to that kind for the fast log path.

export const dynamic = "force-dynamic";

export default async function VitalsPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  return (
    <PulseShell next="/pulse/vitals">
      <PulsePageHeader title="Vitals" />
      <VitalsPageBody searchParams={searchParams} />
    </PulseShell>
  );
}

async function VitalsPageBody({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const { add } = await searchParams;
  const addKind: VitalKind | null = isVitalKind(add) ? add : null;

  const customer = await getCurrentCustomer();
  // Guaranteed non-null inside PulseShell, but guard for the type.
  if (!customer) return null;

  // First page of readings, newest first — same shape the client refetches.
  const { data } = await supabaseAdmin
    .from("vital_readings")
    .select(
      "id, kind, value_numeric, value_secondary, unit, taken_at, context_note, source, created_at",
    )
    .eq("customer_id", customer.id)
    .order("taken_at", { ascending: false })
    .limit(100);

  return (
    <VitalsSurface
      initialReadings={(data ?? []) as unknown as VitalReading[]}
      initialAddKind={addKind}
    />
  );
}
