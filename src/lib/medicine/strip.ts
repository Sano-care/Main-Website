// Strip-photo vision — read the printed text off a medicine strip/box.
//
// STORE ONLY: extracts brand + composition + strength as printed. Never
// diagnoses, never infers a use, never comments on dose suitability. Uses the
// single vision seam (client.generateVisionJson) on Sonnet (D4 — accuracy).

import { generateVisionJson } from "@/lib/agent/client";
import { MODEL_COMPLEX } from "@/lib/agent/config";

export interface StripReadResult {
  ok: boolean;
  brand: string | null;
  composition: string | null;
  strength: string | null;
}

const STRIP_SYSTEM =
  "You transcribe the printed text from a photo of a medicine strip or box. " +
  "You are NOT a clinician: never diagnose, never infer what the medicine is for, " +
  "never comment on dose or safety. Read only what is printed. Output strict JSON.";

const STRIP_INSTRUCTION =
  "Read this medicine strip/box photo and extract the printed BRAND NAME, the " +
  "COMPOSITION (active salts with their strengths), and the primary STRENGTH. " +
  "If it is not a medicine strip/box, or the text is unreadable, set ok=false. " +
  'Respond with ONLY this JSON (no prose): {"ok": true|false, "brand": string|null, ' +
  '"composition": string|null, "strength": string|null}';

export interface StripDeps {
  visionFn?: typeof generateVisionJson;
  model?: string;
}

export async function readMedicineStrip(
  image: { bytes: Uint8Array; mimeType: string },
  deps: StripDeps = {},
): Promise<StripReadResult> {
  const visionFn = deps.visionFn ?? generateVisionJson;
  const model = deps.model ?? MODEL_COMPLEX; // Sonnet
  try {
    const { text } = await visionFn({
      model,
      system: STRIP_SYSTEM,
      userText: STRIP_INSTRUCTION,
      image,
      maxTokens: 400,
    });
    return parseStripJson(text);
  } catch (e) {
    console.error("[readMedicineStrip] vision call failed:", e);
    return { ok: false, brand: null, composition: null, strength: null };
  }
}

export function parseStripJson(text: string): StripReadResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, brand: null, composition: null, strength: null };
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    const brand = cleanField(o.brand);
    const composition = cleanField(o.composition);
    // ok only if the model said so AND we actually got a brand to work with.
    return {
      ok: Boolean(o.ok) && brand !== null,
      brand,
      composition,
      strength: cleanField(o.strength),
    };
  } catch {
    return { ok: false, brand: null, composition: null, strength: null };
  }
}

function cleanField(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.toLowerCase() !== "null" ? s : null;
}
