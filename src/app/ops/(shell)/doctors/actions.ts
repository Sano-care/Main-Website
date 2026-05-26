"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normaliseIndianPhone } from "@/lib/phone";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import { provisionDutyRoom } from "@/lib/daily/client";
import { DailyApiError, DailyAuthError } from "@/lib/daily/auth";

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
 * The doctor's Duty Room join URL — transport-neutral, typically
 * provisioned by provisionDoctorDutyRoom() on Daily.co but also
 * accepts a manual paste fallback. Optional (NULL = "not set up
 * yet"; /doctor shows a graceful notice). When provided, must start
 * with http:// or https:// — anything else is a typo.
 */
function dutyRoomUrlOrNull(formData: FormData, key: string): string | null {
  const raw = str(formData, key);
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(
      "Duty Room link should start with https:// (paste the full video-room URL).",
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
// provisionDoctorDutyRoom — admin only (C2-V)
//
// Creates the doctor's Daily.co Duty Room (POST /v1/rooms) and writes
// the resulting room URL + name onto the doctor row. Replaces C2's
// C2's autoFillDutyRoomFromZoom — same intent (one-click setup of a
// doctor's video room), different transport.
//
// Idempotent on the Daily side via provisionDutyRoom() — re-clicking
// the button after a successful create returns the existing room.
//
// Room name convention: `${doctor_code}-duty-room`, lowercased. Stable
// per-doctor; survives any later rename of the doctor's full_name.
//
// Returns a structured result instead of throwing so the form can show
// success ("room ready") or error ("Daily API key not set" / "Daily
// returned 5xx") inline.
//
// Pre-conditions enforced here:
//   - The action user is an ops admin (assertOpsAdmin)
//   - The doctor exists and is active
// =====================================================================
export type ProvisionResult =
  | { ok: true; room_name: string; room_url: string }
  | { ok: false; error: string };

export async function provisionDoctorDutyRoom(
  formData: FormData,
): Promise<ProvisionResult> {
  try {
    await assertOpsAdmin();
    const supabase = await createOpsRSCClient();

    const id = reqStr(formData, "id");
    if (!UUID_RE.test(id)) {
      return { ok: false, error: "Invalid doctor id." };
    }

    type DocRow = {
      id: string;
      doctor_code: string;
      full_name: string;
      is_active: boolean;
    };
    const { data: docRow } = await supabase
      .from("doctors")
      .select("id, doctor_code, full_name, is_active")
      .eq("id", id)
      .maybeSingle();
    const doctor = (docRow as DocRow | null) ?? null;
    if (!doctor) return { ok: false, error: "Doctor not found." };
    if (!doctor.is_active) {
      return {
        ok: false,
        error: "Doctor is inactive — re-activate before provisioning a Duty Room.",
      };
    }

    // Stable, predictable room name per doctor. doctor_code is unique
    // and immutable for the lifetime of the row (M019 / M020), so the
    // room name is stable too. Lowercased because Daily room names are
    // case-sensitive and lowercase is the convention.
    const roomName = `${doctor.doctor_code.toLowerCase()}-duty-room`;

    let room;
    try {
      room = await provisionDutyRoom({ name: roomName });
    } catch (err) {
      if (err instanceof DailyAuthError) {
        console.error("[provisionDoctorDutyRoom] Daily auth/env missing:", err);
        return {
          ok: false,
          error:
            "Daily.co is not configured — DAILY_API_KEY and/or DAILY_DOMAIN aren't set on Netlify. Contact the founder (task #98).",
        };
      }
      if (err instanceof DailyApiError) {
        console.error("[provisionDoctorDutyRoom] Daily API error:", err);
        return {
          ok: false,
          error: `Daily.co returned an error (HTTP ${err.status}): ${err.message}. Check the dashboard or try again.`,
        };
      }
      console.error("[provisionDoctorDutyRoom] unexpected error:", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Could not provision Duty Room.",
      };
    }

    const { error: updateErr } = await supabase
      .from("doctors")
      .update({
        duty_room_join_url: room.url,
        duty_room_provider_ref: room.name,
      })
      .eq("id", doctor.id);
    if (updateErr) {
      return {
        ok: false,
        error: `Could not save Duty Room details: ${updateErr.message}`,
      };
    }

    revalidatePath("/ops/doctors");
    revalidatePath(`/ops/doctors/${doctor.id}`);

    return {
      ok: true,
      room_name: room.name,
      room_url: room.url,
    };
  } catch (err) {
    // Next.js redirects are thrown — re-throw so the framework handles.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not provision Duty Room.",
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

// =====================================================================
// uploadDoctorSignature — admin only (C2-Rx)
//
// Uploads a signature image to the private 'doctor-signatures' bucket
// and writes the storage PATH (not URL) onto doctors.signature_image_url.
// The Rx PDF renderer downloads the bytes via the service role and
// embeds them as a data URL.
//
// Format: PNG or JPG, max 200KB. We re-check the magic bytes server-
// side because content-type from the browser is trivially spoofable.
// Path convention: `${doctor_id}/sig.<ext>` — stable per-doctor; upsert
// overwrites any prior signature for that doctor.
//
// Returns a structured result so the EditDoctorCard can show success
// or error inline (same pattern as ProvisionResult).
// =====================================================================
export type SignatureUploadResult =
  | { ok: true; storage_path: string }
  | { ok: false; error: string };

const SIGNATURE_BUCKET = "doctor-signatures";
const SIGNATURE_MAX_BYTES = 200 * 1024; // 200KB hard cap

function detectImageExt(magic: Uint8Array): "png" | "jpg" | null {
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    magic.length >= 8 &&
    magic[0] === 0x89 &&
    magic[1] === 0x50 &&
    magic[2] === 0x4e &&
    magic[3] === 0x47 &&
    magic[4] === 0x0d &&
    magic[5] === 0x0a &&
    magic[6] === 0x1a &&
    magic[7] === 0x0a
  ) {
    return "png";
  }
  // JPEG magic: FF D8 FF
  if (
    magic.length >= 3 &&
    magic[0] === 0xff &&
    magic[1] === 0xd8 &&
    magic[2] === 0xff
  ) {
    return "jpg";
  }
  return null;
}

export async function uploadDoctorSignature(
  formData: FormData,
): Promise<SignatureUploadResult> {
  try {
    await assertOpsAdmin();

    const id = reqStr(formData, "id");
    if (!UUID_RE.test(id)) {
      return { ok: false, error: "Invalid doctor id." };
    }

    const file = formData.get("signature");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "No signature file provided." };
    }
    if (file.size > SIGNATURE_MAX_BYTES) {
      return {
        ok: false,
        error: `Signature too large: ${Math.round(file.size / 1024)} KB (cap ${SIGNATURE_MAX_BYTES / 1024} KB).`,
      };
    }

    const buf = new Uint8Array(await file.arrayBuffer());
    const ext = detectImageExt(buf);
    if (!ext) {
      return {
        ok: false,
        error:
          "Could not recognise the signature as PNG or JPG. Re-export it from the source and try again.",
      };
    }

    const storagePath = `${id}/sig.${ext}`;
    const contentType = ext === "png" ? "image/png" : "image/jpeg";

    // upsert overwrites the previous signature in place. No need to
    // garbage-collect older paths because we always write the same
    // file name per doctor (./sig.png OR ./sig.jpg). If a doctor flips
    // ext (png→jpg), the prior path stays orphaned — that's acceptable
    // (~200KB per doctor at worst); we don't bother cleaning up.
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(SIGNATURE_BUCKET)
      .upload(storagePath, buf, { contentType, upsert: true });
    if (uploadErr) {
      return {
        ok: false,
        error: `Could not upload signature: ${uploadErr.message}`,
      };
    }

    // Save the storage path (NOT a URL — the Rx renderer resolves it
    // server-side every send).
    const supabase = await createOpsRSCClient();
    const { error: updateErr } = await supabase
      .from("doctors")
      .update({ signature_image_url: storagePath })
      .eq("id", id);
    if (updateErr) {
      return {
        ok: false,
        error: `Could not save signature path: ${updateErr.message}`,
      };
    }

    revalidatePath("/ops/doctors");
    revalidatePath(`/ops/doctors/${id}`);
    return { ok: true, storage_path: storagePath };
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not upload signature.",
    };
  }
}

/**
 * Clear a doctor's signature (the doctor's NEXT send will fail with the
 * "no signature on file" message until ops re-uploads). Leaves the
 * underlying object in storage — only the pointer is nulled.
 */
export async function clearDoctorSignature(formData: FormData): Promise<void> {
  await assertOpsAdmin();
  const id = reqStr(formData, "id");
  if (!UUID_RE.test(id)) throw new Error("Invalid doctor id.");

  const supabase = await createOpsRSCClient();
  const { error } = await supabase
    .from("doctors")
    .update({ signature_image_url: null })
    .eq("id", id);
  if (error) {
    throw new Error(`Could not clear signature: ${error.message}`);
  }
  revalidatePath("/ops/doctors");
  revalidatePath(`/ops/doctors/${id}`);
}

/**
 * Mint a short-lived signed URL on the doctor's signature in the
 * private bucket so ops can preview it in the EditDoctorCard. We do
 * NOT expose this URL outside the ops surface — it leaks only when an
 * ops admin is already logged in.
 */
export async function getDoctorSignaturePreviewUrl(
  storagePath: string,
): Promise<string | null> {
  await assertOpsAdmin();
  const { data, error } = await supabaseAdmin.storage
    .from(SIGNATURE_BUCKET)
    .createSignedUrl(storagePath, 60 * 5); // 5 minutes
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
