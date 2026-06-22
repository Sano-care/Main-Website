// Slice 5 — Tool executors for the 2 new CareHub tools.
//
// Sidecar module (mirrors slice4aExecutors.ts) so adapter.ts stays small.
// The adapter's tool-dispatch switch calls into these for the two CareHub
// tool names.
//
// Identity gating:
//   - register_carehub_interest: open to any patient turn, but a NO-OP for an
//     existing member (we never pitch members) and idempotent per phone (a
//     second ask in an un-actioned window returns the existing pending lead).
//   - surface_carehub_benefits: CareHub members ONLY. Rejects every other
//     identity at the executor level (defense-in-depth on top of the
//     orchestrator withholding the schema from non-members).
//
// All reads/writes use supabaseAdmin — carehub_subscriptions and carehub_leads
// are RLS deny-all (M061/M062), per project-sanocare-rls-deny-all-tables.

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";
import type { Identity } from "@/lib/whatsapp/identity";

// CareHub member rates (20% off base). Source of truth for the surfaced
// benefits string; the KB addendum carries the same numbers for the model.
const CAREHUB_MONTHLY_VITALS_NOTE = "1 free vitals visit each month";
const CAREHUB_DISCOUNT_NOTE = "20% off every other service";
const CAREHUB_PRIORITY_NOTE = "priority Medic dispatch on every booking";

const NOT_A_MEMBER =
  "That's a CareHub-member feature — this number isn't on a CareHub plan yet. " +
  "Want me to note your interest so our team can set it up?";

// ---------------------------------------------------------------------------
// register_carehub_interest
// ---------------------------------------------------------------------------

export async function executeRegisterCarehubInterest(args: {
  identity: Identity;
  phone: string;
  sourceMessageId?: string | null;
  input: { notes?: string };
}): Promise<string> {
  // Never pitch / re-register an existing member.
  if (args.identity.role === "customer" && args.identity.subRole === "carehub") {
    return "You're already a CareHub member 🌿 — your benefits are active. Want me to show what's included?";
  }

  const customerId =
    args.identity.role === "customer" && "customerId" in args.identity
      ? args.identity.customerId ?? null
      : null;
  const notes = args.input.notes?.trim() ? args.input.notes.trim() : null;

  // Idempotency: if there's already an un-actioned lead on this phone (not yet
  // contacted, not yet converted), reuse it instead of inserting a duplicate.
  try {
    const { data: existing } = await supabaseAdmin
      .from("carehub_leads")
      .select("id")
      .eq("phone", args.phone)
      .is("contacted_at", null)
      .is("converted_subscription_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return "You're already on our CareHub follow-up list — our team will reach out soon. Anything else I can help with today?";
    }
  } catch (err) {
    // Soft-fail the dedupe check — worst case we insert a second lead, which
    // sales dedupes. Never block the capture on a read error.
    log.error("registerCarehubInterest dedupe check failed", err);
  }

  const { error } = await supabaseAdmin.from("carehub_leads").insert({
    customer_id: customerId,
    phone: args.phone,
    source: "aarogya_chat",
    source_message_id: args.sourceMessageId ?? null,
    notes,
  });
  if (error) {
    log.error("registerCarehubInterest insert failed", error.message);
    // Don't surface a DB failure to the patient — keep the experience warm and
    // route them to the team so the interest isn't lost.
    return "I'd love to tell you more about CareHub — let me connect you with our team on +91 97119 77782, same number, always reachable.";
  }

  return "Lovely — I've noted your interest in CareHub. Our team will reach out with the details soon. Anything else I can help with today?";
}

// ---------------------------------------------------------------------------
// surface_carehub_benefits (CAREHUB-ONLY)
// ---------------------------------------------------------------------------

export async function executeSurfaceCarehubBenefits(identity: Identity): Promise<string> {
  if (
    identity.role !== "customer" ||
    identity.subRole !== "carehub" ||
    !("customerId" in identity) ||
    !identity.customerId
  ) {
    return NOT_A_MEMBER;
  }

  const { data, error } = await supabaseAdmin
    .from("carehub_subscriptions")
    .select("started_at, monthly_inr")
    .eq("customer_id", identity.customerId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    log.error("surfaceCarehubBenefits read failed", error.message);
    return "Your CareHub benefits are active, but I couldn't pull the details just now. Try again in a moment, or call +91 97119 77782.";
  }
  if (!data) {
    // Identity said carehub but no active row — treat as non-member gracefully.
    return NOT_A_MEMBER;
  }

  const since = String(data.started_at).split("T")[0];
  const monthly = data.monthly_inr as number;
  return (
    `You're on CareHub since ${since} (₹${monthly}/month). Your benefits: ` +
    `${CAREHUB_MONTHLY_VITALS_NOTE}, ${CAREHUB_DISCOUNT_NOTE}, and ${CAREHUB_PRIORITY_NOTE}. ` +
    `This month's free vitals visit is ready whenever you need it.`
  );
}
