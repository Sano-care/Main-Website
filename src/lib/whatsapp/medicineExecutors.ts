// Medicine resolver executors — catalogue → web → strip-photo, all converging
// on ONE confirmed canonical medicine that the model then logs via
// log_medication (#112, the single createMedication writer). STORE/IDENTIFY
// ONLY: nothing here advises on the drug, dose, or interactions.

import { fetchInboundMedia } from "@/lib/whatsapp/media";
import {
  resolveMedicineCatalog,
  classifyCandidates,
  type MedicineCandidate,
} from "@/lib/medicine/resolve";
import { readMedicineStrip } from "@/lib/medicine/strip";
import { lookupMedicineWeb } from "@/lib/medicine/web";
import { addPendingMedicine } from "@/lib/medicine/catalogGrow";
import { AuditEvent, writeAudit, type AuditIdentity } from "@/lib/whatsapp/safety/audit";
import { identityForAudit, type Identity } from "@/lib/whatsapp/identity";

function customerIdOf(identity: Identity): string | null {
  if (identity.role !== "customer" || !("customerId" in identity) || !identity.customerId) {
    return null;
  }
  return identity.customerId;
}

/** "Shelcal 500 (Calcium Carbonate + Vitamin D3)" */
function describe(c: MedicineCandidate): string {
  const head = [c.brand_name, c.strength].filter(Boolean).join(" ");
  return c.composition ? `${head} (${c.composition})` : head;
}

const ASK_FOR_STRIP =
  "Could you send me a clear photo of the medicine strip or box? I'll read the exact name off it.";

// ---------------------------------------------------------------------------
// resolve_medicine
// ---------------------------------------------------------------------------

export async function executeResolveMedicine(args: {
  identity: Identity;
  conversationId: string;
  input: { query?: string };
  deps?: {
    resolveFn?: typeof resolveMedicineCatalog;
    writeAuditFn?: typeof writeAudit;
  };
}): Promise<string> {
  const query = (args.input.query ?? "").trim();
  if (query.length < 2) return "Which medicine should I set the reminder for?";

  const resolveFn = args.deps?.resolveFn ?? resolveMedicineCatalog;
  const writeAuditFn = args.deps?.writeAuditFn ?? writeAudit;
  const auditIdentity: AuditIdentity = identityForAudit(args.identity);

  const candidates = await resolveFn(query);
  const outcome = classifyCandidates(candidates);

  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.MEDICINE_RESOLVED,
    identity: auditIdentity,
    eventData: { query, outcome: outcome.kind, top: outcome.kind === "confident" ? outcome.top.brand_name : null },
  });

  if (outcome.kind === "confident") {
    return `I've got ${describe(outcome.top)}. Shall I set your reminder for that? (If it's a different medicine, send me a photo of the strip.)`;
  }
  if (outcome.kind === "ambiguous") {
    const list = outcome.candidates.map((c, i) => `${i + 1}. ${describe(c)}`).join("\n");
    return `I found a few that look close — which one?\n${list}\n\nIf none of these match, send me a photo of the strip and I'll read it.`;
  }
  return `I couldn't match "${query}" to our list. ${ASK_FOR_STRIP}`;
}

// ---------------------------------------------------------------------------
// lookup_medicine_web (fallback, gated — inert until a D2 source is wired)
// ---------------------------------------------------------------------------

export async function executeLookupMedicineWeb(args: {
  identity: Identity;
  conversationId: string;
  input: { query?: string };
  deps?: {
    lookupFn?: typeof lookupMedicineWeb;
    writeAuditFn?: typeof writeAudit;
  };
}): Promise<string> {
  const query = (args.input.query ?? "").trim();
  if (query.length < 2) return "Which medicine should I look up?";

  const lookupFn = args.deps?.lookupFn ?? lookupMedicineWeb;
  const writeAuditFn = args.deps?.writeAuditFn ?? writeAudit;

  const result = await lookupFn(query);
  if (!result.available) {
    // No source wired / disabled → degrade to the strip-photo path (never guess).
    return `I can't verify that one online just now. ${ASK_FOR_STRIP}`;
  }

  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.MEDICINE_WEB_VERIFIED,
    identity: identityForAudit(args.identity),
    eventData: { query, proposed: result.proposed_brand ?? null, confidence: result.confidence ?? null },
  });

  const comp = result.composition ? ` (${result.composition})` : "";
  return `I found ${result.proposed_brand}${comp} — does your strip say that? I'll only set the reminder once you confirm (or send me a photo of the strip).`;
}

// ---------------------------------------------------------------------------
// read_medicine_strip (vision — Sonnet)
// ---------------------------------------------------------------------------

export async function executeReadMedicineStrip(args: {
  identity: Identity;
  conversationId: string;
  /** Adapter-extracted from the inbound message (mediaRefFromRaw). */
  media: { mediaId: string; mime: string | null } | null;
  deps?: {
    fetchMediaFn?: typeof fetchInboundMedia;
    readStripFn?: typeof readMedicineStrip;
    resolveFn?: typeof resolveMedicineCatalog;
    addPendingFn?: typeof addPendingMedicine;
    writeAuditFn?: typeof writeAudit;
  };
}): Promise<string> {
  if (!args.media?.mediaId) return ASK_FOR_STRIP;

  const fetchMediaFn = args.deps?.fetchMediaFn ?? fetchInboundMedia;
  const readStripFn = args.deps?.readStripFn ?? readMedicineStrip;
  const resolveFn = args.deps?.resolveFn ?? resolveMedicineCatalog;
  const addPendingFn = args.deps?.addPendingFn ?? addPendingMedicine;
  const writeAuditFn = args.deps?.writeAuditFn ?? writeAudit;
  const auditIdentity: AuditIdentity = identityForAudit(args.identity);
  const customerId = customerIdOf(args.identity);

  const media = await fetchMediaFn(args.media.mediaId);
  if (!media.ok) {
    return "I couldn't open that image — could you resend a clear photo of the medicine strip?";
  }

  const strip = await readStripFn({ bytes: media.bytes, mimeType: media.mimeType });

  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.MEDICINE_PHOTO_READ,
    identity: auditIdentity,
    eventData: { ok: strip.ok, brand: strip.brand, has_composition: Boolean(strip.composition) },
  });

  if (!strip.ok || !strip.brand) {
    return "I couldn't make out the medicine name from that photo — could you send a clearer one in good light, with the brand name visible?";
  }

  // Match the printed brand against the catalogue.
  const candidates = await resolveFn(strip.brand);
  const outcome = classifyCandidates(candidates);
  if (outcome.kind === "confident") {
    return `Got it — that's ${describe(outcome.top)}. Shall I set your reminder for it?`;
  }
  if (outcome.kind === "ambiguous") {
    const list = outcome.candidates.map((c, i) => `${i + 1}. ${describe(c)}`).join("\n");
    return `I read "${strip.brand}" off the strip. Closest matches:\n${list}\n\nWhich one, or shall I just use "${strip.brand}"?`;
  }

  // Not in the catalogue — the strip IS the source of truth. Grow the catalogue
  // (pending ops review; invisible to the doctor search) and use the read name.
  if (strip.composition) {
    const grown = await addPendingFn({
      brandName: strip.brand,
      composition: strip.composition,
      strength: strip.strength,
      form: null,
      source: "aarogya_strip",
      customerId,
      verifiedSource: "strip_photo",
    });
    if (grown.added) {
      await writeAuditFn({
        conversationId: args.conversationId,
        eventType: AuditEvent.MEDICINE_CATALOG_ADDED,
        identity: auditIdentity,
        eventData: { brand: strip.brand, source: "aarogya_strip", catalog_id: grown.id },
      });
    }
  }
  const comp = strip.composition ? ` (${strip.composition})` : "";
  return `I read ${strip.brand}${comp} off your strip. Shall I set your reminder for ${strip.brand}?`;
}
