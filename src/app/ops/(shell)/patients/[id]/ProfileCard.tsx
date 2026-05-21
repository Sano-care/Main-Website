"use client";

import { useState, useTransition } from "react";
import { Pencil, X, AlertCircle } from "lucide-react";
import { updateCustomer } from "../actions";
import { computeAge, computeCompleteness } from "../../../_lib/customerProfile";

type Customer = {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address_line: string | null;
  area: string | null;
  city: string | null;
  pincode: string | null;
  notes: string | null;
};

export function ProfileCard({ customer }: { customer: Customer }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const age = computeAge(customer.date_of_birth);
  const completeness = computeCompleteness(customer);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await updateCustomer(formData);
        setEditing(false);
      } catch (e) {
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

        <form action={handleSubmit} className="space-y-5">
          <input type="hidden" name="id" value={customer.id} />

          <Row>
            <Field label="Full name *" name="full_name" defaultValue={customer.full_name} required />
            <Field label="Phone" name="phone" type="tel" defaultValue={customer.phone ?? ""} />
          </Row>

          <Row>
            <Field label="Email" name="email" type="email" defaultValue={customer.email ?? ""} />
            <Field
              label="Date of birth"
              name="date_of_birth"
              type="date"
              defaultValue={customer.date_of_birth ?? ""}
            />
          </Row>

          <Row>
            <Field label="Gender" name="gender">
              <select
                id="f-gender"
                name="gender"
                defaultValue={customer.gender ?? ""}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              >
                <option value="">—</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </Field>
            <Field label="Pincode" name="pincode" defaultValue={customer.pincode ?? ""} />
          </Row>

          <Field label="Address" name="address_line" multiline defaultValue={customer.address_line ?? ""} />

          <Row>
            <Field label="Area / locality" name="area" defaultValue={customer.area ?? ""} />
            <Field label="City" name="city" defaultValue={customer.city ?? ""} />
          </Row>

          <Field label="Notes (internal)" name="notes" multiline defaultValue={customer.notes ?? ""} />

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
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" /> Edit
        </button>
      </div>

      <CompletenessBar percent={completeness.percent} missing={completeness.missing} />

      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm mt-5">
        <DetailRow label="Phone" value={customer.phone} mono />
        <DetailRow label="Email" value={customer.email} />
        <DetailRow
          label="Date of birth"
          value={
            customer.date_of_birth
              ? `${new Date(customer.date_of_birth).toLocaleDateString("en-IN")}${
                  age != null ? ` · age ${age}` : ""
                }`
              : null
          }
        />
        <DetailRow label="Gender" value={customer.gender} />
        <DetailRow label="Address" value={customer.address_line} />
        <DetailRow label="Area" value={customer.area} />
        <DetailRow label="City" value={customer.city} />
        <DetailRow label="Pincode" value={customer.pincode} mono />
      </div>
      {customer.notes && (
        <div className="mt-5 pt-5 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-1">Notes</div>
          <div className="text-sm text-slate-800 whitespace-pre-wrap">{customer.notes}</div>
        </div>
      )}
    </div>
  );
}

function CompletenessBar({
  percent,
  missing,
}: {
  percent: number;
  missing: string[];
}) {
  // Color thresholds: green ≥ 85, amber ≥ 50, rose below
  const tone =
    percent >= 85
      ? { bar: "bg-emerald-500", text: "text-emerald-700" }
      : percent >= 50
        ? { bar: "bg-amber-500", text: "text-amber-700" }
        : { bar: "bg-rose-500", text: "text-rose-700" };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs text-slate-500">Profile completeness</div>
        <div className={`text-xs font-semibold ${tone.text}`}>{percent}% complete</div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${tone.bar} transition-all`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {missing.length > 0 && (
        <div className="text-xs text-slate-500 mt-2">
          Missing: <span className="text-slate-700">{missing.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-4">{children}</div>;
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  multiline,
  children,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  multiline?: boolean;
  children?: React.ReactNode;
}) {
  const id = `f-${name}`;
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      {children ? (
        children
      ) : multiline ? (
        <textarea
          id={id}
          name={name}
          rows={3}
          required={required}
          defaultValue={defaultValue ?? ""}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          defaultValue={defaultValue ?? ""}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
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
