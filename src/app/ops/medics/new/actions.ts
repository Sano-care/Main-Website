"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";

// T65 Phase 2 C3-quick — interim Add-Medic server action.
//
// Founder directive 2026-06-17: Hub Add-Medic UI is the entry point for
// fresh medic data post-Phase-2 deploy. C3-full ships the list + edit +
// 5-tab detail page; C3-quick is just the create form so founder can
// seed UAT today.
//
// Auth: admin only — getCurrentOpsUser() already returns role; this
// action throws on non-admin (agent role can read but not create medics).
//
// Validation:
//   - full_name: 2-80 chars trimmed
//   - phone: E.164 +91 Indian mobile (^\+91[6-9]\d{9}$)
//   - qualification: 'GNM' | 'B.Sc Nursing' (matches medics CHECK)
//   - license_number: optional, trimmed empty → NULL
//   - hire_date: YYYY-MM-DD; defaults to today IST if blank
//   - active: checkbox; defaults true
//
// Dupe check: server-side SELECT WHERE phone = $1 before INSERT.
// Returns ActionResult so the page can render an inline error without
// throwing (form should not lose user input on a dupe-phone).

export type CreateMedicResult =
  | { ok: true }
  | { ok: false; error: string; field?: "full_name" | "phone" | "qualification" | "license_number" | "hire_date" };

const PHONE_RE = /^\+91[6-9]\d{9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUALIFICATIONS = new Set(["GNM", "B.Sc Nursing"]);

function getString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function todayInIST(): string {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export async function createMedicAction(
  _prev: CreateMedicResult | null,
  formData: FormData,
): Promise<CreateMedicResult> {
  const opsUser = await getCurrentOpsUser();
  if (opsUser.role !== "admin") {
    return { ok: false, error: "Admin role required to add medics." };
  }

  const full_name = getString(formData, "full_name");
  if (full_name.length < 2 || full_name.length > 80) {
    return { ok: false, error: "Full name must be 2–80 characters.", field: "full_name" };
  }

  const phone = getString(formData, "phone");
  if (!PHONE_RE.test(phone)) {
    return {
      ok: false,
      error: "Phone must be E.164 Indian mobile (+91XXXXXXXXXX).",
      field: "phone",
    };
  }

  const qualification = getString(formData, "qualification");
  if (!QUALIFICATIONS.has(qualification)) {
    return {
      ok: false,
      error: "Qualification must be GNM or B.Sc Nursing.",
      field: "qualification",
    };
  }

  const licenseRaw = getString(formData, "license_number");
  const license_number = licenseRaw.length > 0 ? licenseRaw : null;

  const hireRaw = getString(formData, "hire_date");
  const hire_date = hireRaw.length > 0 ? hireRaw : todayInIST();
  if (!DATE_RE.test(hire_date)) {
    return { ok: false, error: "Hire date must be YYYY-MM-DD.", field: "hire_date" };
  }

  const active = formData.get("active") === "on";

  const supabase = await createOpsRSCClient();

  // Server-side dupe check (UNIQUE on phone exists at DB level too —
  // belt + braces; the user-facing error is friendlier this way).
  const { data: existing, error: lookupErr } = await supabase
    .from("medics")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (lookupErr) {
    console.error("[ops/medics/new] phone lookup failed", lookupErr);
    return { ok: false, error: "Could not check for duplicate phone. Try again." };
  }
  if (existing) {
    return {
      ok: false,
      error: "This phone is already registered as a medic.",
      field: "phone",
    };
  }

  const { error: insertErr } = await supabase.from("medics").insert({
    full_name,
    phone,
    qualification,
    license_number,
    hire_date,
    active,
  });
  if (insertErr) {
    console.error("[ops/medics/new] insert failed", insertErr);
    return { ok: false, error: `Could not add medic: ${insertErr.message}` };
  }

  // C3-full will ship a list page; for now, bounce ops back to /ops/bookings
  // which is where they'll go to assign this medic to a booking.
  revalidatePath("/ops/bookings");
  redirect("/ops/bookings?medic_added=1");
}
