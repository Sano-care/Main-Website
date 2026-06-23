"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// GDA Phase 1 (M064) — ops create/schedule panel. Three forms that POST to the
// /api/ops/gda/* endpoints (the source of truth + where validation lives) and
// refresh the server-rendered list on success. Kept deliberately lean — this is
// the internal ops console, not a patient surface.

type Gda = {
  id: string;
  full_name: string;
  phone: string;
  insulin_med_cleared: boolean;
  active: boolean;
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";

export function GdaOpsPanel({ gdas }: { gdas: Gda[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"gda" | "deployment" | "shift">("deployment");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(url: string, payload: unknown, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          ok: false,
          text: `${data.error ?? "error"}${data.detail ? ` — ${data.detail}` : ""}`,
        });
      } else {
        setMsg({ ok: true, text: okText });
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: "network_error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex gap-2">
        {(
          [
            ["deployment", "New deployment"],
            ["shift", "Schedule shift"],
            ["gda", "New GDA"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setMsg(null);
            }}
            className={
              "rounded-lg px-3 py-1.5 text-xs font-medium " +
              (tab === key
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {msg && (
        <div
          className={
            "mb-4 rounded-lg px-3 py-2 text-xs font-medium " +
            (msg.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700")
          }
        >
          {msg.text}
        </div>
      )}

      {tab === "gda" && (
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            submit(
              "/api/ops/gda/staff",
              {
                full_name: f.get("full_name"),
                phone: f.get("phone"),
                qualification: f.get("qualification"),
                insulin_med_cleared: f.get("insulin_med_cleared") === "on",
              },
              "GDA created.",
            );
          }}
        >
          <Field label="Full name">
            <input name="full_name" className={inputCls} required />
          </Field>
          <Field label="Phone (+91…)">
            <input
              name="phone"
              className={inputCls}
              placeholder="+919999999999"
              required
            />
          </Field>
          <Field label="Qualification">
            <select name="qualification" className={inputCls} required>
              <option value="GNM">GNM</option>
              <option value="B.Sc Nursing">B.Sc Nursing</option>
            </select>
          </Field>
          <label className="mt-6 flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" name="insulin_med_cleared" />
            Cleared for insulin / medication (D2a)
          </label>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Create GDA
            </button>
          </div>
        </form>
      )}

      {tab === "deployment" && (
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            submit(
              "/api/ops/gda/deployments",
              {
                patient_name: f.get("patient_name"),
                address: f.get("address"),
                shift_pattern: f.get("shift_pattern"),
                start_date: f.get("start_date"),
                end_date: f.get("end_date") || null,
                rate_per_shift_rupees: f.get("rate_per_shift_rupees") || null,
                customer_id: f.get("customer_id") || null,
                medication_consent: f.get("medication_consent") === "on",
              },
              "Deployment created.",
            );
          }}
        >
          <Field label="Patient name">
            <input name="patient_name" className={inputCls} required />
          </Field>
          <Field label="Shift pattern">
            <select name="shift_pattern" className={inputCls} required>
              <option value="12h">12h</option>
              <option value="24h">24h</option>
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Address">
              <input name="address" className={inputCls} required />
            </Field>
          </div>
          <Field label="Start date">
            <input type="date" name="start_date" className={inputCls} required />
          </Field>
          <Field label="End date (optional — open-ended if blank)">
            <input type="date" name="end_date" className={inputCls} />
          </Field>
          <Field label="Customer rate / shift (₹, optional)">
            <input
              type="number"
              min="0"
              step="1"
              name="rate_per_shift_rupees"
              className={inputCls}
            />
          </Field>
          <Field label="Customer ID (optional — links vitals)">
            <input
              name="customer_id"
              className={inputCls}
              placeholder="uuid"
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" name="medication_consent" />
            Family medication consent captured (D2a)
          </label>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Create deployment
            </button>
          </div>
        </form>
      )}

      {tab === "shift" && (
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const deploymentId = String(f.get("deployment_id") ?? "").trim();
            submit(
              `/api/ops/gda/deployments/${deploymentId}/shifts`,
              {
                gda_id: f.get("gda_id"),
                shift_date: f.get("shift_date"),
                shift_kind: f.get("shift_kind"),
                payout_rupees: f.get("payout_rupees") || null,
              },
              "Shift scheduled.",
            );
          }}
        >
          <div className="col-span-2">
            <Field label="Deployment ID">
              <input
                name="deployment_id"
                className={inputCls}
                placeholder="paste the deployment uuid (from the list)"
                required
              />
            </Field>
          </div>
          <Field label="GDA">
            <select name="gda_id" className={inputCls} required>
              <option value="">— pick a GDA —</option>
              {gdas.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.full_name} ({g.phone})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shift kind">
            <select name="shift_kind" className={inputCls} required>
              <option value="day12">day12 (12h day)</option>
              <option value="night12">night12 (12h night)</option>
              <option value="full24">full24 (24h)</option>
            </select>
          </Field>
          <Field label="Shift date">
            <input type="date" name="shift_date" className={inputCls} required />
          </Field>
          <Field label="GDA payout / shift (₹, optional)">
            <input
              type="number"
              min="0"
              step="1"
              name="payout_rupees"
              className={inputCls}
            />
          </Field>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Schedule shift
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
