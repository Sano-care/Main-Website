import { getCurrentCustomer } from "../../_lib/getCurrentCustomer";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { FamilyMember } from "@/lib/family-members/types";

import ProfileSurface, { type CustomerSnapshot } from "./ProfileSurface";

/**
 * T90 Slice 2 Step 13 — Profile tab (Surface 8 in brief).
 *
 * Server component. Fetches the full customer snapshot (including the
 * fields the Profile tab edits: email, date_of_birth, gender,
 * health_notes) + the family-members list once, then hands both to
 * ProfileSurface (client). The client uses useViewingMember() to
 * pick which subject to render — chrome chip switches viewing
 * without a page reload.
 *
 * Auth gated by the (authed) layout (redirect → /pulse/login on
 * null). The null-check below is type narrowing only.
 *
 * force-dynamic so the fetched snapshot always reflects fresh
 * values after an inline edit elsewhere in the session.
 */

export const dynamic = "force-dynamic";

const CUSTOMER_SELECT =
  "id, full_name, phone, email, date_of_birth, gender, health_notes";
const FAMILY_MEMBER_SELECT =
  "id, customer_id, name, relation, relation_other, dob, gender, notes, health_notes, created_at, updated_at";

export default async function PulseProfilePage() {
  const customerCookie = await getCurrentCustomer();
  if (!customerCookie) return null;

  const [{ data: customerRow }, { data: members }] = await Promise.all([
    supabaseAdmin
      .from("customers")
      .select(CUSTOMER_SELECT)
      .eq("id", customerCookie.id)
      .maybeSingle(),
    supabaseAdmin
      .from("family_members")
      .select(FAMILY_MEMBER_SELECT)
      .eq("customer_id", customerCookie.id)
      .order("created_at", { ascending: true }),
  ]);

  // Soft-fail snapshot — if the customer row read errors, fall back to
  // the (authed)-cookie-derived identity so the page still renders
  // something coherent (avoids a confusing blank profile after a
  // transient DB hiccup).
  const customer: CustomerSnapshot = customerRow
    ? {
        id: customerRow.id as string,
        full_name: (customerRow.full_name as string | null) ?? null,
        phone: (customerRow.phone as string) ?? customerCookie.phone,
        email: (customerRow.email as string | null) ?? null,
        date_of_birth: (customerRow.date_of_birth as string | null) ?? null,
        gender: (customerRow.gender as string | null) ?? null,
        health_notes: (customerRow.health_notes as string | null) ?? null,
      }
    : {
        id: customerCookie.id,
        full_name: customerCookie.full_name,
        phone: customerCookie.phone,
        email: null,
        date_of_birth: null,
        gender: null,
        health_notes: null,
      };

  return (
    <ProfileSurface
      customer={customer}
      members={(members ?? []) as FamilyMember[]}
    />
  );
}
