"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  X,
  AlertCircle,
  Video,
  Loader2,
  CheckCircle2,
  Upload,
  Trash2,
} from "lucide-react";
import {
  updateDoctor,
  provisionDoctorDutyRoom,
  uploadDoctorSignature,
  clearDoctorSignature,
  getDoctorSignaturePreviewUrl,
  type ProvisionResult,
  type SignatureUploadResult,
} from "../actions";

type Doctor = {
  id: string;
  doctor_code: string;
  full_name: string;
  qualification: string | null;
  registration_no: string | null;
  phone: string | null;
  email: string | null;
  doctor_type: "freelancer" | "salaried";
  revenue_share_pct: number | null;
  daily_wage_paise: number | null;
  commission_per_visit_paise: number | null;
  overtime_hourly_paise: number | null;
  pay_notes: string | null;
  duty_room_join_url: string | null;
  signature_image_url: string | null;
  is_active: boolean;
};

/**
 * Profile card with admin-only inline edit (M2.5 ProfileCard pattern).
 * Non-admins see read-only details; admins see an Edit button that
 * swaps into the form. The server action re-checks is_ops_admin().
 */
export function EditDoctorCard({
  doctor,
  isAdmin,
}: {
  doctor: Doctor;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [doctorType, setDoctorType] = useState(doctor.doctor_type);

  // C2-V: Provision Duty Room on Daily (admin-only). Server action calls
  // Daily REST POST /rooms (idempotent via "already exists" -> GET
  // fallback) and writes the resulting room URL + name onto the doctor
  // row. Result surfaces inline so failures (e.g. DAILY_API_KEY missing)
  // are visible without a redirect.
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);
  const [isProvisioning, startProvisionTransition] = useTransition();

  const handleProvision = () => {
    setProvisionResult(null);
    startProvisionTransition(async () => {
      const fd = new FormData();
      fd.set("id", doctor.id);
      const result = await provisionDoctorDutyRoom(fd);
      setProvisionResult(result);
    });
  };

  const handle = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await updateDoctor(formData);
        setEditing(false);
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Could not save changes");
      }
    });
  };

  if (editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Profile · editing
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
              setDoctorType(doctor.doctor_type);
            }}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
          >
            <X className="w-4 h-4" /> Cancel
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        <form action={handle} className="space-y-4">
          <input type="hidden" name="id" value={doctor.id} />
          <input type="hidden" name="doctor_type" value={doctorType} />

          <Row>
            <Field label="Full name *" name="full_name" required defaultValue={doctor.full_name} />
            <Field label="Qualification" name="qualification" defaultValue={doctor.qualification ?? ""} />
          </Row>
          <Row>
            <Field label="Registration no." name="registration_no" defaultValue={doctor.registration_no ?? ""} />
            <Field
              label="Phone *"
              name="phone"
              type="tel"
              required
              defaultValue={doctor.phone ?? ""}
            />
          </Row>
          <Field label="Email" name="email" type="email" defaultValue={doctor.email ?? ""} />

          {/* C2-Rx: signature management. Sits inside the edit modal so
              admins land here naturally during onboarding. The file
              input is intentionally NOT given a `name` attribute — that
              way, when the surrounding profile form submits, the file
              is NOT sent to updateDoctor (which has no idea what to do
              with it). All signature interactions go through the
              dedicated server actions (uploadDoctorSignature,
              clearDoctorSignature) via type="button" controls, so this
              subsection is structurally decoupled from the form's
              submit / save-changes flow. */}
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
              Doctor signature
            </div>
            <SignatureField doctor={doctor} />
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
              Duty Room
            </div>
            <Field
              label="Duty Room link"
              name="duty_room_join_url"
              type="url"
              defaultValue={doctor.duty_room_join_url ?? ""}
            />
            <p className="text-xs text-slate-500">
              Use &quot;Provision Duty Room&quot; above to create one on Daily.
              You can also paste a URL manually here as a fallback. Leave
              blank until provisioned — their /doctor home shows a notice.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
              Pay model
            </div>
            <div className="flex gap-2 flex-wrap">
              <TypeButton
                label="Freelancer"
                active={doctorType === "freelancer"}
                onClick={() => setDoctorType("freelancer")}
              />
              <TypeButton
                label="Salaried"
                active={doctorType === "salaried"}
                onClick={() => setDoctorType("salaried")}
              />
            </div>
            {doctorType === "freelancer" ? (
              <Field
                label="Revenue share (%)*"
                name="revenue_share_pct"
                type="number"
                required
                defaultValue={String(doctor.revenue_share_pct ?? "")}
              />
            ) : (
              <div className="space-y-3">
                <Row>
                  <Field
                    label="Daily wage (₹) *"
                    name="daily_wage_rupees"
                    type="number"
                    required
                    defaultValue={
                      doctor.daily_wage_paise != null
                        ? String(doctor.daily_wage_paise / 100)
                        : ""
                    }
                  />
                  <Field
                    label="Commission per visit (₹) *"
                    name="commission_per_visit_rupees"
                    type="number"
                    required
                    defaultValue={
                      doctor.commission_per_visit_paise != null
                        ? String(doctor.commission_per_visit_paise / 100)
                        : ""
                    }
                  />
                </Row>
                <Field
                  label="Overtime hourly rate (₹) — optional"
                  name="overtime_hourly_rupees"
                  type="number"
                  defaultValue={
                    doctor.overtime_hourly_paise != null
                      ? String(doctor.overtime_hourly_paise / 100)
                      : ""
                  }
                />
              </div>
            )}
          </div>

          <Field label="Pay notes" name="pay_notes" multiline defaultValue={doctor.pay_notes ?? ""} />

          <label className="flex items-center gap-2 text-sm text-slate-700 pt-2">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={doctor.is_active}
              className="rounded border-slate-300"
            />
            Active
            <span className="text-xs text-slate-500 ml-1">
              (uncheck to soft-delete — keeps ledger history intact)
            </span>
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={isPending}
              className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                setDoctorType(doctor.doctor_type);
              }}
              disabled={isPending}
              className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Read-only view
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Profile
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <DetailRow label="Qualification" value={doctor.qualification} />
        <DetailRow label="Registration no." value={doctor.registration_no} mono />
        <DetailRow label="Phone" value={doctor.phone} mono />
        <DetailRow label="Email" value={doctor.email} />
      </div>

      <div className="mt-5 pt-5 border-t border-slate-100">
        <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
          <div className="text-xs text-slate-500">Duty Room link</div>
          {isAdmin && (
            <button
              type="button"
              onClick={handleProvision}
              disabled={isProvisioning}
              className="inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 px-2.5 py-1 rounded-md transition-colors"
            >
              {isProvisioning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Video className="w-3 h-3" />
              )}
              {isProvisioning ? "Provisioning…" : "Provision Duty Room"}
            </button>
          )}
        </div>
        {doctor.duty_room_join_url ? (
          <a
            href={doctor.duty_room_join_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-900 underline decoration-slate-300 hover:decoration-slate-900 break-all"
          >
            {doctor.duty_room_join_url}
          </a>
        ) : (
          <div className="text-sm text-slate-400">— (not set up yet)</div>
        )}

        {/* Provision result surface (admin-only). Renders ok/error
            states inline so a Daily auth/config issue is visible
            without a page reload. */}
        {provisionResult && (
          <div className="mt-3">
            {provisionResult.ok ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold">
                      Daily Duty Room ready ({provisionResult.room_name}).
                    </div>
                    <div>Reload the page to see the updated link.</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{provisionResult.error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {doctor.pay_notes && (
        <div className="mt-5 pt-5 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-1">Pay notes</div>
          <div className="text-sm text-slate-800 whitespace-pre-wrap">{doctor.pay_notes}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// C2-Rx — Signature management subsection (lives inside the edit form).
//
// Surface contract:
//   - if the doctor has a signature on file: render a thumbnail preview
//     (~80x40, fetched via getDoctorSignaturePreviewUrl which mints a
//     5-min signed URL on the private 'doctor-signatures' bucket), plus
//     a "Clear signature" button that calls clearDoctorSignature
//   - always: a PNG/JPG file picker capped at 200KB (server-side
//     magic-byte check enforces it again), a helper line explaining
//     where the image gets rendered, and an "Upload signature" button
//     that calls uploadDoctorSignature
//   - errors from either action surface inline (matching the
//     ProvisionResult pattern used by the Duty Room provisioner above)
//
// Form-detachment: the file <input> has NO `name` attribute and both
// action buttons are type="button" — so when an admin clicks the
// surrounding "Save changes" submit, the file bytes are NOT sent to
// updateDoctor (which has no idea what to do with a `signature` field).
// All signature traffic stays on the dedicated server actions.
//
// After a successful upload or clear, we router.refresh() the segment
// so the parent server component re-reads doctor.signature_image_url
// and this subsection's useEffect re-fires to re-mint the preview URL.
// ---------------------------------------------------------------------
function SignatureField({ doctor }: { doctor: Doctor }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState<SignatureUploadResult | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const [uploading, startUploadTransition] = useTransition();
  const [clearing, startClearTransition] = useTransition();
  const [pickerEmptyError, setPickerEmptyError] = useState(false);

  // Re-mint the preview signed URL whenever the saved storage path
  // changes (on upload success router.refresh updates the prop).
  useEffect(() => {
    let cancelled = false;
    if (!doctor.signature_image_url) {
      setPreviewUrl(null);
      return;
    }
    setPreviewLoading(true);
    getDoctorSignaturePreviewUrl(doctor.signature_image_url)
      .then((url) => {
        if (!cancelled) {
          setPreviewUrl(url);
          setPreviewLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewUrl(null);
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doctor.signature_image_url]);

  const hasSig = doctor.signature_image_url != null;

  const handleUpload = () => {
    setUploadResult(null);
    setPickerEmptyError(false);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setPickerEmptyError(true);
      return;
    }
    startUploadTransition(async () => {
      const fd = new FormData();
      fd.set("id", doctor.id);
      fd.set("signature", file);
      const r = await uploadDoctorSignature(fd);
      setUploadResult(r);
      if (r.ok) {
        if (inputRef.current) inputRef.current.value = "";
        // Re-fetch the doctor row so the preview re-mints with the new
        // storage path. revalidatePath inside the action already
        // invalidated the segment cache — router.refresh pulls fresh.
        router.refresh();
      }
    });
  };

  const handleClear = () => {
    setClearError(null);
    setUploadResult(null);
    startClearTransition(async () => {
      const fd = new FormData();
      fd.set("id", doctor.id);
      try {
        await clearDoctorSignature(fd);
        router.refresh();
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setClearError(
          e instanceof Error ? e.message : "Could not clear signature.",
        );
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* Preview row — only renders when a signature is on file. The
          signed URL is short-lived (5 min) but adequate for the duration
          of the edit-modal session; if it expires while the modal is
          open, the next render mints a fresh one. */}
      {hasSig && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-12 w-24 rounded border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
            {previewLoading ? (
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            ) : previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Doctor signature preview"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="text-[10px] text-slate-400">preview failed</div>
            )}
          </div>
          <div className="text-xs text-slate-500 font-mono break-all flex-1 min-w-[140px]">
            {doctor.signature_image_url}
          </div>
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing || uploading}
            className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 px-3 py-1.5 rounded-md border border-rose-200"
          >
            {clearing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Trash2 className="w-3 h-3" />
            )}
            {clearing ? "Clearing…" : "Clear signature"}
          </button>
        </div>
      )}

      {/* File picker. The input has NO `name` attribute so the parent
          form's FormData never includes it on submit. */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="block text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:text-slate-700 file:text-xs file:font-semibold hover:file:bg-slate-100 file:cursor-pointer"
          onChange={() => {
            setPickerEmptyError(false);
            setUploadResult(null);
          }}
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || clearing}
          className="inline-flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-md"
        >
          {uploading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Upload className="w-3 h-3" />
          )}
          {uploading ? "Uploading…" : hasSig ? "Replace signature" : "Upload signature"}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        PNG or JPG, max 500 KB. Embedded at the bottom of every
        prescription this doctor sends.
      </p>

      {!hasSig && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          Not uploaded yet — this doctor cannot issue prescriptions until
          a signature is on file (sendPrescription refuses).
        </p>
      )}

      {pickerEmptyError && (
        <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Pick a PNG or JPG file first, then click Upload.</span>
        </div>
      )}

      {uploadResult?.ok && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-2 flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Signature uploaded.</span>
        </div>
      )}
      {uploadResult && !uploadResult.ok && (
        <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs p-2 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{uploadResult.error}</span>
        </div>
      )}
      {clearError && (
        <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs p-2 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{clearError}</span>
        </div>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-4">{children}</div>;
}

function TypeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-sm font-medium px-4 py-2 rounded-lg transition-colors " +
        (active
          ? "bg-slate-900 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200")
      }
    >
      {label}
    </button>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  multiline,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  defaultValue?: string;
}) {
  const id = `f-${name}`;
  const inputCls =
    "w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent";
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          rows={3}
          required={required}
          defaultValue={defaultValue ?? ""}
          className={inputCls}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          defaultValue={defaultValue ?? ""}
          step={type === "number" ? "any" : undefined}
          className={inputCls}
        />
      )}
    </label>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={"text-slate-900 " + (mono ? "font-mono text-sm" : "")}>
        {value ?? "—"}
      </div>
    </div>
  );
}
