// Anthropic tool (function-calling) schemas for Aarogya. Plain JSON-Schema
// objects — no SDK import — so this file is bundler/runtime agnostic. The
// orchestrator passes these as `tools`; the adapter layer validates + executes
// the model's tool_use blocks.
//
// Field set is aligned to the aarogya_lead_alert WhatsApp template
// (patient_name, patient_age, service display, location, context, mobile) so an
// escalate_to_ops call maps 1:1 onto the ops handoff message.

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export const ESCALATE_TO_OPS: ToolSchema = {
  name: "escalate_to_ops",
  description:
    "Hand this conversation to the Sanocare ops team. Call when a lead is fully " +
    "qualified (name + location + service + context captured), when the user asks " +
    "for a human, when an emergency is detected, on a complaint, or when the " +
    "conversation has run 10+ turns without progress. Emit a clear summary so ops " +
    "can pick up without re-asking. This alerts ops via the live dashboard — it is " +
    "NOT a human-coordinator call-back; you remain the patient's point of contact.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      escalation_type: {
        type: "string",
        enum: ["qualified_lead", "human_requested", "emergency", "complaint", "stalled_conversation"],
        description: "Why this is being escalated.",
      },
      service_intent: {
        type: "string",
        enum: ["doctor_visit", "nursing", "lab", "teleconsult", "other"],
        description:
          "Which service: doctor_visit=Home Visit+Doctor Consult, nursing=Home " +
          "Nursing, lab=Lab Test at Home, teleconsult=Teleconsultation.",
      },
      urgency: {
        type: "string",
        enum: ["emergency", "today", "this_week", "planned"],
        description: "How urgent the need is.",
      },
      patient_name: { type: "string", description: "Patient name (may differ from the WhatsApp sender)." },
      patient_age: { type: "string", description: 'Patient age as a string, e.g. "45 y" (or "unknown").' },
      patient_relationship: {
        type: "string",
        enum: ["self", "parent", "spouse", "child", "other", "unknown"],
        description: "Relationship of the patient to the person messaging.",
      },
      location: {
        type: "string",
        description: 'Location text or shared-pin description, e.g. "Sector 50, Noida". Empty for teleconsult.',
      },
      context: {
        type: "string",
        description: "Brief symptom/need summary (~30-60 chars) for ops.",
      },
      summary_for_ops: {
        type: "string",
        description: "One or two line summary for ops picking up the lead.",
      },
    },
    required: [
      "escalation_type",
      "service_intent",
      "urgency",
      "patient_name",
      "patient_age",
      "patient_relationship",
      "location",
      "context",
      "summary_for_ops",
    ],
  },
};

export const SET_OPT_OUT: ToolSchema = {
  name: "set_opt_out",
  description:
    "Permanently opt this user out of all outbound messages (DPDP/TRAI). Call " +
    "ONLY after the user clearly asks to stop (STOP / unsubscribe / do not " +
    "contact). This is global and permanent until the user messages Sanocare again.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reason: { type: "string", description: "Short note on why (the user's wording)." },
    },
    required: [],
  },
};

// --- Slice 1 (Aarogya v2) — act on the patient's booking. ---------------
// None take a phone: the adapter injects the conversation's number, so the
// model can never act on a different patient's booking. Each returns a
// ready-to-send patient_message (the executor's canned templates).

export const CHECK_MEDIC_STATUS: ToolSchema = {
  name: "check_medic_status",
  description:
    "Look up the status of this patient's current booking. Call IMMEDIATELY " +
    "when the patient asks 'where is my Medic/doctor', 'how long until they " +
    "arrive', 'has anyone been assigned', or 'status of my booking' — do NOT " +
    "ask follow-up questions first. No arguments needed.",
  input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
};

export const CANCEL_BOOKING: ToolSchema = {
  name: "cancel_booking",
  description:
    "Cancel this patient's current booking. TWO-STEP: first quote the fee policy " +
    "(free unless the visit is already complete) and get an explicit 'yes, cancel' " +
    "from the patient, THEN call this with patient_acknowledged_fee=true. If the " +
    "cancellation reason sounds like a service failure (rude, no-show), prefer " +
    "log_complaint instead.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reason: { type: "string", description: "The patient's reason for cancelling (their words)." },
      patient_acknowledged_fee: {
        type: "boolean",
        description: "TRUE only after the patient explicitly confirmed cancellation knowing the fee policy.",
      },
    },
    required: ["reason", "patient_acknowledged_fee"],
  },
};

export const LOG_COMPLAINT: ToolSchema = {
  name: "log_complaint",
  description:
    "Log a complaint when the patient reports a service failure (Medic rude, " +
    "wrong report, billed twice, no-show, doctor never called). Acknowledge with " +
    "empathy, then call with the right category, the patient's own words as the " +
    "narrative, and an inferred severity.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      category: {
        type: "string",
        enum: ["medic_behavior", "clinical_quality", "billing", "delay", "report_issue", "other"],
        description: "Best-fit category for the complaint.",
      },
      narrative: { type: "string", description: "The patient's complaint in their own words." },
      severity: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description:
          "Default medium. high if they mention safety/harm/refund demand; critical if clinical risk or hospitalisation.",
      },
    },
    required: ["category", "narrative"],
  },
};

// --- Slice 4a — ops-only relay tools. ---------------------------------------
// Only callable when identity.role === 'ops_founder'. The adapter rejects
// these tool calls from any other identity (security gate). No phone is
// taken for target lookup beyond what ops passes — the adapter resolves
// the target patient's stored language before composing.

export const RELAY_TO_PATIENT: ToolSchema = {
  name: "relay_to_patient",
  description:
    "OPS-ONLY. Compose a warm 3-line message to a patient on behalf of " +
    "ops. Call this when the ops user (founder) asks you to relay an " +
    "instruction to a specific patient phone — e.g. 'Tell +91 98765 43210 " +
    "the medic will be 15 min late.' Returns a draft for ops to confirm; " +
    "DOES NOT auto-send. The patient receives nothing until ops replies " +
    "YES (then call confirm_relay).",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      target_phone: {
        type: "string",
        description:
          "Patient's WhatsApp phone in any common format (e.g. '+91 98765 43210', " +
          "'9876543210', '+919876543210'). The adapter normalises.",
      },
      instruction: {
        type: "string",
        description:
          "The ops user's instruction in their words. Used to compose the " +
          "patient-facing draft. Keep verbatim from ops's message.",
      },
    },
    required: ["target_phone", "instruction"],
  },
};

export const CONFIRM_RELAY: ToolSchema = {
  name: "confirm_relay",
  description:
    "OPS-ONLY companion to relay_to_patient. Call when ops replies YES " +
    "to a pending draft (resolution='YES') or refines/cancels (use the " +
    "describe-change pattern: re-call relay_to_patient with new draft " +
    "and then confirm_relay with resolution='CANCEL' against the prior " +
    "draft if needed). No draft_id needed — the adapter looks up the " +
    "most recent unexpired draft for this ops conversation.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      resolution: {
        type: "string",
        enum: ["YES", "CANCEL"],
        description:
          "YES → send the pending draft to the patient. CANCEL → mark the " +
          "draft cancelled (use when ops wants to abandon without sending).",
      },
    },
    required: ["resolution"],
  },
};

export const AAROGYA_TOOLS: ToolSchema[] = [
  ESCALATE_TO_OPS,
  SET_OPT_OUT,
  CHECK_MEDIC_STATUS,
  CANCEL_BOOKING,
  LOG_COMPLAINT,
];

/** Slice 4a — the tool subset available only when identity is ops_founder.
 *  The adapter merges this with AAROGYA_TOOLS for ops turns and uses
 *  AAROGYA_TOOLS alone for patient turns. */
export const AAROGYA_OPS_TOOLS: ToolSchema[] = [RELAY_TO_PATIENT, CONFIRM_RELAY];
