// Aarogya media + vision foundation — the vision primitive.
//
// analyzeImage runs ONE focused vision call and returns a structured verdict
// { type, confidence, fields }. JSON-only output, parsed defensively (a model
// that wraps JSON in prose or returns garbage still yields a safe verdict).
// Exactly one model call per invocation — the cost guard the brief requires.
//
// The SYSTEM prompt is deliberately CHARACTERISE-not-interpret: classify what
// kind of thing the image is; never read clinical content (D&MR + MoHFW).

import { generateVisionJson, type VisionRequest } from "@/lib/agent/client";
import { MODEL_DEFAULT } from "@/lib/agent/config";

const VISION_MAX_TOKENS = 300;

const VISION_SYSTEM = `You are an image classifier for a healthcare chat assistant. You CHARACTERISE images — you NEVER read, transcribe, or interpret clinical content (no dosages, diagnoses, lab values, medicine names, or any medical detail). Output JSON ONLY, no prose, no code fences.`;

export interface VisionResult {
  /** Coarse category, lower-cased. Unknown/unsafe input → "other". */
  type: string;
  /** 0..1 model confidence; 0 when unparseable. */
  confidence: number;
  /** Extra non-clinical descriptors (e.g. document_type). */
  fields: Record<string, unknown>;
}

export interface AnalyzeImageArgs {
  bytes: Uint8Array;
  mimeType: string;
  /** The characterise instruction; the consumer supplies the category set. */
  taskPrompt: string;
  /** Optional model override; defaults to the cheap vision-capable default. */
  model?: string;
}

export async function analyzeImage(
  args: AnalyzeImageArgs,
  deps: { call?: (req: VisionRequest) => Promise<{ text: string }> } = {},
): Promise<VisionResult> {
  const call = deps.call ?? generateVisionJson;
  const { text } = await call({
    model: args.model ?? MODEL_DEFAULT,
    system: VISION_SYSTEM,
    userText: args.taskPrompt,
    image: { bytes: args.bytes, mimeType: args.mimeType },
    maxTokens: VISION_MAX_TOKENS,
  });
  return parseVerdict(text);
}

/**
 * Pull the first JSON object out of the model text and coerce it to a
 * VisionResult. Any failure → a safe { type:"other", confidence:0 } verdict so
 * a consumer never crashes on a malformed reply.
 */
export function parseVerdict(text: string): VisionResult {
  const safe: VisionResult = { type: "other", confidence: 0, fields: {} };
  if (!text) return safe;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return safe;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return safe;
  }
  const rawType = obj.type ?? obj.category;
  const type =
    typeof rawType === "string" && rawType.trim() ? rawType.trim().toLowerCase() : "other";
  let confidence = 0;
  if (typeof obj.confidence === "number" && Number.isFinite(obj.confidence)) {
    confidence = Math.min(1, Math.max(0, obj.confidence));
  }
  const fields =
    obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields)
      ? (obj.fields as Record<string, unknown>)
      : // Fall back to any non-type/confidence keys as fields.
        Object.fromEntries(
          Object.entries(obj).filter(([k]) => k !== "type" && k !== "category" && k !== "confidence"),
        );
  return { type, confidence, fields };
}
