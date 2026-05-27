"use client";

// The composer client. Holds the items array in React state, persists
// the whole form via updatePrescriptionDraft on "Save draft", and then
// calls sendPrescription when the doctor commits.
//
// Send result is rendered inline:
//   - on WhatsApp success: confirmation card with the patient-view URL
//     (so the doctor can verify the link out of band if they want)
//   - on WhatsApp failure with PDF saved: prominent "delivery failed —
//     copy this link" card with the URL highlighted (ops fallback)
//   - on hard failure (PDF render etc.): error banner; draft stays
//     editable

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Save,
  Send,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Copy,
  Loader2,
} from "lucide-react";
import {
  updatePrescriptionDraft,
  sendPrescription,
  type RxActionResult,
} from "../../../../_actions/prescription";
import {
  DrugAutocomplete,
  type MedicineSearchResult,
} from "@/components/rx/DrugAutocomplete";

type ItemRow = {
  ordinal: number;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
};

type ComposerInitial = {
  prescription_code: string;
  version: number;
  patient_name: string;
  patient_age: number | null;
  patient_sex: "M" | "F" | "O" | "U" | null;
  patient_weight_kg: number | null;
  chief_complaint: string | null;
  provisional_diagnosis: string | null;
  general_advice: string | null;
  follow_up_advice: string | null;
  items: ItemRow[];
};

type SendOk = { prescription_code: string; rx_url: string; whatsapp_sent: boolean };

export function PrescriptionComposer({
  rxId,
  sessionId,
  initial,
}: {
  rxId: string;
  sessionId: string;
  initial: ComposerInitial;
}) {
  const router = useRouter();
  const [patientName, setPatientName] = useState(initial.patient_name);
  const [patientAge, setPatientAge] = useState<string>(
    initial.patient_age == null ? "" : String(initial.patient_age),
  );
  const [patientSex, setPatientSex] = useState<string>(
    initial.patient_sex ?? "",
  );
  const [patientWeight, setPatientWeight] = useState<string>(
    initial.patient_weight_kg == null ? "" : String(initial.patient_weight_kg),
  );
  const [chiefComplaint, setChiefComplaint] = useState(
    initial.chief_complaint ?? "",
  );
  const [diagnosis, setDiagnosis] = useState(initial.provisional_diagnosis ?? "");
  const [generalAdvice, setGeneralAdvice] = useState(initial.general_advice ?? "");
  const [followUp, setFollowUp] = useState(initial.follow_up_advice ?? "");

  const [items, setItems] = useState<ItemRow[]>(
    initial.items.length > 0
      ? initial.items
      : [{ ordinal: 1, drug_name: "", dose: "", frequency: "", duration: "", instructions: "" }],
  );

  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savePending, startSaveTransition] = useTransition();

  const [sendResult, setSendResult] = useState<RxActionResult<SendOk> | null>(null);
  const [sendPending, startSendTransition] = useTransition();

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("prescription_id", rxId);
    fd.set("patient_name", patientName);
    fd.set("patient_age", patientAge);
    fd.set("patient_sex", patientSex);
    fd.set("patient_weight_kg", patientWeight);
    fd.set("chief_complaint", chiefComplaint);
    fd.set("provisional_diagnosis", diagnosis);
    fd.set("general_advice", generalAdvice);
    fd.set("follow_up_advice", followUp);
    // Submit non-empty items only; ordinals are renumbered by the server.
    const cleanItems = items
      .map((it) => ({
        drug_name: it.drug_name.trim(),
        dose: it.dose?.trim() ?? "",
        frequency: it.frequency?.trim() ?? "",
        duration: it.duration?.trim() ?? "",
        instructions: it.instructions?.trim() ?? "",
      }))
      .filter((it) => it.drug_name.length > 0);
    fd.set("items_json", JSON.stringify(cleanItems));
    return fd;
  }

  function handleSave() {
    setSaveError(null);
    startSaveTransition(async () => {
      try {
        await updatePrescriptionDraft(buildFormData());
        setSavedAt(new Date());
        router.refresh();
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setSaveError(
          e instanceof Error ? e.message : "Could not save draft.",
        );
      }
    });
  }

  function handleSend() {
    setSendResult(null);
    setSaveError(null);
    startSendTransition(async () => {
      try {
        // Save current state first so the send sees the latest fields.
        await updatePrescriptionDraft(buildFormData());
        const result = await sendPrescription(buildFormData());
        setSendResult(result);
        if (result.ok) {
          router.refresh();
        }
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setSendResult({
          ok: false,
          error: e instanceof Error ? e.message : "Could not send prescription.",
        });
      }
    });
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        ordinal: prev.length + 1,
        drug_name: "",
        dose: "",
        frequency: "",
        duration: "",
        instructions: "",
      },
    ]);
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, ordinal: i + 1 })));
  }
  function updateItem<K extends keyof ItemRow>(idx: number, key: K, value: ItemRow[K]) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }

  // After a successful send, show the success surface instead of the
  // editor — the doctor is done. They can navigate to the detail page
  // for amend / void, or back to the Duty Room.
  if (sendResult?.ok) {
    return (
      <SuccessSurface
        rxId={rxId}
        sessionId={sessionId}
        result={sendResult.data}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
              Rx number
            </div>
            <div className="text-base font-mono text-slate-900">
              {initial.prescription_code}
              {initial.version > 1 ? ` · v${initial.version}` : ""}
            </div>
          </div>
          <SaveBadge savedAt={savedAt} saving={savePending} />
        </div>

        {/* Patient block */}
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <Field
            label="Patient name *"
            value={patientName}
            onChange={setPatientName}
            required
          />
          <div className="grid grid-cols-3 gap-3">
            <Field
              label="Age"
              value={patientAge}
              onChange={setPatientAge}
              type="number"
            />
            <SelectField
              label="Sex"
              value={patientSex}
              onChange={setPatientSex}
              options={[
                { value: "", label: "—" },
                { value: "M", label: "M" },
                { value: "F", label: "F" },
                { value: "O", label: "O" },
                { value: "U", label: "?" },
              ]}
            />
            <Field
              label="Wt (kg)"
              value={patientWeight}
              onChange={setPatientWeight}
              type="number"
            />
          </div>
        </div>

        <Textarea
          label="Chief complaint"
          value={chiefComplaint}
          onChange={setChiefComplaint}
          rows={2}
        />
        <Textarea
          label="Provisional diagnosis"
          value={diagnosis}
          onChange={setDiagnosis}
          rows={2}
        />
      </div>

      {/* Medications */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Medications
          </div>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> Add row
          </button>
        </div>

        <div className="space-y-3">
          {items.map((it, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-2 items-start rounded-lg border border-slate-200 p-3"
            >
              <div className="col-span-1 text-xs text-slate-500 font-mono pt-2">{idx + 1}.</div>
              <div className="col-span-11 grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-4">
                  <DrugAutocomplete
                    value={it.drug_name}
                    onChange={(v) => updateItem(idx, "drug_name", v)}
                    onPickCatalog={(picked) => {
                      // Catalog hit: populate brand_name into drug_name
                      // and the catalog strength into dose. Other
                      // fields (frequency / duration / instructions)
                      // stay as the doctor typed them; clinical
                      // judgement lives there. Freetext typing is
                      // still accepted — onChange above runs on every
                      // keystroke; onPickCatalog fires only when a
                      // dropdown item is selected.
                      setItems((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? {
                                ...row,
                                drug_name: picked.brand_name,
                                dose:
                                  picked.strength && picked.strength.length > 0
                                    ? picked.strength
                                    : row.dose,
                              }
                            : row,
                        ),
                      );
                    }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Dose"
                    value={it.dose ?? ""}
                    onChange={(v) => updateItem(idx, "dose", v)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Frequency"
                    value={it.frequency ?? ""}
                    onChange={(v) => updateItem(idx, "frequency", v)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Duration"
                    value={it.duration ?? ""}
                    onChange={(v) => updateItem(idx, "duration", v)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Instructions"
                    value={it.instructions ?? ""}
                    onChange={(v) => updateItem(idx, "instructions", v)}
                  />
                </div>
              </div>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="col-span-12 inline-flex items-center justify-end text-xs text-rose-600 hover:text-rose-800"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove row
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Advice */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
        <Textarea
          label="General advice"
          value={generalAdvice}
          onChange={setGeneralAdvice}
          rows={3}
          placeholder="Diet, lifestyle, things to avoid…"
        />
        <Textarea
          label="Follow-up"
          value={followUp}
          onChange={setFollowUp}
          rows={2}
          placeholder="When to come back / re-evaluate; red flags."
        />
      </div>

      {/* Errors */}
      {saveError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{saveError}</div>
        </div>
      )}
      {sendResult && !sendResult.ok && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold mb-0.5">Could not send</div>
            <div>{sendResult.error}</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleSave}
          disabled={savePending || sendPending}
          className="inline-flex items-center gap-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-900 text-sm font-semibold px-5 py-2.5 rounded-lg"
        >
          {savePending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {savePending ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={savePending || sendPending}
          className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg"
        >
          {sendPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {sendPending ? "Sending…" : "Save & send to patient"}
        </button>
        <Link
          href="/doctor"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          Back to Duty Room
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------

function SaveBadge({ savedAt, saving }: { savedAt: Date | null; saving: boolean }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (savedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> Saved {savedAt.toLocaleTimeString()}
      </span>
    );
  }
  return null;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={type === "number" ? "any" : undefined}
        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
      />
    </label>
  );
}

function SuccessSurface({
  rxId,
  sessionId,
  result,
}: {
  rxId: string;
  sessionId: string;
  result: SendOk;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <div
        className={
          "rounded-2xl border p-6 " +
          (result.whatsapp_sent
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50")
        }
      >
        <div className="flex items-start gap-3">
          {result.whatsapp_sent ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
          ) : (
            <AlertCircle className="w-6 h-6 text-amber-700 shrink-0" />
          )}
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              {result.whatsapp_sent
                ? `Prescription delivered (${result.prescription_code})`
                : `Prescription saved — WhatsApp delivery failed`}
            </h2>
            <p className="text-sm text-slate-700 mb-3">
              {result.whatsapp_sent
                ? "The patient has received the link on WhatsApp. They can re-open it any time."
                : "The PDF was generated and saved. WhatsApp delivery didn't go through — copy the link below and share it manually, or ask ops to retry delivery."}
            </p>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <code className="px-3 py-1.5 rounded-md bg-white border border-slate-300 text-xs font-mono break-all flex-1 min-w-[260px]">
                {result.rx_url}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(result.rx_url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className="inline-flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-md"
              >
                <Copy className="w-3 h-3" /> {copied ? "Copied" : "Copy link"}
              </button>
              <a
                href={result.rx_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-md border border-slate-300"
              >
                <ExternalLink className="w-3 h-3" /> Open
              </a>
            </div>
            <div className="flex gap-3 text-sm">
              <Link
                href={`/doctor/prescriptions/${result.prescription_code}`}
                className="text-slate-900 underline decoration-slate-400 hover:decoration-slate-900"
              >
                Open prescription detail
              </Link>
              <Link
                href="/doctor"
                className="text-slate-600 hover:text-slate-900"
              >
                Back to Duty Room
              </Link>
            </div>
          </div>
        </div>
      </div>
      {/* Surface IDs in a small dev/audit footer (handy when ops calls
          asking which Rx the doctor sent). Not sensitive. */}
      <div className="text-[10px] font-mono text-slate-400">
        rx:{rxId} · session:{sessionId}
      </div>
    </div>
  );
}

// DrugAutocomplete and the MedicineSearchResult type now live in the
// shared module at @/components/rx/DrugAutocomplete — extracted in the
// C2-Rx v3 build so the in-call drawer composer reuses the same UX.
