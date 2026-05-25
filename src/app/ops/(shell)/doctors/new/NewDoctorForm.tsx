"use client";

import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { createDoctor } from "../actions";

type DoctorType = "freelancer" | "salaried";

export function NewDoctorForm() {
  const [doctorType, setDoctorType] = useState<DoctorType>("freelancer");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handle = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await createDoctor(formData);
      } catch (e) {
        // Re-throw Next.js redirect — that's the success path
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Could not create doctor");
      }
    });
  };

  return (
    <form action={handle} className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* ============================== Identity ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Identity
        </legend>
        <Row>
          <Field label="Full name *" name="full_name" required />
          <Field label="Qualification" name="qualification" placeholder="e.g. MBBS, MD" />
        </Row>
        <Row>
          <Field
            label="Medical registration no."
            name="registration_no"
            placeholder="State council reg #"
          />
          <Field
            label="Phone *"
            name="phone"
            type="tel"
            required
            placeholder="10-digit Indian mobile"
          />
        </Row>
        <Field label="Email" name="email" type="email" />
      </fieldset>

      {/* ============================== Duty Room ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Duty Room
        </legend>
        <Field
          label="Duty Room link"
          name="duty_room_join_url"
          type="url"
          placeholder="https://… (optional — provision automatically after create via /ops/doctors/[id])"
        />
        <p className="text-xs text-slate-500">
          Optional at create time — typically left blank, then provisioned
          on Daily via the doctor&apos;s detail page after create. The
          doctor&apos;s /doctor home shows a fallback notice until set.
        </p>
      </fieldset>

      {/* ============================== Pay model ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Pay model
        </legend>

        <div className="flex gap-2 flex-wrap">
          <input type="hidden" name="doctor_type" value={doctorType} />
          <TypeButton
            label="Freelancer"
            sub="% of total collected per booking"
            active={doctorType === "freelancer"}
            onClick={() => setDoctorType("freelancer")}
          />
          <TypeButton
            label="Salaried / retainership"
            sub="Daily wage + per-visit commission"
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
            placeholder="0–100, e.g. 40"
          />
        ) : (
          <div className="space-y-4">
            <Row>
              <Field
                label="Daily wage (₹) *"
                name="daily_wage_rupees"
                type="number"
                required
                placeholder="e.g. 1500"
              />
              <Field
                label="Commission per visit (₹) *"
                name="commission_per_visit_rupees"
                type="number"
                required
                placeholder="e.g. 200"
              />
            </Row>
            <Field
              label="Overtime hourly rate (₹) — optional"
              name="overtime_hourly_rupees"
              type="number"
              placeholder="Leave blank if overtime is entered as a flat amount per occurrence"
            />
          </div>
        )}

        <Field
          label="Pay notes (internal)"
          name="pay_notes"
          multiline
          placeholder="Anything ops needs to remember about this doctor's pay — referral terms, special arrangements, etc."
        />
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
        >
          {isPending ? "Creating…" : "Create doctor"}
        </button>
        <a href="/ops/doctors" className="text-sm text-slate-500 hover:text-slate-900">
          Cancel
        </a>
      </div>
    </form>
  );
}

function TypeButton({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-left px-4 py-3 rounded-lg border transition-colors flex-1 min-w-[200px] " +
        (active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-500")
      }
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className={"text-xs mt-0.5 " + (active ? "text-slate-300" : "text-slate-500")}>
        {sub}
      </div>
    </button>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-4">{children}</div>;
}

function Field({
  label,
  name,
  type = "text",
  required,
  multiline,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
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
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={inputCls}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          step={type === "number" ? "any" : undefined}
          className={inputCls}
        />
      )}
    </label>
  );
}
