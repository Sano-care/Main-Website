// Patient photo & PDF interpretation — consumer orchestration.
//
// Media turn:  fetch → classify → identity gate → safe ack / refuse, and (for a
//   genuine medical doc on a real account) ASK to save + stash a pending record.
// Confirm turn: the patient's YES/NO to that ask → file to the vault (consented,
//   never silent) or discard.
//
// Hard rules enforced here: never interpret contents (only category + decision
// flow); never store a name-mismatch; never store without an explicit YES; scope
// every write to the sender's customer_id; member attribution only from the
// patient's own words.

import { fetchInboundMedia, mediaRefFromRaw } from "@/lib/whatsapp/media";
import {
  classifyPatientMedia,
  assessOwnership,
  memberFromText,
  isFileableMedical,
  composeSaveAsk,
  NON_MEDICAL_REPLY,
  UNCLEAR_REPLY,
  ANOMALY_REPLY,
  NON_PDF_DOC_REPLY,
  docTypeLabel,
  type MediaClassification,
  type OwnerInfo,
  type MemberInfo,
} from "@/lib/whatsapp/patientMedia";
import { uploadToPulseVault } from "@/lib/pulse/documentVault";
import { AuditEvent, type AuditEventType } from "@/lib/whatsapp/safety/audit";
import type { Identity } from "@/lib/whatsapp/identity";

export interface PendingDoc {
  mediaId: string;
  mimeType: string;
  category: string;
  docType: string;
  customerId: string;
}

export interface AuditLine {
  event: AuditEventType;
  data: Record<string, unknown>;
}

export interface MediaTurnResult {
  /** false only when there was no usable media ref (caller falls through). */
  handled: boolean;
  reply: string | null;
  audits: AuditLine[];
  /** Set when a genuine medical doc is awaiting the patient's save confirmation. */
  pending?: PendingDoc;
}

export interface MediaConsumerDeps {
  fetchMedia?: typeof fetchInboundMedia;
  classify?: typeof classifyPatientMedia;
  loadOwner?: (customerId: string) => Promise<{ owner: OwnerInfo; members: MemberInfo[] }>;
}

/** customerId for a customer identity, else null (new visitor has no vault). */
function customerIdOf(identity: Identity): string | null {
  return identity.role === "customer" && "customerId" in identity && identity.customerId
    ? identity.customerId
    : null;
}

export async function runPatientMediaTurn(
  args: { raw: unknown; identity: Identity },
  deps: MediaConsumerDeps = {},
): Promise<MediaTurnResult> {
  const fetchMedia = deps.fetchMedia ?? fetchInboundMedia;
  const classify = deps.classify ?? classifyPatientMedia;

  const ref = mediaRefFromRaw(args.raw);
  if (!ref) return { handled: false, reply: null, audits: [] };

  const media = await fetchMedia(ref.mediaId);
  if (!media.ok) {
    // mime_not_allowed (.docx etc.) / too_large → guarded refusal, NO vision call.
    const reply =
      media.reason?.startsWith("mime_not_allowed") || media.reason === "too_large"
        ? NON_PDF_DOC_REPLY
        : "I got your file but couldn't open it — could you resend it?";
    return {
      handled: true,
      reply,
      audits: [{ event: AuditEvent.PATIENT_PHOTO_REJECTED, data: { reason: media.reason } }],
    };
  }

  let cls: MediaClassification;
  try {
    cls = await classify(media.bytes, media.mimeType);
  } catch {
    return {
      handled: true,
      reply: "I got your file but couldn't process it just now — want a teleconsult, or tell me what you need?",
      audits: [{ event: AuditEvent.PATIENT_PHOTO_REJECTED, data: { reason: "classify_failed" } }],
    };
  }

  const audits: AuditLine[] = [
    { event: AuditEvent.PATIENT_PHOTO_RECEIVED, data: { category: cls.category, mime: media.mimeType } },
  ];

  if (cls.category === "non_medical") {
    return { handled: true, reply: NON_MEDICAL_REPLY, audits };
  }
  if (cls.category === "unclear") {
    return { handled: true, reply: UNCLEAR_REPLY, audits };
  }
  if (!isFileableMedical(cls.category)) {
    return { handled: true, reply: NON_MEDICAL_REPLY, audits };
  }

  const customerId = customerIdOf(args.identity);
  if (!customerId) {
    // New visitor — characterise + acknowledge, but no vault to file into (D6).
    return {
      handled: true,
      reply: `Got it — looks like a ${docTypeLabel(cls.category)} 📄. Once your Sanocare account is set up I can keep it safe for you. For now, is there something I can help you book?`,
      audits,
    };
  }

  // Identity / anomaly gate (D3) — load the owner + family members.
  const { owner, members } = deps.loadOwner
    ? await deps.loadOwner(customerId)
    : { owner: { fullName: null }, members: [] };
  const ownership = assessOwnership(cls.visiblePersonName, owner, members);
  if (ownership.anomaly) {
    return {
      handled: true,
      reply: ANOMALY_REPLY,
      audits: [
        ...audits,
        { event: AuditEvent.PATIENT_PHOTO_REJECTED, data: { reason: "identity_anomaly" } },
      ],
    };
  }

  // Genuine medical doc on this account → ASK before storing (D1, no silent storage).
  return {
    handled: true,
    reply: composeSaveAsk(cls.category),
    audits,
    pending: {
      mediaId: ref.mediaId,
      mimeType: media.mimeType,
      category: cls.category,
      docType: cls.category,
      customerId,
    },
  };
}

// ── Consent confirmation (the YES/NO turn) ───────────────────────────────────
export type SaveIntent = "yes" | "no" | "unclear";

/** Deterministic YES/NO read (EN + common HI). Ambiguous → "unclear" → we do
 *  NOT store (safe default; DPDP). */
export function detectSaveIntent(text: string): SaveIntent {
  const t = text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = new Set(t.split(" "));
  // Whole-word token match (avoids short-word substring false positives like
  // "ya"/"no" matching inside other words); multi-word phrases checked explicitly.
  const yesWords = ["yes", "yeah", "yep", "ya", "sure", "ok", "okay", "save", "haan", "han", "ji", "theek", "kardo", "krdo"];
  const noWords = ["no", "nope", "nahi", "nahin", "dont", "skip", "cancel", "mat"];
  const hasYes = yesWords.some((w) => tokens.has(w)) || t.includes("save it");
  const hasNo = noWords.some((w) => tokens.has(w)) || t.includes("do not");
  if (hasNo && !hasYes) return "no";
  if (hasYes && !hasNo) return "yes";
  return "unclear";
}

export interface ConfirmResult {
  handled: boolean;
  reply: string | null;
  audits: AuditLine[];
}

export interface ConfirmDeps {
  /** The ONE canonical vault writer (#97). Injectable for tests. */
  upload?: typeof uploadToPulseVault;
  loadMembers?: (customerId: string) => Promise<MemberInfo[]>;
}

/**
 * Resolve a pending save against the patient's reply. YES → file via the single
 * canonical writer uploadToPulseVault (#97) — which re-fetches the media by id,
 * guards mime/size, uploads + inserts pulse_documents (source='whatsapp_aarogya')
 * + emits PULSE_VAULT_UPLOADED. We add the consumer-flow PATIENT_PHOTO_FILED
 * event on top. NO/unclear → don't store (no silent storage; DPDP).
 */
export async function confirmPendingSave(
  args: { pending: PendingDoc; text: string; identity: Identity; members?: MemberInfo[] },
  deps: ConfirmDeps = {},
): Promise<ConfirmResult> {
  const intent = detectSaveIntent(args.text);
  if (intent === "no") {
    return {
      handled: true,
      reply: "No problem — I won't save it. Tell me if there's anything else.",
      audits: [{ event: AuditEvent.PATIENT_PHOTO_REJECTED, data: { reason: "declined_by_patient" } }],
    };
  }
  if (intent === "unclear") {
    // Don't store on ambiguity; let the normal flow handle the message.
    return { handled: false, reply: null, audits: [] };
  }

  const upload = deps.upload ?? uploadToPulseVault;

  // Member attribution from the patient's OWN words only (D2); else Self.
  const members = args.members ?? (deps.loadMembers ? await deps.loadMembers(args.pending.customerId) : []);
  const memberId = memberFromText(args.text, members);

  const result = await upload({
    identity: args.identity,
    media: { mediaId: args.pending.mediaId, mime: args.pending.mimeType },
    docType: args.pending.docType,
    memberId,
  });
  if (!result.ok) {
    return {
      handled: true,
      reply: result.message,
      audits: [{ event: AuditEvent.PATIENT_PHOTO_REJECTED, data: { reason: `file_${result.reason}` } }],
    };
  }

  return {
    handled: true,
    reply: result.message,
    audits: [
      {
        event: AuditEvent.PATIENT_PHOTO_FILED,
        data: { doc_id: result.documentId, doc_type: args.pending.docType, member_id: memberId },
      },
    ],
  };
}
