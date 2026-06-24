"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// GDA onboarding form. A GDA needs NO qualification (founder, 2026-06-23) and is
// paid a daily wage by shift kind. Captures full_name, mobile, home address, shift
// preference, per-kind default rates, and an explicit documents-consent — then,
// using the new GDA's id, uploads the ID images (Aadhaar, PAN, photo,
// address_proof) to the existing access-logged private-bucket route. We never
// send the raw ID number anywhere — only the image.
//
// Two-step on submit: (1) POST /api/ops/gda/staff → id, then (2) per provided
// file, POST multipart to /api/ops/medics/{id}/docs. A doc upload failing does
// NOT undo the created GDA — it reports which docs are still pending so ops can
// re-upload from the medic detail page.

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

// task_key on medic_documents.doc_type ← founder onboarding doc set.
const DOC_FIELDS: Array<{ key: string; docType: string; label: string }> = [
  { key: "doc_aadhar", docType: "aadhar", label: "Aadhaar (image/PDF)" },
  { key: "doc_pan", docType: "pan", label: "PAN (image/PDF)" },
  { key: "doc_photo", docType: "photo", label: "Photo" },
  { key: "doc_address_proof", docType: "address_proof", label: "Address proof" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function GdaOnboardingForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);

    const consent = f.get("documents_consent") === "on";
    if (!consent) {
      setMsg({ ok: false, text: "Tick the consent box — we're storing ID documents." });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      // Step 1 — create the GDA.
      const createRes = await fetch("/api/ops/gda/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: f.get("full_name"),
          phone: f.get("phone"),
          home_address: f.get("home_address"),
          shift_preference: f.get("shift_preference"),
          rate_day12_rupees: f.get("rate_day12_rupees") || null,
          rate_night12_rupees: f.get("rate_night12_rupees") || null,
          rate_full24_rupees: f.get("rate_full24_rupees") || null,
          documents_consent: consent,
        }),
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createData?.gda?.id) {
        setMsg({
          ok: false,
          text: `Create failed: ${createData.error ?? createRes.statusText}${
            createData.detail ? ` — ${createData.detail}` : ""
          }`,
        });
        return;
      }
      const gdaId: string = createData.gda.id;

      // Step 2 — upload each provided ID image to the access-logged docs route.
      const pending: string[] = [];
      for (const d of DOC_FIELDS) {
        const file = f.get(d.key);
        if (!(file instanceof File) || file.size === 0) continue;
        const docForm = new FormData();
        docForm.set("file", file);
        docForm.set("doc_type", d.docType);
        const upRes = await fetch(`/api/ops/medics/${gdaId}/docs`, {
          method: "POST",
          body: docForm,
        });
        if (!upRes.ok) pending.push(d.docType);
      }

      form.reset();
      router.refresh();
      if (pending.length === 0) {
        setMsg({ ok: true, text: "GDA onboarded — profile + documents saved." });
      } else {
        setMsg({
          ok: false,
          text: `GDA created, but these docs didn't upload: ${pending.join(", ")}. Re-upload from the medic's Documents tab.`,
        });
      }
    } catch {
      setMsg({ ok: false, text: "network_error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} className="grid grid-cols-2 gap-3" onSubmit={onSubmit}>
      <Field label="Full name">
        <input name="full_name" className={inputCls} required />
      </Field>
      <Field label="Mobile (+91…)">
        <input name="phone" className={inputCls} placeholder="+919999999999" required />
      </Field>

      <div className="col-span-2">
        <Field label="Home address">
          <input name="home_address" className={inputCls} required />
        </Field>
      </div>

      <Field label="Shift preference">
        <select name="shift_preference" className={inputCls} defaultValue="any" required>
          <option value="any">Any</option>
          <option value="day12">12h Day</option>
          <option value="night12">12h Night</option>
          <option value="full24">24h</option>
        </select>
      </Field>
      <div /> {/* spacer to keep the rate row aligned */}

      <Field label="Rate · 12h Day (₹/shift)">
        <input type="number" min="0" step="1" name="rate_day12_rupees" className={inputCls} />
      </Field>
      <Field label="Rate · 12h Night (₹/shift)">
        <input type="number" min="0" step="1" name="rate_night12_rupees" className={inputCls} />
      </Field>
      <Field label="Rate · 24h (₹/shift)">
        <input type="number" min="0" step="1" name="rate_full24_rupees" className={inputCls} />
      </Field>
      <div />

      <div className="col-span-2 mt-1 border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs font-medium text-slate-600">
          ID documents (stored privately, access-logged — no qualification needed)
        </p>
        <div className="grid grid-cols-2 gap-3">
          {DOC_FIELDS.map((d) => (
            <Field key={d.key} label={d.label}>
              <input
                type="file"
                name={d.key}
                accept={ACCEPT}
                className="w-full text-xs text-slate-600 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:px-2 file:py-1 file:text-xs"
              />
            </Field>
          ))}
        </div>
      </div>

      <label className="col-span-2 flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" name="documents_consent" className="mt-0.5" />
        <span>
          The GDA consents to Sanocare securely storing their ID documents
          (Aadhaar/PAN/photo/address proof) for employment + compliance. Required
          to onboard.
        </span>
      </label>

      {msg && (
        <div
          className={
            "col-span-2 rounded-lg px-3 py-2 text-xs font-medium " +
            (msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")
          }
        >
          {msg.text}
        </div>
      )}

      <div className="col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Onboarding…" : "Onboard GDA"}
        </button>
      </div>
    </form>
  );
}
