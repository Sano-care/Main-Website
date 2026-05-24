"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { normaliseIndianPhone } from "@/lib/phone";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import {
  getZoomUser,
  getZoomUserSettings,
  isZoomNotFound,
} from "@/lib/zoom/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DoctorType = "freelancer" | "salaried";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}
function reqStr(formData: FormData, key: string): string {
  const v = str(formData, key);
  if (!v) throw new Error(`${key} is required`);
  return v;
}
function paiseFromRupeeField(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${key} must be a non-negative number (rupees)`);
  }
  return Math.round(n * 100);
}
function reqPaiseFromRupeeField(formData: FormData, key: string): number {
  const v = paiseFromRupeeField(formData, key);
  if (v == null) throw new Error(`${key} is required`);
  return v;
}
function pctOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`${key} must be between 0 and 100`);
  }
  return n;
}

/**
 * Re-verify ops admin role server-side, never trusting the client. The
 * same pattern M3 used for refund actions — getCurrentOpsUser() asserts
 * the user is an ops user, then we call public.is_ops_admin() via RPC
 * (which evaluates against auth.uid()) and only proceed if it returns
 * true.
 */
async function assertOpsAdmin(): Promise<{ opsUserId: string }> {
  const opsUser = await getCurrentOpsUser();
  const supabase = await createOpsRSCClient();
  const { data, error } = await supabase.rpc("is_ops_admin");
  if (error) {
    throw new Error(`Could not verify admin role: ${error.message}`);
  }
  if (data !== true) {
    throw new Error("This action is restricted to ops admins.");
  }
  return { opsUserId: opsUser.id };
}

/**
 * Phone normalisation that tolerates an empty field but rejects a present-
 * but-invalid one. Same posture as the M2.5 customer paths.
 */
function canonicalPhoneOrNull(formData: FormData, key: string): string | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const e164 = normaliseIndianPhone(raw);
  if (!e164) {
    throw new Error(
      `Phone "${raw}" doesn't look like a valid Indian mobile (10 digits starting 6-9; +91 / 0 / no-prefix all accepted).`,
    );
  }
  return e164;
}

/**
 * C1: phone is now REQUIRED on doctor create / update because it's the
 * doctor's /doctor login key (one row per phone, doctors_phone_unique
 * from migration 020). Existing rows that pre-date C1 may have NULL
 * phones in the DB — the form preloads them empty and the admin must
 * fill one in before saving.
 */
function reqCanonicalPhone(formData: FormData, key: string): string {
  const v = canonicalPhoneOrNull(formData, key);
  if (!v) {
    throw new Error(
      "Phone is required — doctors sign in to /doctor with their phone, so we need a valid one on file.",
    );
  }
  return v;
}

/**
 * C1: the doctor's Zoom Duty Room join URL. Optional (NULL = "not set up
 * yet"; the /doctor home shows a graceful fallback). When provided, must
 * start with http:// or https:// — anything else is almost certainly a
 * typo (Zoom links are always https). No deeper Zoom-shape check in C1;
 * C2 will validate against the actual Zoom REST API when the meeting
 * integration lands.
 */
function dutyRoomUrlOrNull(formData: FormData, key: string): string | null {
  const raw = str(formData, key);
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(
      "Duty Room link should start with https:// (paste the full Zoom Personal Meeting Room URL).",
    );
  }
  return raw;
}

// =====================================================================
// createDoctor — admin only
// =====================================================================
export async function createDoctor(formData: FormData) {
  const { opsUserId } = await assertOpsAdmin();
  const supabase = await createOpsRSCClient();

  const full_name = reqStr(formData, "full_name");
  const doctor_type = reqStr(formData, "doctor_type") as DoctorType;
  if (doctor_type !== "freelancer" && doctor_type !== "salaried") {
    throw new Error("Invalid doctor type.");
  }

  // Type-conditional pay fields. The DB CHECK constraint duplicates this
  // logic; we validate here too so the user sees an inline error instead
  // of a Postgres constraint-violation surface.
  let revenue_share_pct: number | null = null;
  let daily_wage_paise: number | null = null;
  let commission_per_visit_paise: number | null = null;
  let overtime_hourly_paise: number | null = null;

  if (doctor_type === "freelancer") {
    revenue_share_pct = pctOrNull(formData, "revenue_share_pct");
    if (revenue_share_pct == null) {
      throw new Error("Revenue share % is required for freelancer doctors.");
    }
  } else {
    daily_wage_paise = reqPaiseFromRupeeField(formData, "daily_wage_rupees");
    commission_per_visit_paise = reqPaiseFromRupeeField(
      formData,
      "commission_per_visit_rupees",
    );
    overtime_hourly_paise = paiseFromRupeeField(
      formData,
      "overtime_hourly_rupees",
    );
  }

  // Allocate the doctor code via the existing atomic counter.
  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_type: "doctor",
  });
  if (codeErr || !code) {
    throw new Error(`Could not allocate doctor code: ${codeErr?.message ?? "unknown"}`);
  }

  const { data: inserted, error } = await supabase
    .from("doctors")
    .insert({
      doctor_code: code,
      full_name,
      qualification: str(formData, "qualification"),
      registration_no: str(formData, "registration_no"),
      phone: reqCanonicalPhone(formData, "phone"),
      email: str(formData, "email"),
      doctor_type,
      revenue_share_pct,
      daily_wage_paise,
      commission_per_visit_paise,
      overtime_hourly_paise,
      pay_notes: str(formData, "pay_notes"),
      duty_room_join_url: dutyRoomUrlOrNull(formData, "duty_room_join_url"),
      created_by: opsUserId,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    throw new Error(`Could not create doctor: ${error?.message ?? "unknown"}`);
  }

  revalidatePath("/ops/doctors");
  redirect(`/ops/doctors/${inserted.id}`);
}

// =====================================================================
// updateDoctor — admin only
// =====================================================================
export async function updateDoctor(formData: FormData) {
  await assertOpsAdmin();
  const supabase = await createOpsRSCClient();

  const id = reqStr(formData, "id");
  if (!UUID_RE.test(id)) throw new Error("Invalid doctor id.");

  const full_name = reqStr(formData, "full_name");
  const doctor_type = reqStr(formData, "doctor_type") as DoctorType;
  if (doctor_type !== "freelancer" && doctor_type !== "salaried") {
    throw new Error("Invalid doctor type.");
  }

  // Same type-conditional payload as createDoctor — the doctor's type
  // can flip via edit, so we re-derive every pay field from the form,
  // explicitly nulling the irrelevant ones for the new type. The DB
  // CHECK enforces consistency too.
  let revenue_share_pct: number | null = null;
  let daily_wage_paise: number | null = null;
  let commission_per_visit_paise: number | null = null;
  let overtime_hourly_paise: number | null = null;

  if (doctor_type === "freelancer") {
    revenue_share_pct = pctOrNull(formData, "revenue_share_pct");
    if (revenue_share_pct == null) {
      throw new Error("Revenue share % is required for freelancer doctors.");
    }
  } else {
    daily_wage_paise = reqPaiseFromRupeeField(formData, "daily_wage_rupees");
    commission_per_visit_paise = reqPaiseFromRupeeField(
      formData,
      "commission_per_visit_rupees",
    );
    overtime_hourly_paise = paiseFromRupeeField(
      formData,
      "overtime_hourly_rupees",
    );
  }

  const is_active = formData.get("is_active") === "on";

  const { error } = await supabase
    .from("doctors")
    .update({
      full_name,
      qualification: str(formData, "qualification"),
      registration_no: str(formData, "registration_no"),
      phone: reqCanonicalPhone(formData, "phone"),
      email: str(formData, "email"),
      doctor_type,
      revenue_share_pct,
      daily_wage_paise,
      commission_per_visit_paise,
      overtime_hourly_paise,
      pay_notes: str(formData, "pay_notes"),
      duty_room_join_url: dutyRoomUrlOrNull(formData, "duty_room_join_url"),
      is_active,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Could not update doctor: ${error.message}`);
  }

  revalidatePath("/ops/doctors");
  revalidatePath(`/ops/doctors/${id}`);
}

// =====================================================================
// autoFillDutyRoomFromZoom — admin only (C2)
//
// Looks up the doctor's licensed Zoom user by email (GET /users/{email}
// — Server-to-Server OAuth accepts email as the userId path param) and
// copies the user's personal_meeting_url into doctors.duty_room_join_url,
// plus the Zoom user id into doctors.zoom_user_id.
//
// Returns a structured result instead of throwing so the form can show
// partial-success states (e.g. PMI saved but waiting room is OFF in
// Zoom — that's an NMC compliance flag, not a hard failure).
//
// Pre-conditions enforced here:
//   - The action user is an ops admin (assertOpsAdmin)
//   - The doctor exists and is active
//   - The doctor has an email on file (it's the Zoom lookup key)
//   - The Zoom user exists with that email
//   - The Zoom user is licensed (type >= 2) — Basic users have no PMI
//     and cannot host a meeting
// =====================================================================
export type AutoFillResult =
  | { ok: true; pmi: string; zoom_user_id: string; warnings: string[] }
  | { ok: false; error: string };

export async function autoFillDutyRoomFromZoom(
  formData: FormData,
): Promise<AutoFillResult> {
  try {
    await assertOpsAdmin();
    const supabase = await createOpsRSCClient();

    const id = reqStr(formData, "id");
    if (!UUID_RE.test(id)) {
      return { ok: false, error: "Invalid doctor id." };
    }

    type DocRow = {
      id: string;
      full_name: string;
      email: string | null;
      is_active: boolean;
    };
    const { data: docRow } = await supabase
      .from("doctors")
      .select("id, full_name, email, is_active")
      .eq("id", id)
      .maybeSingle();
    const doctor = (docRow as DocRow | null) ?? null;
    if (!doctor) return { ok: false, error: "Doctor not found." };
    if (!doctor.is_active) {
      return {
        ok: false,
        error: "Doctor is inactive — re-activate before linking Zoom.",
      };
    }
    if (!doctor.email) {
      return {
        ok: false,
        error:
          "Doctor has no email on file. The Zoom auto-fill keys on doctors.email matching the licensed Zoom user's email — set an email first.",
      };
    }

    // Look up the Zoom user. GET /users/{userId} accepts an email
    // address as the userId path param for S2S OAuth (operational
    // note documented on migration 021).
    let zoomUser;
    try {
      zoomUser = await getZoomUser(doctor.email);
    } catch (err) {
      if (isZoomNotFound(err)) {
        return {
          ok: false,
          error: `Zoom has no user with email ${doctor.email}. Confirm the doctor's email matches their licensed Sanocare Zoom user, or provision them in Zoom first.`,
        };
      }
      console.error("[autoFillDutyRoomFromZoom] getZoomUser failed:", err);
      return {
        ok: false,
        error: `Zoom lookup failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }

    if (zoomUser.type < 2) {
      return {
        ok: false,
        error: `Zoom user ${zoomUser.email} is a Basic account (type=${zoomUser.type}). A Pro/Business licence is required so the user has a Personal Meeting Room.`,
      };
    }

    // Best-effort waiting-room check. Non-fatal — if the settings call
    // fails we still save the PMI URL and surface a soft warning.
    const warnings: string[] = [];
    try {
      const settings = await getZoomUserSettings(doctor.email);
      if (settings.in_meeting?.waiting_room !== true) {
        warnings.push(
          "Waiting Room is OFF on this user's PMI in Zoom. NMC requires doctor-controlled entry — turn it on in the Zoom admin console before any consult.",
        );
      }
    } catch (err) {
      console.warn(
        "[autoFillDutyRoomFromZoom] getZoomUserSettings failed (non-fatal):",
        err,
      );
      warnings.push(
        "Couldn't read this user's Zoom settings to verify Waiting Room is on. Verify manually in the Zoom admin console.",
      );
    }

    const { error: updateErr } = await supabase
      .from("doctors")
      .update({
        duty_room_join_url: zoomUser.personal_meeting_url,
        zoom_user_id: zoomUser.id,
      })
      .eq("id", doctor.id);
    if (updateErr) {
      return {
        ok: false,
        error: `Could not save Zoom details: ${updateErr.message}`,
      };
    }

    revalidatePath("/ops/doctors");
    revalidatePath(`/ops/doctors/${doctor.id}`);

    return {
      ok: true,
      pmi: String(zoomUser.pmi),
      zoom_user_id: zoomUser.id,
      warnings,
    };
  } catch (err) {
    // Next.js redirects are thrown — re-throw so the framework handles.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not link Zoom.",
    };
  }
}

// =====================================================================
// markAttendance — admin only
//   - Salaried doctors only (enforced via the trigger: non-salaried
//     attendance rows post no daily_wage entry).
//   - INSERT a row for (doctor_id, work_date); if one exists, UPDATE it
//     (flipping is_present back to true and re-setting overtime). The
//     UNIQUE constraint forces this UPSERT pattern.
// =====================================================================
export async function markAttendance(formData: FormData) {
  await assertOpsAdmin();
  const supabase = await createOpsRSCClient();

  const doctor_id = reqStr(formData, "doctor_id");
  if (!UUID_RE.test(doctor_id)) throw new Error("Invalid doctor id.");

  const work_date = reqStr(formData, "work_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
    throw new Error("Work date must be YYYY-MM-DD.");
  }

  // Overtime: hours optional. Amount optional too — if a doctor has an
  // overtime_hourly_paise rate set and ops only gives hours, we compute
  // amount = hours × rate. Otherwise ops can type a flat amount.
  const overtime_hours_raw = str(formData, "overtime_hours");
  const overtime_amount_raw = str(formData, "overtime_amount_rupees");

  let overtime_hours: number | null = null;
  if (overtime_hours_raw) {
    const n = Number(overtime_hours_raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("Overtime hours must be a non-negative number.");
    }
    overtime_hours = n;
  }

  let overtime_amount_paise: number | null = null;
  if (overtime_amount_raw) {
    const n = Number(overtime_amount_raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("Overtime amount must be a non-negative number (rupees).");
    }
    overtime_amount_paise = Math.round(n * 100);
  } else if (overtime_hours != null) {
    // No flat amount supplied — try to compute from the doctor's rate.
    const { data: doc } = await supabase
      .from("doctors")
      .select("overtime_hourly_paise")
      .eq("id", doctor_id)
      .maybeSingle();
    if (doc?.overtime_hourly_paise) {
      overtime_amount_paise = Math.round(overtime_hours * doc.overtime_hourly_paise);
    }
  }

  // UPSERT on the unique (doctor_id, work_date). is_present is always
  // forced to true here — undoing the mark uses undoAttendance() below.
  const { error } = await supabase
    .from("doctor_attendance")
    .upsert(
      {
        doctor_id,
        work_date,
        is_present: true,
        overtime_hours,
        overtime_amount_paise,
        note: str(formData, "note"),
        // created_by is set on INSERT; left unchanged on UPDATE (Supabase
        // upsert with onConflict re-sends all columns, so this overwrites
        // — fine, the most-recent admin who touched the row is recorded).
        created_by: (await getCurrentOpsUser()).id,
      },
      { onConflict: "doctor_id,work_date" },
    );
  if (error) {
    throw new Error(`Could not mark attendance: ${error.message}`);
  }

  revalidatePath(`/ops/doctors/${doctor_id}`);
}

// =====================================================================
// undoAttendance — admin only
//   Flip is_present → false. The trigger reverses any live daily_wage /
//   overtime entries for the row. Never DELETEs (append-only model).
// =====================================================================
export async function undoAttendance(formData: FormData) {
  await assertOpsAdmin();
  const supabase = await createOpsRSCClient();

  const attendance_id = reqStr(formData, "attendance_id");
  if (!UUID_RE.test(attendance_id)) throw new Error("Invalid attendance id.");

  const { data: row, error: readErr } = await supabase
    .from("doctor_attendance")
    .select("doctor_id")
    .eq("id", attendance_id)
    .maybeSingle();
  if (readErr || !row) {
    throw new Error("Attendance row not found.");
  }

  const { error } = await supabase
    .from("doctor_attendance")
    .update({ is_present: false, overtime_amount_paise: null, overtime_hours: null })
    .eq("id", attendance_id);
  if (error) {
    throw new Error(`Could not undo attendance: ${error.message}`);
  }

  revalidatePath(`/ops/doctors/${row.doctor_id}`);
}

// =====================================================================
// recordPayout — admin only
//   Inserts a NEGATIVE payout entry directly into the ledger (RLS INSERT
//   policy for is_ops_admin allows this from the authenticated session).
// =====================================================================
export async function recordPayout(formData: FormData) {
  const { opsUserId } = await assertOpsAdmin();
  const supabase = await createOpsRSCClient();

  const doctor_id = reqStr(formData, "doctor_id");
  if (!UUID_RE.test(doctor_id)) throw new Error("Invalid doctor id.");

  const amount_rupees = Number(reqStr(formData, "amount_rupees"));
  if (!Number.isFinite(amount_rupees) || amount_rupees <= 0) {
    throw new Error("Payout amount must be a positive number (rupees).");
  }
  const entry_date = reqStr(formData, "entry_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
    throw new Error("Date must be YYYY-MM-DD.");
  }
  const note = str(formData, "note");

  const { error } = await supabase.from("doctor_ledger_entries").insert({
    doctor_id,
    entry_type: "payout",
    // Payouts are STORED NEGATIVE — they reduce the doctor's balance.
    amount_paise: -Math.round(amount_rupees * 100),
    entry_date,
    description: note ?? `Payout of ₹${amount_rupees.toLocaleString("en-IN")}`,
    created_by: opsUserId,
  });
  if (error) {
    throw new Error(`Could not record payout: ${error.message}`);
  }

  revalidatePath(`/ops/doctors/${doctor_id}`);
}

// =====================================================================
// postAdjustment — admin only
//   Inserts a SIGNED adjustment entry. Positive = credit the doctor;
//   negative = debit. Covers revenue-share recompute corrections, typo
//   fixes, etc.
// =====================================================================
export async function postAdjustment(formData: FormData) {
  const { opsUserId } = await assertOpsAdmin();
  const supabase = await createOpsRSCClient();

  const doctor_id = reqStr(formData, "doctor_id");
  if (!UUID_RE.test(doctor_id)) throw new Error("Invalid doctor id.");

  const amount_rupees = Number(reqStr(formData, "amount_rupees"));
  if (!Number.isFinite(amount_rupees) || amount_rupees === 0) {
    throw new Error("Adjustment amount must be a non-zero number (rupees). Use a minus sign to debit.");
  }
  const entry_date = reqStr(formData, "entry_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
    throw new Error("Date must be YYYY-MM-DD.");
  }
  const note = reqStr(formData, "note"); // adjustments always need a note

  const { error } = await supabase.from("doctor_ledger_entries").insert({
    doctor_id,
    entry_type: "adjustment",
    amount_paise: Math.round(amount_rupees * 100),
    entry_date,
    description: note,
    created_by: opsUserId,
  });
  if (error) {
    throw new Error(`Could not post adjustment: ${error.message}`);
  }

  revalidatePath(`/ops/doctors/${doctor_id}`);
}
