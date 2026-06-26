import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

// Shared member IDOR guard for the patient-write Pulse routes (R2a). Identical
// in spirit to POST /api/pulse/documents: an optional member_id may only point
// at a family member that belongs to THIS customer. Absent / "" / "self" → the
// account holder (member_id null). A forged id can't attach a row to someone
// else's member.

export type MemberScope =
  | { memberId: string | null }
  | { error: string; status: number };

export async function resolveMemberId(
  customerId: string,
  raw: unknown,
): Promise<MemberScope> {
  if (raw == null || raw === "" || raw === "self") return { memberId: null };
  if (typeof raw !== "string") {
    return { error: "That family member isn't on your account.", status: 400 };
  }
  const { data, error } = await supabaseAdmin
    .from("family_members")
    .select("id")
    .eq("id", raw)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) {
    console.error("[pulse/memberScope] member lookup failed", error);
    return { error: "Could not verify the family member.", status: 500 };
  }
  if (!data) {
    return { error: "That family member isn't on your account.", status: 400 };
  }
  return { memberId: raw };
}
