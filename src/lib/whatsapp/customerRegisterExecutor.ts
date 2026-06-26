import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";
import { normaliseIndianPhone } from "@/lib/otp/token";
import { validatePatientName } from "@/lib/booking/customerLink";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { identityForAudit, type Identity } from "@/lib/whatsapp/identity";

// Aarogya auto-register — silent customer-row creation when a sender gives their name.
//
// Founder decisions encoded:
//   - Name-gated: full_name (the ONLY model field) must pass validatePatientName.
//     Invalid → create nothing, say nothing.
//   - Phone is taken from the INJECTED conversation identity (never a model arg),
//     normalised to E.164 — the same format the canonical verify-otp writer uses.
//   - One canonical upsert: aarogya_register_customer() does next_code('customer')
//     inline with the insert (no burned codes), fill-if-null only (never overwrites
//     an existing name/code), keyed off identity.customerId for the UPDATE path.
//   - Trio (full_name + phone + customer_code) enforced HERE at the app layer.
//   - Silent: returns void and does NOT set the reply — the model's own natural
//     message (e.g. "Thanks, Rakesh!") stands. No "I saved your data" notice.

export interface RegisterCustomerInput {
  full_name?: unknown;
  address_line?: unknown;
  area?: unknown;
  city?: unknown;
  pincode?: unknown;
  email?: unknown;
  date_of_birth?: unknown;
  gender?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BEST_EFFORT_KEYS = [
  "address_line",
  "area",
  "city",
  "pincode",
  "email",
  "date_of_birth",
  "gender",
] as const;

function cleanStr(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s.slice(0, max) : null;
}

export async function executeRegisterCustomer(args: {
  identity: Identity;
  /** inbound.phone — injected at dispatch, NEVER a model argument. */
  phone: string;
  conversationId: string | null;
  input: RegisterCustomerInput;
}): Promise<void> {
  // 1. Name gate — placeholder / too-short / too-long rejected. Silent on fail.
  const nameCheck = validatePatientName(args.input.full_name);
  if (!nameCheck.ok) return;

  // 2. Phone from the injected identity → E.164.
  const phone = normaliseIndianPhone(args.phone);
  if (!phone) {
    log.error("registerCustomer: un-normalisable inbound phone — skipping");
    return;
  }

  // 3. Existing row from the AUTHORITATIVE identity match (last-10). null ⇒ insert.
  const existingId =
    args.identity.role === "customer" && "customerId" in args.identity
      ? args.identity.customerId ?? null
      : null;

  // 4. Best-effort fields — never block; absent ⇒ NULL. DOB must be YYYY-MM-DD.
  const dobRaw = cleanStr(args.input.date_of_birth, 10);
  const dob = dobRaw && DATE_RE.test(dobRaw) ? dobRaw : null;

  // 5. Atomic upsert (RPC) — generator runs in the same tx as the write.
  const { data, error } = await supabaseAdmin.rpc("aarogya_register_customer", {
    p_existing_id: existingId,
    p_phone: phone,
    p_full_name: nameCheck.name,
    p_address_line: cleanStr(args.input.address_line),
    p_area: cleanStr(args.input.area),
    p_city: cleanStr(args.input.city),
    p_pincode: cleanStr(args.input.pincode, 10),
    p_email: cleanStr(args.input.email),
    p_date_of_birth: dob,
    p_gender: cleanStr(args.input.gender, 20),
  });
  if (error) {
    log.error("registerCustomer rpc failed", error.message);
    return; // soft-fail, silent
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        customer_id: string;
        is_new: boolean;
        customer_code: string | null;
        full_name: string | null;
      }
    | undefined;

  // 6. App-layer trio enforcement: "registered" only once all three are set.
  const registered = !!(row && row.full_name && row.customer_code);

  // 7. Audit — phone-free: customer_id + source + is_new + filled fields.
  const fieldsFilled = BEST_EFFORT_KEYS.filter((k) =>
    k === "date_of_birth" ? dob != null : cleanStr(args.input[k]) != null,
  );
  await writeAudit({
    conversationId: args.conversationId,
    eventType: AuditEvent.CUSTOMER_REGISTERED,
    identity: identityForAudit(args.identity),
    eventData: {
      customer_id: row?.customer_id ?? null,
      source: "aarogya_whatsapp",
      is_new_row: row?.is_new ?? null,
      fields_filled: fieldsFilled,
      registered,
    },
  });
}
