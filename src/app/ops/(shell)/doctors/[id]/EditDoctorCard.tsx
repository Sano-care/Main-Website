"use client";

import { useRef, useState, useTransition } from "react";
import {
  Pencil,
  X,
  AlertCircle,
  Video,
  Loader2,
  CheckCircle2,
  PenLine,
  Upload,
  Trash2,
} from "lucide-react";
import {
  updateDoctor,
  provisionDoctorDutyRoom,
  uploadDoctorSignature,
  clearDoctorSignature,
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

      {/* C2-Rx: signature on file. Required to issue prescriptions
          (sendPrescription refuses if signature_image_url is NULL). The
          file lives in the private 'doctor-signatures' bucket; the
          column stores the storage PATH (not a URL). */}
      <SignatureSection doctor={doctor} isAdmin={isAdmin} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Signature upload/clear UI
// ---------------------------------------------------------------------
function SignatureSection({
  doctor,
  isAdmin,
}: {
  doctor: Doctor;
  isAdmin: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploadResult, setUploadResult] = useState<SignatureUploadResult | null>(null);
  const [uploading, startUploadTransition] = useTransition();
  const [clearing, startClearTransition] = useTransition();
  const [clearError, setClearError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadResult(null);
    startUploadTransition(async () => {
      const fd = new FormData();
      fd.set("id", doctor.id);
      fd.set("signature", file);
      const r = await uploadDoctorSignature(fd);
      setUploadResult(r);
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  const handleClear = () => {
    setClearError(null);
    startClearTransition(async () => {
      const fd = new FormData();
      fd.set("id", doctor.id);
      try {
        await clearDoctorSignature(fd);
        setUploadResult(null);
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setClearError(
          e instanceof Error ? e.message : "Could not clear signature.",
        );
      }
    });
  };

  const hasSig = doctor.signature_image_url != null;

  return (
    <div className="mt-5 pt-5 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="text-xs text-slate-500">Signature on file</div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFileChange}
              className="hidden"
              id={`sig-input-${doctor.id}`}
            />
            <label
              htmlFor={`sig-input-${doctor.id}`}
              className={
                "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md cursor-pointer " +
                (uploading
                  ? "bg-slate-100 text-slate-400"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200")
              }
            >
              {uploading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              {uploading ? "Uploading…" : hasSig ? "Replace" : "Upload"}
            </label>
            {hasSig && (
              <button
                type="button"
                onClick={handleClear}
                disabled={clearing}
                className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-800 px-2 py-1 disabled:opacity-50"
              >
                {clearing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {hasSig ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <PenLine className="w-4 h-4" />
          <span>
            On file ·{" "}
            <span className="font-mono text-xs text-slate-500">
              {doctor.signature_image_url}
            </span>
          </span>
        </div>
      ) : (
        <div className="text-sm text-slate-400">
          — not uploaded yet. Doctor cannot issue prescriptions until a
          PNG/JPG signature is on file.
        </div>
      )}

      {uploadResult && (
        <div className="mt-2">
          {uploadResult.ok ? (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-2 flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Signature uploaded. Reload to confirm.</span>
            </div>
          ) : (
            <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs p-2 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{uploadResult.error}</span>
            </div>
          )}
        </div>
      )}
      {clearError && (
        <div className="mt-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs p-2 flex items-start gap-2">
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
