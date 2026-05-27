"use client";

// In-call Rx composer drawer (C2-Rx v3).
//
// Mounted by DutyRoomEmbed.tsx alongside the Daily iframe. When the
// drawer opens, the iframe wrapper shrinks to 60% width (F1 sign-off)
// and this drawer occupies the right 40%. Daily Prebuilt re-flows on
// container resize without an explicit API call (verified on v6.1's
// patient fullscreen toggle).
//
// Flow
// ----
// 1. On mount with `open=true`, fetch the active session via
//    findActiveRxSessionForDoctor (most-recent-waiting-with-joined_at
//    per Q2). If null → empty state "No patient in consult yet".
// 2. With session resolved, fetch (or create) the open draft for that
//    session via ensureDraftForSession. Hydrates the form with what
//    was last saved.
// 3. Form fields: vitals (6), chief complaint, diagnosis, items
//    (autocomplete + dose/freq/dur/notes; add/remove rows), lab tests
//    (free-text test_name + instructions per Q4), advice + follow-up.
// 4. Save draft → updatePrescriptionDraft.
// 5. Send Rx → sendPrescription; on success, drawer closes with a
//    confirmation toast; on WhatsApp failure with PDF saved, the
//    drawer stays open and surfaces the ops fallback URL.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  X,
  Save,
  Send,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Copy,
  ExternalLink,
} from "lucide-react";
import {
  findActiveRxSessionForDoctor,
  ensureDraftForSession,
  updatePrescriptionDraft,
  sendPrescription,
  type ActiveRxSessionInfo,
  type DrawerComposerInitial,
  type RxActionResult,
} from "../_actions/prescription";
import {
  DrugAutocomplete,
  type MedicineSearchResult,
} from "@/components/rx/DrugAutocomplete";
import {
  LabTestAutocomplete,
  type LabTestSearchResult,
} from "@/components/rx/LabTestAutocomplete";

// ---- Local form-row shapes --------------------------------------------

type ItemRow = {
  ordinal: number;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  medicine_sku: number | null;
  composition: string | null;
};

type LabRow = {
  ordinal: number;
  test_name: string;
  instructions: string | null;
  // M027: catalog FK + snapshot fields. lab_test_id is null for
  // free-text rows; the catalog_* fields are doctor-UX-only (the PDF
  // renders test_name + instructions only).
  lab_test_id: string | null;
  catalog_code: string | null;
  catalog_category: string | null;
  catalog_price_paise: number | null;
};

type Mode =
  | { kind: "loading" }
  | { kind: "no-active-session" }
  | { kind: "error"; error: string }
  | {
      kind: "ready";
      session: ActiveRxSessionInfo;
      initial: DrawerComposerInitial;
    };

type SendOk = { prescription_code: string; rx_url: string; whatsapp_sent: boolean };

// ---- Helpers ----------------------------------------------------------

function emptyItem(ord: number): ItemRow {
  return {
    ordinal: ord,
    drug_name: "",
    dose: null,
    frequency: null,
    duration: null,
    instructions: null,
    medicine_sku: null,
    composition: null,
  };
}

function emptyLab(ord: number): LabRow {
  return {
    ordinal: ord,
    test_name: "",
    instructions: null,
    lab_test_id: null,
    catalog_code: null,
    catalog_category: null,
    catalog_price_paise: null,
  };
}

function formatPaiseAsRupees(paise: number | null): string | null {
  if (paise == null) return null;
  const rupees = paise / 100;
  if (Number.isInteger(rupees)) return `₹${rupees.toLocaleString("en-IN")}`;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

// ---- Drawer -----------------------------------------------------------

export type RxComposerDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function RxComposerDrawer({ open, onClose }: RxComposerDrawerProps) {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });

  // Hydratable form state — only populated when mode.kind === 'ready'.
  // We keep it lifted out of `mode` so saves don't re-trigger the
  // loading state.
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState<string>("");
  const [patientSex, setPatientSex] = useState<"M" | "F" | "O" | "U" | "">("");
  const [patientWeight, setPatientWeight] = useState<string>("");
  const [bpSys, setBpSys] = useState<string>("");
  const [bpDia, setBpDia] = useState<string>("");
  const [pulse, setPulse] = useState<string>("");
  const [spo2, setSpo2] = useState<string>("");
  const [tempC, setTempC] = useState<string>("");
  const [heightCm, setHeightCm] = useState<string>("");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [advice, setAdvice] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [items, setItems] = useState<ItemRow[]>([emptyItem(1)]);
  const [labs, setLabs] = useState<LabRow[]>([]);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [sendResult, setSendResult] = useState<RxActionResult<SendOk> | null>(null);
  const [savePending, startSave] = useTransition();
  const [sendPending, startSend] = useTransition();

  const reloadCounter = useRef(0);

  // ---- Hydration ------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMode({ kind: "loading" });
    setSaveError(null);
    setSaveOk(false);
    setSendResult(null);
    reloadCounter.current++;

    (async () => {
      try {
        const session = await findActiveRxSessionForDoctor();
        if (cancelled) return;
        if (!session) {
          setMode({ kind: "no-active-session" });
          return;
        }
        const fd = new FormData();
        fd.set("session_id", session.session_id);
        const result = await ensureDraftForSession(fd);
        if (cancelled) return;
        if (!result.ok) {
          setMode({ kind: "error", error: result.error });
          return;
        }
        // Hydrate form state from initial.
        const init = result.data;
        setPatientName(init.patient_name ?? "");
        setPatientAge(init.patient_age == null ? "" : String(init.patient_age));
        setPatientSex(init.patient_sex ?? "");
        setPatientWeight(
          init.patient_weight_kg == null ? "" : String(init.patient_weight_kg),
        );
        setBpSys(init.bp_sys == null ? "" : String(init.bp_sys));
        setBpDia(init.bp_dia == null ? "" : String(init.bp_dia));
        setPulse(init.pulse_bpm == null ? "" : String(init.pulse_bpm));
        setSpo2(init.spo2_pct == null ? "" : String(init.spo2_pct));
        setTempC(init.temp_c == null ? "" : String(init.temp_c));
        setHeightCm(init.height_cm == null ? "" : String(init.height_cm));
        setChiefComplaint(init.chief_complaint ?? "");
        setDiagnosis(init.provisional_diagnosis ?? "");
        setAdvice(init.general_advice ?? "");
        setFollowUp(init.follow_up_advice ?? "");
        setItems(
          init.items.length > 0
            ? init.items.map((it, idx) => ({
                ordinal: idx + 1,
                drug_name: it.drug_name,
                dose: it.dose,
                frequency: it.frequency,
                duration: it.duration,
                instructions: it.instructions,
                medicine_sku: it.medicine_sku,
                composition: it.composition,
              }))
            : [emptyItem(1)],
        );
        setLabs(
          init.lab_tests.map((t, idx) => ({
            ordinal: idx + 1,
            test_name: t.test_name,
            instructions: t.instructions,
            lab_test_id: t.lab_test_id,
            catalog_code: t.catalog_code,
            catalog_category: t.catalog_category,
            catalog_price_paise: t.catalog_price_paise,
          })),
        );
        setMode({ kind: "ready", session, initial: init });
      } catch (e) {
        if (cancelled) return;
        setMode({
          kind: "error",
          error: e instanceof Error ? e.message : "Could not load Rx composer.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // ---- Item / lab row management -------------------------------------
  const addItem = useCallback(() => {
    setItems((prev) => [...prev, emptyItem(prev.length + 1)]);
  }, []);
  const removeItem = useCallback((ord: number) => {
    setItems((prev) =>
      prev
        .filter((it) => it.ordinal !== ord)
        .map((it, idx) => ({ ...it, ordinal: idx + 1 })),
    );
  }, []);
  const updateItem = useCallback(
    <K extends keyof ItemRow>(ord: number, key: K, value: ItemRow[K]) => {
      setItems((prev) =>
        prev.map((it) => (it.ordinal === ord ? { ...it, [key]: value } : it)),
      );
    },
    [],
  );
  const onPickCatalog = useCallback(
    (ord: number, picked: MedicineSearchResult) => {
      setItems((prev) =>
        prev.map((it) =>
          it.ordinal === ord
            ? {
                ...it,
                drug_name: picked.brand_name,
                dose: picked.strength ?? it.dose,
                medicine_sku: picked.sku,
                composition: picked.composition,
              }
            : it,
        ),
      );
    },
    [],
  );

  const addLab = useCallback(() => {
    setLabs((prev) => [...prev, emptyLab(prev.length + 1)]);
  }, []);
  const removeLab = useCallback((ord: number) => {
    setLabs((prev) =>
      prev
        .filter((t) => t.ordinal !== ord)
        .map((t, idx) => ({ ...t, ordinal: idx + 1 })),
    );
  }, []);
  const updateLab = useCallback(
    <K extends keyof LabRow>(ord: number, key: K, value: LabRow[K]) => {
      setLabs((prev) =>
        prev.map((t) => (t.ordinal === ord ? { ...t, [key]: value } : t)),
      );
    },
    [],
  );
  const onPickLabCatalog = useCallback(
    (ord: number, picked: LabTestSearchResult) => {
      // On select: set test_name, lab_test_id, snapshot catalog
      // fields, and OPTIONALLY pre-fill instructions only when the
      // row's instructions field is currently empty (per brief §4 —
      // doctor's typed text wins, we never overwrite existing input).
      setLabs((prev) =>
        prev.map((t) => {
          if (t.ordinal !== ord) return t;
          const shouldPrefillInstructions =
            (!t.instructions || t.instructions.trim() === "") &&
            !!picked.instructions &&
            picked.instructions.trim() !== "";
          return {
            ...t,
            test_name: picked.name,
            lab_test_id: picked.id,
            catalog_code: picked.code,
            catalog_category: picked.category,
            catalog_price_paise: picked.price_paise,
            instructions: shouldPrefillInstructions
              ? picked.instructions
              : t.instructions,
          };
        }),
      );
    },
    [],
  );

  // ---- Save & send ----------------------------------------------------
  const buildFormData = useCallback((): FormData => {
    if (mode.kind !== "ready") throw new Error("Not ready");
    const fd = new FormData();
    fd.set("prescription_id", mode.initial.prescription_id);
    fd.set("patient_name", patientName);
    if (patientAge.trim()) fd.set("patient_age", patientAge.trim());
    if (patientSex) fd.set("patient_sex", patientSex);
    if (patientWeight.trim()) fd.set("patient_weight_kg", patientWeight.trim());
    if (bpSys.trim()) fd.set("bp_sys", bpSys.trim());
    if (bpDia.trim()) fd.set("bp_dia", bpDia.trim());
    if (pulse.trim()) fd.set("pulse_bpm", pulse.trim());
    if (spo2.trim()) fd.set("spo2_pct", spo2.trim());
    if (tempC.trim()) fd.set("temp_c", tempC.trim());
    if (heightCm.trim()) fd.set("height_cm", heightCm.trim());
    if (chiefComplaint.trim()) fd.set("chief_complaint", chiefComplaint);
    if (diagnosis.trim()) fd.set("provisional_diagnosis", diagnosis);
    if (advice.trim()) fd.set("general_advice", advice);
    if (followUp.trim()) fd.set("follow_up_advice", followUp);
    // Serialise items + labs as JSON.
    fd.set(
      "items_json",
      JSON.stringify(
        items
          .filter((it) => it.drug_name.trim() !== "")
          .map((it) => ({
            drug_name: it.drug_name.trim(),
            dose: it.dose?.trim() || null,
            frequency: it.frequency?.trim() || null,
            duration: it.duration?.trim() || null,
            instructions: it.instructions?.trim() || null,
            medicine_sku: it.medicine_sku,
          })),
      ),
    );
    fd.set(
      "lab_tests_json",
      JSON.stringify(
        labs
          .filter((t) => t.test_name.trim() !== "")
          .map((t) => ({
            test_name: t.test_name.trim(),
            instructions: t.instructions?.trim() || null,
            lab_test_id: t.lab_test_id, // M027: catalog FK, null for free-text
          })),
      ),
    );
    return fd;
  }, [
    mode,
    patientName,
    patientAge,
    patientSex,
    patientWeight,
    bpSys,
    bpDia,
    pulse,
    spo2,
    tempC,
    heightCm,
    chiefComplaint,
    diagnosis,
    advice,
    followUp,
    items,
    labs,
  ]);

  const handleSave = useCallback(() => {
    if (mode.kind !== "ready") return;
    setSaveError(null);
    setSaveOk(false);
    setSendResult(null);
    startSave(async () => {
      try {
        await updatePrescriptionDraft(buildFormData());
        setSaveOk(true);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Could not save draft.");
      }
    });
  }, [mode, buildFormData]);

  const handleSend = useCallback(() => {
    if (mode.kind !== "ready") return;
    setSaveError(null);
    setSaveOk(false);
    setSendResult(null);
    startSend(async () => {
      try {
        // Save first so the row reflects current edits, then send.
        await updatePrescriptionDraft(buildFormData());
        const fd = new FormData();
        fd.set("prescription_id", mode.initial.prescription_id);
        const result = await sendPrescription(fd);
        setSendResult(result);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Could not send Rx.");
      }
    });
  }, [mode, buildFormData]);

  // ---------- Render ---------------------------------------------------
  if (!open) return null;

  return (
    <aside
      role="dialog"
      aria-label="In-call Rx composer"
      // Filled by the DutyRoomEmbed flex container (right 40% in the
      // in-call modal). We layout as a vertical column with a sticky
      // header + footer so the body content scrolls inside the drawer
      // while the action bar stays visible.
      className="relative w-full h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            New Prescription
          </div>
          {mode.kind === "ready" ? (
            <div className="text-sm font-semibold text-slate-900 truncate">
              {mode.session.patient_name}
              {mode.session.booking_code ? (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  · {mode.session.booking_code}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="text-sm font-semibold text-slate-900">
              Composer
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close composer"
          className="rounded-lg p-1.5 hover:bg-slate-100"
        >
          <X className="w-4 h-4 text-slate-600" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {mode.kind === "loading" && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading composer…
          </div>
        )}

        {mode.kind === "no-active-session" && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            <div className="font-semibold mb-1">No patient in consult yet</div>
            <div className="text-xs text-amber-800">
              Once a patient joins your Duty Room, reopen this drawer to
              compose their prescription. The drawer always attaches the
              Rx to the most recently joined patient.
            </div>
          </div>
        )}

        {mode.kind === "error" && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-900">
            <div className="font-semibold mb-1">Could not open composer</div>
            <div className="text-xs">{mode.error}</div>
          </div>
        )}

        {mode.kind === "ready" && (
          <>
            <CodeStrip
              code={mode.initial.prescription_code}
              version={mode.initial.version}
            />

            {/* Patient block */}
            <Section title="Patient">
              <div className="grid grid-cols-2 gap-2">
                <FormField label="Full name">
                  <input
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    required
                    className={inputCls()}
                  />
                </FormField>
                <FormField label="Age">
                  <input
                    inputMode="numeric"
                    value={patientAge}
                    onChange={(e) => setPatientAge(e.target.value)}
                    className={inputCls()}
                  />
                </FormField>
                <FormField label="Sex">
                  <select
                    value={patientSex}
                    onChange={(e) =>
                      setPatientSex(
                        e.target.value as "M" | "F" | "O" | "U" | "",
                      )
                    }
                    className={inputCls()}
                  >
                    <option value="">—</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                    <option value="U">Unspecified</option>
                  </select>
                </FormField>
                <FormField label="Weight (kg)">
                  <input
                    inputMode="decimal"
                    value={patientWeight}
                    onChange={(e) => setPatientWeight(e.target.value)}
                    className={inputCls()}
                  />
                </FormField>
              </div>
            </Section>

            {/* Vitals (6) */}
            <Section title="Vitals">
              <div className="grid grid-cols-2 gap-2">
                <FormField label="BP systolic (mmHg)">
                  <input
                    inputMode="numeric"
                    value={bpSys}
                    onChange={(e) => setBpSys(e.target.value)}
                    placeholder="120"
                    className={inputCls()}
                  />
                </FormField>
                <FormField label="BP diastolic (mmHg)">
                  <input
                    inputMode="numeric"
                    value={bpDia}
                    onChange={(e) => setBpDia(e.target.value)}
                    placeholder="80"
                    className={inputCls()}
                  />
                </FormField>
                <FormField label="Pulse (bpm)">
                  <input
                    inputMode="numeric"
                    value={pulse}
                    onChange={(e) => setPulse(e.target.value)}
                    placeholder="78"
                    className={inputCls()}
                  />
                </FormField>
                <FormField label="SpO₂ (%)">
                  <input
                    inputMode="numeric"
                    value={spo2}
                    onChange={(e) => setSpo2(e.target.value)}
                    placeholder="98"
                    className={inputCls()}
                  />
                </FormField>
                <FormField label="Temp (°C)">
                  <input
                    inputMode="decimal"
                    value={tempC}
                    onChange={(e) => setTempC(e.target.value)}
                    placeholder="37.0"
                    className={inputCls()}
                  />
                </FormField>
                <FormField label="Height (cm)">
                  <input
                    inputMode="decimal"
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    placeholder="165"
                    className={inputCls()}
                  />
                </FormField>
              </div>
            </Section>

            {/* Clinical */}
            <Section title="Clinical">
              <FormField label="Chief complaint">
                <textarea
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  rows={2}
                  className={inputCls()}
                />
              </FormField>
              <FormField label="Provisional diagnosis">
                <textarea
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  rows={2}
                  className={inputCls()}
                />
              </FormField>
            </Section>

            {/* Medications */}
            <Section
              title="Medications"
              right={
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md"
                >
                  <Plus className="w-3 h-3" />
                  Row
                </button>
              }
            >
              {items.map((it) => (
                <div
                  key={it.ordinal}
                  className="border border-slate-200 rounded-lg p-2 mb-2"
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      #{it.ordinal}
                    </span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(it.ordinal)}
                        aria-label={`Remove medication ${it.ordinal}`}
                        className="text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <DrugAutocomplete
                    value={it.drug_name}
                    onChange={(v) => updateItem(it.ordinal, "drug_name", v)}
                    onPickCatalog={(p) => onPickCatalog(it.ordinal, p)}
                    label="Drug"
                  />
                  {it.composition && (
                    <div className="text-[11px] italic text-slate-500 mt-1">
                      {it.composition}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <FormField label="Dose">
                      <input
                        value={it.dose ?? ""}
                        onChange={(e) =>
                          updateItem(it.ordinal, "dose", e.target.value)
                        }
                        placeholder="1 tab"
                        className={inputCls()}
                      />
                    </FormField>
                    <FormField label="Frequency">
                      <input
                        value={it.frequency ?? ""}
                        onChange={(e) =>
                          updateItem(it.ordinal, "frequency", e.target.value)
                        }
                        placeholder="BD / TDS / STAT"
                        className={inputCls()}
                      />
                    </FormField>
                    <FormField label="Duration">
                      <input
                        value={it.duration ?? ""}
                        onChange={(e) =>
                          updateItem(it.ordinal, "duration", e.target.value)
                        }
                        placeholder="5 days"
                        className={inputCls()}
                      />
                    </FormField>
                    <FormField label="Notes">
                      <input
                        value={it.instructions ?? ""}
                        onChange={(e) =>
                          updateItem(it.ordinal, "instructions", e.target.value)
                        }
                        placeholder="after meals"
                        className={inputCls()}
                      />
                    </FormField>
                  </div>
                </div>
              ))}
            </Section>

            {/* Lab tests */}
            <Section
              title="Investigations Advised"
              right={
                <button
                  type="button"
                  onClick={addLab}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md"
                >
                  <Plus className="w-3 h-3" />
                  Row
                </button>
              }
            >
              {labs.length === 0 ? (
                <div className="text-xs italic text-slate-500 px-1 py-2">
                  No investigations advised. Add a row to request one.
                </div>
              ) : (
                labs.map((t) => (
                  <div
                    key={t.ordinal}
                    className="border border-slate-200 rounded-lg p-2 mb-2"
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                        #{t.ordinal}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLab(t.ordinal)}
                        aria-label={`Remove lab test ${t.ordinal}`}
                        className="text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <LabTestAutocomplete
                      value={t.test_name}
                      onChange={(v) => updateLab(t.ordinal, "test_name", v)}
                      onPickCatalog={(p) => onPickLabCatalog(t.ordinal, p)}
                      label="Test"
                    />
                    {t.lab_test_id && (t.catalog_category || t.catalog_code || t.catalog_price_paise != null) && (
                      <div className="text-[11px] italic text-slate-500 mt-1">
                        {[
                          t.catalog_category,
                          t.catalog_code ? (
                            <span className="font-mono not-italic" key="code">
                              {t.catalog_code}
                            </span>
                          ) : null,
                          formatPaiseAsRupees(t.catalog_price_paise),
                        ]
                          .filter(Boolean)
                          .reduce<React.ReactNode[]>((acc, part, idx) => {
                            if (idx > 0) acc.push(" · ");
                            acc.push(part);
                            return acc;
                          }, [])}
                      </div>
                    )}
                    <FormField label="Instructions">
                      <input
                        value={t.instructions ?? ""}
                        onChange={(e) =>
                          updateLab(t.ordinal, "instructions", e.target.value)
                        }
                        placeholder="Fasting, morning sample, etc."
                        className={inputCls()}
                      />
                    </FormField>
                  </div>
                ))
              )}
            </Section>

            {/* Advice / Follow-up */}
            <Section title="Advice &amp; Follow-up">
              <FormField label="General advice (one bullet per line)">
                <textarea
                  value={advice}
                  onChange={(e) => setAdvice(e.target.value)}
                  rows={3}
                  className={inputCls()}
                />
              </FormField>
              <FormField label="Follow-up">
                <textarea
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  rows={2}
                  className={inputCls()}
                />
              </FormField>
            </Section>
          </>
        )}
      </div>

      {/* Footer */}
      {mode.kind === "ready" && (
        <div className="sticky bottom-0 z-10 bg-white border-t border-slate-200 px-4 py-3 space-y-2">
          {saveError && (
            <div className="flex items-start gap-2 text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-lg p-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {saveError}
            </div>
          )}
          {saveOk && !sendResult && (
            <div className="flex items-center gap-2 text-emerald-700 text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Draft saved.
            </div>
          )}
          {sendResult && sendResult.ok && (
            <SendOkCard data={sendResult.data} />
          )}
          {sendResult && !sendResult.ok && (
            <div className="flex items-start gap-2 text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-lg p-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {sendResult.error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={savePending || sendPending}
              className={classNames(
                "flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg",
                "bg-slate-100 hover:bg-slate-200 text-slate-900",
                (savePending || sendPending) && "opacity-60 cursor-wait",
              )}
            >
              {savePending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save draft
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={savePending || sendPending}
              className={classNames(
                "flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg",
                "bg-slate-900 hover:bg-slate-800 text-white",
                (savePending || sendPending) && "opacity-60 cursor-wait",
              )}
            >
              {sendPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Send Rx
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

// ---- Inline sub-components -------------------------------------------

function CodeStrip({ code, version }: { code: string; version: number }) {
  return (
    <div className="rounded-xl bg-slate-900 text-white px-3 py-2 flex items-center justify-between text-xs">
      <div className="font-mono">{code}</div>
      <div className="text-slate-300">
        {version > 1 ? `v${version} (amendment)` : "v1"} · draft
      </div>
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-xs uppercase tracking-wider text-slate-700 font-semibold">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-1.5">
      <span className="block text-[11px] text-slate-600 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function inputCls() {
  return "w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent";
}

function SendOkCard({ data }: { data: SendOk }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard.writeText(data.rx_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-900">
      <div className="flex items-center gap-1.5 font-semibold mb-1">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Sent · {data.prescription_code}
      </div>
      <div className="mb-1.5">
        {data.whatsapp_sent
          ? "WhatsApp delivered. Patient can also open the link below."
          : "PDF saved. WhatsApp delivery failed — share the link manually."}
      </div>
      <div className="flex items-center gap-1">
        <code className="flex-1 text-[10px] font-mono bg-white border border-emerald-200 rounded px-1.5 py-1 truncate">
          {data.rx_url}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="bg-white border border-emerald-200 rounded p-1 hover:bg-emerald-100"
          aria-label="Copy URL"
        >
          {copied ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
          ) : (
            <Copy className="w-3 h-3 text-emerald-700" />
          )}
        </button>
        <a
          href={data.rx_url}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white border border-emerald-200 rounded p-1 hover:bg-emerald-100"
          aria-label="Open URL"
        >
          <ExternalLink className="w-3 h-3 text-emerald-700" />
        </a>
      </div>
    </div>
  );
}
