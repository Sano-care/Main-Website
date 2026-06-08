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

export const AAROGYA_TOOLS: ToolSchema[] = [ESCALATE_TO_OPS, SET_OPT_OUT];
