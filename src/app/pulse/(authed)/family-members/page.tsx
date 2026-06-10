import { getCurrentCustomer } from "../../_lib/getCurrentCustomer";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { FamilyMember } from "@/lib/family-members/types";
import { FamilyMembersSurface } from "./FamilyMembersSurface";

// /pulse/family-members — list + add/edit/delete the patient's family.
//
// Server-renders the initial list so the surface paints instantly on mobile,
// then hands off to FamilyMembersSurface (client) for the modal-driven CRUD.
//
// Auth gate lives in the (authed) layout — this page assumes a signed-in
// customer. The /pulse v1 chrome wraps the surface; the page no longer
// renders its own header.

export const dynamic = "force-dynamic";

export default async function FamilyMembersPage() {
  const customer = await getCurrentCustomer();
  // (authed) layout already redirected on null. Purely a type guard.
  if (!customer) return null;

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
