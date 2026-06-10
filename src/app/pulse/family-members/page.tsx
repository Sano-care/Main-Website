import { PulseShell } from "../_components/PulseShell";
import { PulsePageHeader } from "../_components/PulsePageHeader";
import { getCurrentCustomer } from "../_lib/getCurrentCustomer";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { FamilyMember } from "@/lib/family-members/types";
import { FamilyMembersSurface } from "./FamilyMembersSurface";

// /pulse/family-members — list + add/edit/delete the patient's family.
//
// Server-renders the initial list so the surface paints instantly on mobile,
// then hands off to FamilyMembersSurface (client) for the modal-driven CRUD.
// Same shell pattern as /pulse/vitals and /pulse/medications.

export const dynamic = "force-dynamic";

export default async function FamilyMembersPage() {
  return (
    <PulseShell next="/pulse/family-members">
      <PulsePageHeader title="Family Members" />
      <FamilyMembersPageBody />
    </PulseShell>
  );
}

async function FamilyMembersPageBody() {
  const customer = await getCurrentCustomer();
  if (!customer) return null; // guaranteed inside PulseShell; type guard

  // Initial fetch — same query as GET /api/pulse/family-members. Inline
  // here (vs. a pulseData helper) because there's only one consumer.
  const { data, error } = await supabaseAdmin
    .from("family_members")
    .select(
      "id, customer_id, name, relation, relation_other, dob, gender, notes, created_at, updated_at",
    )
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[pulse/family-members] initial fetch failed:", error);
  }

  const initial = (data ?? []) as FamilyMember[];

  return <FamilyMembersSurface initial={initial} />;
}
