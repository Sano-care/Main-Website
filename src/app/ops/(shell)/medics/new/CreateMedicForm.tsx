"use client";

import { useActionState } from "react";
import { createMedicAction, type CreateMedicResult } from "./actions";

// T65 Phase 2 C3-quick — Add-Medic form (client component).
//
// useActionState wraps the createMedicAction server action so inline
// errors don't blow away user input on dupe-phone or validation miss.
// On success the action redirects to /ops/bookings?medic_added=1; on
// failure it returns a CreateMedicResult{ ok: false } which renders
// inline.

function todayISO(): string {
  // Match the server-side todayInIST(); client clock is best-effort
  // and the action validates again server-side anyway.
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export function CreateMedicForm() {
  const [state, formAction, pending] = useActionState<
    CreateMedicResult | null,
    FormData
  >(createMedicAction, null);

  const errFor = (
    field: "full_name" | "phone" | "qualification" | "license_number" | "hire_date",
  ) =>
    state && !state.ok && state.field === field ? state.error : null;
  const globalErr = state && !state.ok && !state.field ? state.error : null;

  return (
    <form action={formAction} className="space-y-5 bg-white border border-slate-200 rounded-2xl p-6">
      {globalErr && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {globalErr}
        </div>
      )}

      <div>
        <label htmlFor="full_name" className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Full name
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          required
          minLength={2}
          maxLength={80}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
        {errFor("full_name") && (
          <p className="mt-1 text-xs text-red-600">{errFor("full_name")}</p>
        )}
      </div>

      <div>
        <label htmlFor="phone" className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Phone (E.164)
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          placeholder="+919711977782"
          pattern="^\+91[6-9]\d{9}$"
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Must be +91 followed by 10 digits starting 6-9. This becomes the medic&apos;s OTP-login credential.
        </p>
        {errFor("phone") && (
          <p className="mt-1 text-xs text-red-600">{errFor("phone")}</p>
        )}
      </div>

      <div>
        <label htmlFor="qualification" className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Qualification
        </label>
        <select
          id="qualification"
          name="qualification"
          required
          defaultValue=""
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        >
          <option value="" disabled>
            — Select —
          </option>
          <option value="GNM">GNM</option>
          <option value="B.Sc Nursing">B.Sc Nursing</option>
        </select>
        {errFor("qualification") && (
          <p className="mt-1 text-xs text-red-600">{errFor("qualification")}</p>
        )}
      </div>

      <div>
        <label htmlFor="license_number" className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          License number <span className="text-slate-400 normal-case">(optional)</span>
        </label>
        <input
          id="license_number"
          name="license_number"
          type="text"
          maxLength={120}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
        {errFor("license_number") && (
          <p className="mt-1 text-xs text-red-600">{errFor("license_number")}</p>
        )}
      </div>

      <div>
        <label htmlFor="hire_date" className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Hire date
        </label>
        <input
          id="hire_date"
          name="hire_date"
          type="date"
          defaultValue={todayISO()}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
        {errFor("hire_date") && (
          <p className="mt-1 text-xs text-red-600">{errFor("hire_date")}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked
          className="size-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
        />
        <label htmlFor="active" className="text-sm text-slate-700">
          Active (can sign in via Android app + receive booking assignments)
        </label>
      </div>

      <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Adding…" : "Add medic"}
        </button>
      </div>
    </form>
  );
}
