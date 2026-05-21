"use client";

import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { createBooking } from "../actions";
import { SERVICE_CATEGORIES } from "../../../_lib/bookingStatus";

type Mode = "existing" | "new";

export function NewBookingForm() {
  const [mode, setMode] = useState<Mode>("existing");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await createBooking(formData);
      } catch (e) {
        // Re-throw Next.js redirect / notFound — they're how the server
        // action navigates on success.
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Could not create booking");
      }
    });
  };

  return (
    <form action={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* hidden mode field so the server action knows which branch to take */}
      <input type="hidden" name="customer_mode" value={mode} />

      {/* ============================== Patient ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Patient
        </legend>

        <div className="flex gap-2 mb-5">
          <ModeButton
            label="Existing patient"
            active={mode === "existing"}
            onClick={() => setMode("existing")}
          />
          <ModeButton
            label="Create new patient"
            active={mode === "new"}
            onClick={() => setMode("new")}
          />
        </div>

        {mode === "existing" ? (
          <Field
            label="Find by SAN-C code, phone, or full UUID *"
            name="customer_lookup"
            required
            placeholder="e.g. SAN-C-00012 or 9876543210"
            mono
          />
        ) : (
          <div className="space-y-4">
            <Row>
              <Field label="Full name *" name="customer_full_name" required />
              <Field
                label="Phone *"
                name="customer_phone"
                type="tel"
                required
                placeholder="Required — used on the booking row"
              />
            </Row>
            <Row>
              <Field label="Email" name="customer_email" type="email" />
              <Field
                label="Date of birth"
                name="customer_date_of_birth"
                type="date"
              />
            </Row>
            <Row>
              <Field label="Gender" name="customer_gender">
                <select
                  id="f-customer_gender"
                  name="customer_gender"
                  defaultValue=""
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                >
                  <option value="">—</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </Field>
              <Field label="Pincode" name="customer_pincode" />
            </Row>
            <Field
              label="Customer address (saved on the patient record)"
              name="customer_address_line"
              multiline
            />
            <Row>
              <Field label="Area" name="customer_area" />
              <Field label="City" name="customer_city" />
            </Row>
            <Field
              label="Customer notes (internal — saved on the patient record)"
              name="customer_notes"
              multiline
            />
          </div>
        )}
      </fieldset>

      {/* ============================== Booking ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Booking
        </legend>

        <Row>
          <Field label="Service *" name="service_category">
            <select
              id="f-service_category"
              name="service_category"
              required
              defaultValue=""
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="" disabled>
                Select…
              </option>
              {SERVICE_CATEGORIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Scheduled for"
            name="scheduled_for"
            type="datetime-local"
          />
        </Row>

        <Field
          label="Visit address *"
          name="manual_address"
          multiline
          required
          placeholder="Address where the service will be provided"
        />

        <Row>
          <Field
            label="Amount (₹)"
            name="amount"
            type="number"
            placeholder="Optional — leave blank if not yet quoted"
          />
          <Field
            label="Partner (optional)"
            name="partner_lookup"
            placeholder="SAN-P-00001 or full UUID"
            mono
          />
        </Row>

        <Field
          label="Ops notes (internal)"
          name="ops_notes"
          multiline
          placeholder="Anything ops should remember — call details, special instructions, etc."
        />

        <p className="text-xs text-slate-500 pt-2">
          Status starts at <span className="font-mono">PENDING</span>. Change it
          later from the booking detail page.
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
        >
          {isPending ? "Creating…" : "Create booking"}
        </button>
        <a
          href="/ops/bookings"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

function ModeButton({
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
  mono,
  children,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  const id = `f-${name}`;
  const inputCls =
    "w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent" +
    (mono ? " font-mono" : "");
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">
        {label}
      </span>
      {children ? (
        children
      ) : multiline ? (
        <textarea
          id={id}
          name={name}
          rows={3}
          required={required}
          placeholder={placeholder}
          className={inputCls}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          className={inputCls}
        />
      )}
    </label>
  );
}
