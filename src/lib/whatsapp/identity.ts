// T-Aarogya-Phase1 C1 — phone → identity resolver.
//
// Aarogya's identity routing needs to know *who* a WhatsApp number belongs to
// before the brain runs. This is the single source of that truth. It is
// adapter-injected only — the resolved Identity is passed into the orchestrator
// turn context and the audit trail, NEVER surfaced to or trusted from the model
// (prompt-injection guard, mirrors the Slice 1 phone-injection pattern).
//
// Precedence (founder vision 2026-06-18): doctors → medics → customers/booking
// history → new. First match wins. Staff matches are NOT filtered by active
// status — identity answers "whose number is this", not "are they on shift"
// (and it sidesteps the doctors.is_active vs medics.active column split).
//
// CareHub: there is no carehub/subscription table in the schema yet, so
// subRole "carehub" is currently unreachable — see TODO(carehub). Until then a
// customer with a `customers` row resolves to "registered"; a number with only
// booking history (no customers row) resolves to subRole "new".
//
// Phone matching reuses normalizePhoneLast10() (the booking-side helper): we
// match on the last 10 digits. Staff/customer phones are stored clean E.164;
// the SQL is a suffix ilike, re-confirmed in JS via the normalizer so a dirty
// stored value can't produce a false positive.

import { supabaseAdmin } from "@/lib/supabase-server";
import { findBookingsByPhone, normalizePhoneLast10 } from "@/lib/agent/bookings";
import { FOUNDER_OPS_PHONE } from "@/lib/whatsapp/constants";

export type StaffRole = "doctor" | "medic";
export type CustomerSubRole = "new" | "registered" | "carehub";

export type Identity =
  | { role: "doctor"; doctorId: string; fullName: string }
  | { role: "medic"; medicId: string; fullName: string }
  | { role: "customer"; subRole: CustomerSubRole; customerId?: string; fullName?: string }
  // Slice 4a — founder/ops mode. resolveIdentity short-circuits to this
  // BEFORE any DB lookup when the inbound phone matches FOUNDER_OPS_PHONE.
  // Phone is the only field; ops_founder is a phone-number assertion, not
  // a DB-backed identity (no `staff` table for "ops" exists).
  | { role: "ops_founder"; phone: string }
  | { role: "new" };

type PhoneRow = { id: string; full_name: string | null; phone: string };

/**
 * Match a `{ id, full_name, phone }` row in `table` whose phone ends with the
 * given last-10 digits. Suffix ilike + JS re-confirm. Returns null on no match
 * or any query error (soft-fail — an identity miss degrades to a lower
 * precedence tier, never throws into the message path).
 */
async function matchByPhoneSuffix(
  table: "doctors" | "medics" | "customers",
  last10: string,
): Promise<PhoneRow | null> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id, full_name, phone")
    .ilike("phone", `%${last10}`)
    .limit(5);
  if (error || !data) return null;
  const hit = (data as PhoneRow[]).find(
    (r) => normalizePhoneLast10(r.phone) === last10,
  );
  return hit ?? null;
}

/**
 * Resolve a phone number to an Identity. Stateless — the caller (adapter)
 * invokes this ONCE per conversation and threads the result through the turn
 * (that single call is the conversation-scoped cache; nothing is memoised
 * across invocations / processes).
 */
export async function resolveIdentity(phone: string): Promise<Identity> {
  const last10 = normalizePhoneLast10(phone);
  // Too few digits to match anything reliably → treat as new.
  if (last10.length < 10) return { role: "new" };

  // 0. Founder/ops short-circuit — phone-only, no DB.
  //    The founder ALSO has a customers row (via co-founder testing) so
  //    without this, resolveIdentity would land on role: "customer". We
  //    want ops_founder to win, so the check goes BEFORE the doctor/
  //    medic/customer lookups.
  if (normalizePhoneLast10(FOUNDER_OPS_PHONE) === last10) {
    return { role: "ops_founder", phone: FOUNDER_OPS_PHONE };
  }

  // 1. Doctor
  const doctor = await matchByPhoneSuffix("doctors", last10);
  if (doctor) {
    return { role: "doctor", doctorId: doctor.id, fullName: doctor.full_name ?? "" };
  }

  // 2. Medic
  const medic = await matchByPhoneSuffix("medics", last10);
  if (medic) {
    return { role: "medic", medicId: medic.id, fullName: medic.full_name ?? "" };
  }

  // 3. Customer — a real customers row → "registered".
  // TODO(carehub): when a carehub/subscription table lands, sub-classify an
  // active subscriber as "carehub" here (precedence above "registered").
  const customer = await matchByPhoneSuffix("customers", last10);
  if (customer) {
    return {
      role: "customer",
      subRole: "registered",
      customerId: customer.id,
      fullName: customer.full_name ?? undefined,
    };
  }

  // 3b. No customers row, but prior booking history → customer / "new".
  const { latest } = await findBookingsByPhone(phone);
  if (latest) {
    return { role: "customer", subRole: "new" };
  }

  // 4. Unknown number.
  return { role: "new" };
}

/**
 * Flatten an Identity into the audit-log identifier shape:
 *   { role, identifiers: { doctor_id? | medic_id? | customer_id? } }
 * Used by the adapter's audit writes for DPDP-traceable, phone-free logging.
 */
export function identityForAudit(identity: Identity): {
  role: string;
  identifiers: { doctor_id?: string; medic_id?: string; customer_id?: string };
} {
  switch (identity.role) {
    case "doctor":
      return { role: "doctor", identifiers: { doctor_id: identity.doctorId } };
    case "medic":
      return { role: "medic", identifiers: { medic_id: identity.medicId } };
    case "customer":
      return {
        role: `customer:${identity.subRole}`,
        identifiers: identity.customerId ? { customer_id: identity.customerId } : {},
      };
    case "ops_founder":
      // Phone-anchored identity — no DB id to stamp. The phone itself
      // is the identifier; audit rows that need to link to ops_founder
      // can stamp it from the conversation row.
      return { role: "ops_founder", identifiers: {} };
    case "new":
      return { role: "new", identifiers: {} };
  }
}
