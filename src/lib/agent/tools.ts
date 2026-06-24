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

// --- Slice 4a — patient-scoped tier-2 data tools. ---------------------------
// Both are auto-scoped to the inbound caller's customer_id (adapter-injected)
// — the model can't supply or alter the scope. Patient mode and ops mode
// both have access; ops mode is still self-scoped (ops can NOT use these to
// peek at other patients — that's a future ops dashboard surface, not WA).

export const GET_BOOKING_HISTORY: ToolSchema = {
  name: "get_booking_history",
  description:
    "Return THIS patient's full booking history, optionally filtered. " +
    "Distinct from check_medic_status (which is 'where is my CURRENT booking') " +
    "— get_booking_history is 'show me all my bookings, ever'. Call when the " +
    "patient asks 'what bookings have I made', 'show me my past visits', " +
    "'what did I book last month', or wants a list of completed/cancelled " +
    "items.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      filter: {
        type: "string",
        enum: ["all", "active", "completed"],
        description:
          "all = every booking; active = PENDING / CONFIRMED / DISPATCHED; " +
          "completed = COMPLETED only. Defaults to 'all' when omitted.",
      },
    },
    required: [],
  },
};

export const GET_FAMILY_MEMBERS: ToolSchema = {
  name: "get_family_members",
  description:
    "Return the family members linked to THIS patient's account (M042 " +
    "family_members table, hard cap 8). Call when the patient asks 'who is " +
    "on my account', 'my family', 'add my mother', or needs to confirm a " +
    "name+relation before a booking. No arguments — auto-scoped to the " +
    "caller's customer_id.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
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

// --- Slice 5 — CareHub awareness. ------------------------------------------
// register_carehub_interest is advertised to every patient turn (the model
// calls it only when a NON-member expresses interest; the executor no-ops for
// existing members). surface_carehub_benefits is advertised ONLY to carehub
// identities (orchestrator subset) AND gated at the executor level —
// defense-in-depth so a non-member can never read benefits.

export const REGISTER_CAREHUB_INTEREST: ToolSchema = {
  name: "register_carehub_interest",
  description:
    "Capture this person's interest in a Sanocare CareHub membership so sales " +
    "can follow up. Call when a customer or new visitor asks about CareHub, the " +
    "membership, the ₹199/month plan, or says they'd like to join / know more. " +
    "Do NOT call for someone who is already a CareHub member. No phone argument " +
    "— the lead is keyed to this conversation's number.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      notes: {
        type: "string",
        description: "What the person said about their interest, in their words (optional).",
      },
    },
    required: [],
  },
};

export const REGISTER_CUSTOMER: ToolSchema = {
  name: "register_customer",
  description:
    "Register this sender as a Sanocare customer the MOMENT you learn their NAME. " +
    "Call it as soon as a new or unregistered person tells you their name (once per " +
    "conversation is enough). Pass their actual name — never a placeholder like " +
    "'patient' or 'user'. Optionally include any address / email / date-of-birth / " +
    "gender they've ALREADY shared (e.g. during a booking); never ask for those just " +
    "to fill this tool. There is NO phone argument — the number comes from this " +
    "conversation. This is a SILENT background action: do NOT tell the user you saved " +
    "their details — just keep replying naturally (greeting them by name is fine).",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      full_name: {
        type: "string",
        description: "The person's actual name, as they gave it.",
      },
      address_line: { type: "string", description: "Street / house address, if shared (optional)." },
      area: { type: "string", description: "Locality / area, if shared (optional)." },
      city: { type: "string", description: "City, if shared (optional)." },
      pincode: { type: "string", description: "6-digit pincode, if shared (optional)." },
      email: { type: "string", description: "Email, if shared (optional)." },
      date_of_birth: {
        type: "string",
        description: "Date of birth as YYYY-MM-DD, if shared (optional).",
      },
      gender: { type: "string", description: "Gender, if shared (optional)." },
    },
    required: ["full_name"],
  },
};

export const SURFACE_CAREHUB_BENEFITS: ToolSchema = {
  name: "surface_carehub_benefits",
  description:
    "Surface THIS CareHub member's current benefits and remaining monthly perks " +
    "(free vitals visit, 20% off, priority dispatch, member-since date). Call when " +
    "the member asks 'what are my benefits', 'what does CareHub include', 'what do " +
    "I get', or 'show my membership'. ONLY callable for CareHub members — the " +
    "executor rejects any other identity. No arguments.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
  },
};

// ---------------------------------------------------------------------------
// Medic-mode tools (Aarogya Medic Help-Mode Part 1). Advertised ONLY when
// identity.role === 'medic'; every executor also gates on the role
// (defense-in-depth on top of the withheld schema). Patients/ops never see these.
// ---------------------------------------------------------------------------
export const ESCALATE_TO_DOCTOR: ToolSchema = {
  name: "escalate_to_doctor",
  description:
    "Get a doctor involved for the MEDIC on the case (non-emergency clinical " +
    "question — unexpected finding, medication question, whether to proceed). " +
    "Alerts ops, who connect the medic to the on-call doctor. Do NOT use for an " +
    "active emergency (tell the medic to call 112). Do NOT give clinical advice " +
    "yourself — this routes to a human doctor. ONLY callable in medic mode.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reason: {
        type: "string",
        description:
          "Why a doctor is needed — the medic's clinical question / situation, in one line.",
      },
    },
    required: ["reason"],
  },
};

export const FETCH_BOOKING_CONTEXT: ToolSchema = {
  name: "fetch_booking_context",
  description:
    "Look up details of a booking ASSIGNED TO THIS MEDIC (service, patient name, " +
    "address, status, scheduled time). Returns details only if the booking is " +
    "assigned to the calling medic; refuses otherwise. ONLY callable in medic mode. " +
    "Accepts the booking code (what the medic sees) or the booking id.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      booking_id: {
        type: "string",
        description: "The booking code (e.g. SAN-...) or booking id the medic is asking about.",
      },
    },
    required: ["booking_id"],
  },
};

export const LOG_MEDIC_QUERY: ToolSchema = {
  name: "log_medic_query",
  description:
    "Record the medic's question to the audit log so ops can spot recurring gaps " +
    "(especially when the answer isn't known and needs founder/ops follow-up). " +
    "Call it in addition to answering. ONLY callable in medic mode.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      question: {
        type: "string",
        description: "The medic's question, verbatim or lightly summarised.",
      },
    },
    required: ["question"],
  },
};

export const AAROGYA_TOOLS: ToolSchema[] = [
  ESCALATE_TO_OPS,
  SET_OPT_OUT,
  CHECK_MEDIC_STATUS,
  CANCEL_BOOKING,
  LOG_COMPLAINT,
  REGISTER_CAREHUB_INTEREST,
  // Auto-register: available to every patient turn (incl. role "new") so the
  // moment a fresh sender gives their name, the model can create the customer row.
  REGISTER_CUSTOMER,
];

/** Slice 4a — the tool subset available only when identity is ops_founder.
 *  The adapter merges this with AAROGYA_TOOLS for ops turns and uses
 *  AAROGYA_TOOLS alone for patient turns. */
export const AAROGYA_OPS_TOOLS: ToolSchema[] = [RELAY_TO_PATIENT, CONFIRM_RELAY];

/** Slice 5 — the tool subset merged in only when identity is a CareHub
 *  member (customer / subRole 'carehub'). surface_carehub_benefits is
 *  withheld from every other identity's tool list (defense-in-depth on top
 *  of the executor-level gate). */
export const AAROGYA_CAREHUB_TOOLS: ToolSchema[] = [SURFACE_CAREHUB_BENEFITS];

/** Medic Help-Mode Part 1 — the tool subset advertised ONLY when identity.role
 *  === 'medic'. Unlike ops/carehub (which append to AAROGYA_TOOLS), this REPLACES
 *  the patient tools entirely — a medic never sees the patient/booking tools. */
export const AAROGYA_MEDIC_TOOLS: ToolSchema[] = [
  ESCALATE_TO_DOCTOR,
  FETCH_BOOKING_CONTEXT,
  LOG_MEDIC_QUERY,
];

// ---------------------------------------------------------------------------
// Pulse Records — Aarogya tools (Slice C). Merged into the tool list only for
// role === 'customer' (the executors re-gate on customerId). Read/explain/save
// of the patient's OWN records — never another account's, never diagnostic.
// ---------------------------------------------------------------------------

export const FETCH_PULSE_RECORDS: ToolSchema = {
  name: "fetch_pulse_records",
  description:
    "Look up THIS patient's own Sanocare records to answer questions like 'show " +
    "me my last prescription', 'what were my recent vitals', 'my bookings', 'my " +
    "conditions / allergies', or 'what reports do I have'. Auto-scoped to the " +
    "caller's own account — there is NO patient-identifier argument. Optionally " +
    "narrow to certain categories, or to one family member (get their id from " +
    "get_family_members first). Read-only: report what's on file, never interpret " +
    "a value medically.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      categories: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "bookings",
            "prescriptions",
            "vitals",
            "medications",
            "conditions",
            "allergies",
            "documents",
          ],
        },
        description: "Optional subset of record types. Omit for everything.",
      },
      member_id: {
        type: "string",
        description:
          "Optional family-member id to scope to. Omit for the account holder. " +
          "Vitals and medications are account-level and only returned for the holder.",
      },
    },
    required: [],
  },
};

export const UPLOAD_TO_PULSE_VAULT: ToolSchema = {
  name: "upload_to_pulse_vault",
  description:
    "Save the document the patient JUST sent on WhatsApp (a lab report, " +
    "prescription, scan, or discharge summary — photo or PDF) into their private " +
    "Pulse records vault. Call this ONLY right after they share a file and want it " +
    "kept. Auto-scoped to the caller's own account. NEVER read or interpret the " +
    "file's contents.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      doc_type: {
        type: "string",
        enum: ["lab_report", "prescription", "imaging", "discharge_summary", "other"],
        description: "Best guess at what the file is, from what the patient said. Default 'other'.",
      },
      label: {
        type: "string",
        description: "Optional short human label, e.g. 'CBC report June'.",
      },
      member_id: {
        type: "string",
        description: "Optional family-member id if the document is about a member; omit for the account holder.",
      },
    },
    required: [],
  },
};

export const EXPLAIN_RECORD: ToolSchema = {
  name: "explain_record",
  description:
    "Explain, in plain language, what a term or reading on one of the patient's " +
    "OWN records means (e.g. 'what does eGFR mean', 'what is this SpO₂ reading'). " +
    "Read/explain ONLY: you must NEVER diagnose, prescribe, suggest a dose, or say " +
    "whether a value is normal/high/low/good/bad. For any 'is this okay / what " +
    "should I do' question, the answer is a teleconsult with a Sanocare MBBS " +
    "doctor. record_id must be an id from a prior fetch_pulse_records result.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      record_id: {
        type: "string",
        description: "The id of one of THIS patient's records (from fetch_pulse_records).",
      },
    },
    required: ["record_id"],
  },
};

/** Pulse Records tools (Slice C) — appended to AAROGYA_TOOLS for customers. */
export const AAROGYA_PULSE_TOOLS: ToolSchema[] = [
  FETCH_PULSE_RECORDS,
  UPLOAD_TO_PULSE_VAULT,
  EXPLAIN_RECORD,
];

// ---------------------------------------------------------------------------
// Lab catalogue lookup (patient roles only — customer + new). READ-ONLY.
// ---------------------------------------------------------------------------
export const SEARCH_LAB_TESTS: ToolSchema = {
  name: "search_lab_tests",
  description:
    "Look up a lab test in Sanocare's catalogue (Pathcore) by name and return its " +
    "price, turnaround, sample type, and what it checks. Call when the patient asks " +
    "the price/details of a SPECIFIC test (e.g. 'how much is a thyroid profile', " +
    "'CBC cost', 'vitamin D test'). Do NOT call to recommend which test someone " +
    "needs for a symptom or condition — that's a doctor's decision; offer a consult " +
    "instead. Read-only: this never books anything.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "The test name or keyword the patient asked about (e.g. 'thyroid profile', 'CBC', 'vitamin d').",
      },
    },
    required: ["query"],
  },
};

/** Patient-only lab tools (customer + new). Withheld from medic/doctor/ops. */
export const AAROGYA_LAB_TOOLS: ToolSchema[] = [SEARCH_LAB_TESTS];
