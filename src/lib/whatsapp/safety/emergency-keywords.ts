// Deterministic emergency detection (architecture §3.2, Appendix A, decision
// C.3). This is the FIRST line of defense and is NEVER an LLM call: regex is
// deterministic, auditable, and runs in microseconds. The Week-2 Claude prompt
// is instructed to escalate emergencies too, but only as a second line.
//
// Matching is case-insensitive with word boundaries so single-word triggers
// ("fit", "khoon") don't fire inside unrelated words ("benefit", "fitness").
// Per decision C.3 we deliberately err toward escalation; the broad general
// terms ("urgent", "serious") are kept verbatim from Appendix A. Their
// false-positive cost is noted in decisions.md and is acceptable for a
// life-critical path in Week 1.
//
// The categorised list mirrors the shape stored in
// agent_versions.safety_keywords so Week 2 can load it from the DB.

export const EMERGENCY_KEYWORDS: Record<string, string[]> = {
  cardiopulmonary: [
    "chest pain",
    "chest hurts",
    "seene mein dard",
    "heart attack",
    "stroke",
    "cardiac arrest",
    "breathless",
    "breathlessness",
    "can't breathe",
    "cant breathe",
    "cannot breathe",
    "saans nahin",
    "saans phool",
    "collapsed",
    "unconscious",
    "fainted",
    "passed out",
    "behosh",
    "dil ka daura",
    "not responding",
    "not waking up",
  ],
  trauma: [
    "severe bleeding",
    "bleeding heavily",
    "khoon",
    "accident",
    "injured",
    "injury",
    "head injury",
    "head trauma",
    "burn",
    "burnt",
    "jal gaya",
    "electric shock",
    "fracture",
    "broken bone",
    "haddi",
  ],
  acute_medical: [
    "seizure",
    "convulsion",
    "fit",
    "jhatka",
    "severe pain",
    "unbearable pain",
    "bahut dard",
    "bahut zyada dard",
    "overdose",
    "poisoning",
    "zeher",
    "suicidal",
    "suicide",
    "khudkushi",
    "self-harm",
    "marna chahta hoon",
  ],
  pediatric_maternal: [
    "baby not breathing",
    "baby blue",
    "baby unconscious",
    "labor pain",
    "bleeding pregnancy",
    "miscarriage",
  ],
  general: [
    "emergency",
    "911",
    "urgent",
    "serious",
    "dying",
    "marr raha",
    "dying right now",
  ],
};

// The exact canned response required by Week-1 Deliverable 4. Do not edit
// without sign-off — this is a safety-critical, compliance-reviewed string.
export const EMERGENCY_RESPONSE =
  "🚨 URGENT — this sounds like a medical emergency. Please call 112 now " +
  "(Indian emergency services). For ambulance, call 102. For non-emergencies, " +
  "I'm right here — describe what's happening and I'll help.";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Precompile one boundary-anchored regex per keyword for fast, specific match
// reporting. `\b` works for both single words and space-separated phrases.
const COMPILED: { keyword: string; category: string; re: RegExp }[] = [];
for (const [category, words] of Object.entries(EMERGENCY_KEYWORDS)) {
  for (const keyword of words) {
    COMPILED.push({
      keyword,
      category,
      re: new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i"),
    });
  }
}

export interface EmergencyMatch {
  matched: boolean;
  keyword?: string;
  category?: string;
}

/**
 * Scan an inbound message body for emergency keywords. Returns the first match
 * (keyword + category) for audit/Slack context, or { matched: false }.
 */
export function detectEmergency(text: string): EmergencyMatch {
  if (!text) return { matched: false };
  for (const { keyword, category, re } of COMPILED) {
    if (re.test(text)) return { matched: true, keyword, category };
  }
  return { matched: false };
}
