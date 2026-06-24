// Aarogya media + vision foundation — Consumer 0: patient photo acknowledgment.
//
// Fixes the live pain: a patient sends a medicine image / prescription / report
// and Aarogya ignored it (non-text was dropped). Now: fetch → ONE vision call
// (characterise, never interpret) → a compliant acknowledgment. Storage-light —
// download, analyze, reply, discard. NEVER reads clinical content (D&MR + MoHFW).

import { fetchInboundMedia, mediaRefFromRaw } from "@/lib/whatsapp/media";
import { analyzeImage, type VisionResult } from "@/lib/agent/vision";
import type { Identity } from "@/lib/whatsapp/identity";

/** Patients only: a new visitor or a customer (registered/carehub are customer
 *  sub-roles). Doctors / medics / ops never hit this consumer. */
export function isPatientRole(identity: Identity): boolean {
  return identity.role === "customer" || identity.role === "new";
}

const CHARACTERISE_PROMPT =
  'Classify the image as exactly one of: "medicine" (a medicine strip, blister, box, or bottle), ' +
  '"prescription" (a doctor\'s prescription), "report" (a lab or medical report), or "other" ' +
  "(anything else). Do NOT read, transcribe, or interpret any text, values, dosages, or medical " +
  'content. Return JSON ONLY: {"type": "medicine"|"prescription"|"report"|"other", ' +
  '"confidence": 0..1, "fields": {"document_type": "<short non-clinical label, or null>"}}.';

const FETCH_FALLBACK_REPLY =
  "I got your photo but couldn't open it — could you resend it, or just tell me what you need?";
const ANALYZE_FALLBACK_REPLY =
  "I got your photo but couldn't process it just now — want me to set up a teleconsult, or tell me what you need?";

/** Compose the compliant, non-interpreting acknowledgment for a verdict. Pure. */
export function composePhotoAck(result: VisionResult): string {
  const docType =
    typeof result.fields?.document_type === "string" && result.fields.document_type.trim()
      ? result.fields.document_type.trim()
      : null;
  switch (result.type) {
    case "medicine":
      return "I can see that's a medicine — I can't read medical details over chat, but I can set up a doctor consult, or log it to your Pulse meds. Which would you like?";
    case "prescription":
    case "report":
      return `Got your ${docType ?? (result.type === "report" ? "report" : "prescription")}. I can't interpret it here — want a teleconsult to go over it?`;
    default:
      return "That doesn't look like something I can help with — send a prescription, report, or just describe what you need and I'll take it from there.";
  }
}

export interface PhotoConsumerDeps {
  fetchMedia?: typeof fetchInboundMedia;
  analyze?: typeof analyzeImage;
}

export interface PhotoConsumerOutcome {
  /** false only when the raw message carried no usable media ref. */
  handled: boolean;
  reply: string | null;
  /** The vision verdict type, or null when fetch/analyze didn't run. */
  visionType: string | null;
  reason?: string;
}

/**
 * Run the patient photo flow for one inbound image/document. Exactly one media
 * fetch and (at most) one vision call. Never throws — fetch/analyze failures
 * degrade to a safe, non-clinical acknowledgment so the patient is never
 * silently ignored.
 */
export async function runPatientPhotoConsumer(
  args: { raw: unknown },
  deps: PhotoConsumerDeps = {},
): Promise<PhotoConsumerOutcome> {
  const fetchMedia = deps.fetchMedia ?? fetchInboundMedia;
  const analyze = deps.analyze ?? analyzeImage;

  const ref = mediaRefFromRaw(args.raw);
  if (!ref) return { handled: false, reply: null, visionType: null, reason: "no_media_ref" };

  const media = await fetchMedia(ref.mediaId);
  if (!media.ok) {
    return { handled: true, reply: FETCH_FALLBACK_REPLY, visionType: null, reason: media.reason };
  }

  let result: VisionResult;
  try {
    result = await analyze({
      bytes: media.bytes,
      mimeType: media.mimeType,
      taskPrompt: CHARACTERISE_PROMPT,
    });
  } catch {
    return { handled: true, reply: ANALYZE_FALLBACK_REPLY, visionType: null, reason: "analyze_failed" };
  }

  return { handled: true, reply: composePhotoAck(result), visionType: result.type };
}
