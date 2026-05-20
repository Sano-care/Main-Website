import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createPartner } from "../actions";

export const metadata: Metadata = {
  title: "Ops · New partner",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function NewPartnerPage() {
  return (
    <div className="px-8 py-8 max-w-3xl">
      <Link
        href="/ops/partners"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to partners
      </Link>

      <div className="mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Master records
        </div>
        <h1 className="text-2xl font-bold text-slate-900">New partner</h1>
        <p className="text-sm text-slate-600 mt-1">
          A <span className="font-mono">SAN-P-…</span> code will be allocated automatically.
        </p>
      </div>

      <form action={createPartner} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <Row>
          <Field label="Name *" name="name" required />
          <Field label="Partner type *" name="partner_type">
            <select
              name="partner_type"
              required
              defaultValue=""
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="" disabled>
                Select…
              </option>
              <option value="society">Society</option>
              <option value="clinic">Clinic</option>
              <option value="corporate">Corporate</option>
              <option value="individual">Individual</option>
            </select>
          </Field>
        </Row>

        <Row>
          <Field label="Contact name" name="contact_name" />
          <Field label="Phone" name="phone" type="tel" />
        </Row>

        <Row>
          <Field label="Email" name="email" type="email" />
          <Field label="Pincode" name="pincode" />
        </Row>

        <Field label="Address" name="address_line" multiline />

        <Field label="City" name="city" />

        <Field label="Notes (internal)" name="notes" multiline />

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            Create partner
          </button>
          <Link
            href="/ops/partners"
            className="text-sm text-slate-500 hover:text-slate-900"
          >
            Cancel
          </Link>
        </div>
      </form>
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
  required,
  multiline,
  children,
}: {
  label: string;
  name: string;
  type?: string;
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
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
      )}
    </label>
  );
}
