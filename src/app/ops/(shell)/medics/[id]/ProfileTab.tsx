"use client";

import { useActionState } from "react";
import {
  updateMedicAction,
  type UpdateMedicResult,
} from "./actions";
import { DeactivateButton } from "./DeactivateButton";

type MedicForForm = {
  id: string;
  full_name: string;
  phone: string;
  qualification: "GNM" | "B.Sc Nursing";
  license_number: string | null;
  hire_date: string | null;
  active: boolean;
};

interface ProfileTabProps {
  medic: MedicForForm;
  isAdmin: boolean;
}

export function ProfileTab({ medic, isAdmin }: ProfileTabProps) {
  const [state, formAction, pending] = useActionState<
    UpdateMedicResult | null,
    FormData
  >(updateMedicAction, null);

  const errFor = (field: string) =>
    state && !state.ok && state.field === field ? state.error : null;
  const globalErr = state && !state.ok && !state.field ? state.error : null;
  const successJustNow = state && state.ok;

  if (!isAdmin) {
    // Agent — read-only profile card.
    return (
      <div className="space-y-4 bg-white border border-slate-200 rounded-2xl p-6">
        <ReadOnlyRow label="Full name" value={medic.full_name} />
        <ReadOnlyRow label="Phone" value={medic.phone} mono />
        <ReadOnlyRow label="Qualification" value={medic.qualification} />
        <ReadOnlyRow label="License number" value={medic.license_number ?? "—"} mono />
        <ReadOnlyRow label="Hire date" value={medic.hire_date ?? "—"} />
        <ReadOnlyRow label="Status" value={medic.active ? "Active" : "Inactive"} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form
        action={formAction}
        className="space-y-5 bg-white border border-slate-200 rounded-2xl p-6"
      >
        <input type="hidden" name="id" value={medic.id} />

        {globalErr && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {globalErr}
          </div>
        )}
        {successJustNow && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            Profile updated.
          </div>
        )}

        <Field
          name="full_name"
          label="Full name"
          defaultValue={medic.full_name}
          required
          minLength={2}
          maxLength={80}
          error={errFor("full_name")}
        />
        <Field
          name="phone"
          label="Phone (E.164)"
          type="tel"
          defaultValue={medic.phone}
          required
          mono
          pattern="^\+91[6-9]\d{9}$"
          help="+91 followed by 10 digits starting 6-9. This is the OTP-login credential."
          error={errFor("phone")}
        />

        <div>
          <label
            htmlFor="qualification"
            className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1"
          >
            Qualification
          </label>
          <select
            id="qualification"
            name="qualification"
            required
            defaultValue={medic.qualification}
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          >
            <option value="GNM">GNM</option>
            <option value="B.Sc Nursing">B.Sc Nursing</option>
          </select>
          {errFor("qualification") && (
            <p className="mt-1 text-xs text-red-600">{errFor("qualification")}</p>
          )}
        </div>

        <Field
          name="license_number"
          label="License number"
          defaultValue={medic.license_number ?? ""}
          mono
          maxLength={120}
          help="Optional."
          error={errFor("license_number")}
        />
        <Field
          name="hire_date"
          label="Hire date"
          type="date"
          defaultValue={medic.hire_date ?? ""}
          error={errFor("hire_date")}
        />

        <div className="flex items-center gap-2 pt-2">
          <input
            id="active"
            name="active"
            type="checkbox"
            defaultChecked={medic.active}
            className="size-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
          />
          <label htmlFor="active" className="text-sm text-slate-700">
            Active (can sign in via Android app + receive booking assignments)
          </label>
        </div>

        <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
          {medic.active ? (
            <DeactivateButton medicId={medic.id} medicName={medic.full_name} />
          ) : (
            <span className="text-xs text-slate-500">
              Already inactive. Re-enable via the Active checkbox + Save.
            </span>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required,
  minLength,
  maxLength,
  pattern,
  mono,
  help,
  error,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  mono?: boolean;
  help?: string;
  error?: string | null;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        pattern={pattern}
        className={`w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent ${
          mono ? "font-mono" : ""
        }`}
      />
      {help && !error && <p className="mt-1 text-[11px] text-slate-500">{help}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </div>
      <div className={`text-sm text-slate-900 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}
