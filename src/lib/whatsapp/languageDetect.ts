// Slice 4a C3 — Lightweight language detector for Aarogya.
//
// Goal: classify a single inbound message as english / hindi / hinglish
// so Aarogya can MIRROR the patient's language in its reply (no upfront
// "which language do you prefer?" gate — Q4 explicitly rejected). The
// system-prompt mirror rule (knowledge.ts in C6) does the rest.
//
// Heuristic, NOT ML — no new dependency, runs in <1ms, server-side only.
//
//   1. Devanagari ratio ≥ 30% of non-space chars   → 'hindi'   ('devanagari')
//   2. ≥2 hits from the Hindi-in-Latin word list   → 'hinglish' ('latin')
//   3. otherwise                                    → 'english' ('latin')
//
// Storage: the adapter writes the detected value to conversations.language
// after EVERY patient inbound (C7). The CURRENT-turn detection is what the
// reply matches; the stored value is for ops visibility AND for relay
// drafts (C4) targeting THIS patient — the draft adopts their preferred
// language without re-querying.
//
// The word list is intentionally narrow + obvious — high-confidence Hindi
// roman-script tokens. Adding "no" or "the" would false-positive English.

const DEVANAGARI_RANGE = /[ऀ-ॿ]/g;

const HINDI_LATIN_TOKENS = new Set([
  "namaste",
  "namaskar",
  "ji",
  "haan",
  "nahin",
  "nahi",
  "kya",
  "acha",
  "accha",
  "theek",
  "thik",
  "hai",
  "hain",
  "tha",
  "thi",
  "mein",
  "main",
  "mujhe",
  "tumhe",
  "aap",
  "tum",
  "ghar",
  "chahiye",
  "paani",
  "pani",
  "bilkul",
  "bahut",
  "kuch",
  "kahan",
  "kaise",
  "kyun",
  "kyon",
  "shukriya",
  "dhanyavaad",
  // "doctor" deliberately NOT in this list — too overloaded with English.
  // A plain "I need a doctor" would false-positive hinglish/low otherwise.
  // Hindi loan-word health vocab that's NOT also English stays:
  "dawai",
  "dard",
  "pareshan",
  "tabiyat",
]);

// Patient WhatsApp messages routinely include the brand name and English
// nouns the heuristic shouldn't count toward Hindi. None of these stops
// belong in HINDI_LATIN_TOKENS, but if we ever auto-grow the list we'd
// want to short-circuit on common-English tokens explicitly.

export type DetectedLanguageKind = "english" | "hindi" | "hinglish";
export type DetectedLanguageScript = "latin" | "devanagari" | "mixed";
export type DetectedLanguageConfidence = "high" | "medium" | "low";

export interface DetectedLanguage {
  language: DetectedLanguageKind;
  script: DetectedLanguageScript;
  confidence: DetectedLanguageConfidence;
}

/**
 * Detect language + script for one message. Pure — no side effects, no
 * I/O. Safe to call on every inbound.
 *
 * Empty / whitespace-only / single-character input falls through to
 * 'english'/'low' as a safe default (Aarogya then defaults to English
 * for the reply, which patients tolerate well in Delhi NCR).
 */
export function detectLanguage(text: string): DetectedLanguage {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) {
    return { language: "english", script: "latin", confidence: "low" };
  }

  const devanagariMatches = trimmed.match(DEVANAGARI_RANGE);
  const devanagariCount = devanagariMatches ? devanagariMatches.length : 0;
  const nonSpaceChars = trimmed.replace(/\s+/g, "").length;
  const devanagariRatio = nonSpaceChars === 0 ? 0 : devanagariCount / nonSpaceChars;

  if (devanagariRatio >= 0.3) {
    // Pure Devanagari — high confidence Hindi.
    if (devanagariRatio >= 0.6) {
      return { language: "hindi", script: "devanagari", confidence: "high" };
    }
    // Mixed-script (some Latin chars too — e.g. "नमस्ते, OK") — call it
    // hindi but mark mixed + medium confidence.
    return { language: "hindi", script: "mixed", confidence: "medium" };
  }

  // Hindi-in-Latin word count. Lowercase + word-split, set lookup.
  const tokens = trimmed
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0);
  let hindiHits = 0;
  for (const tok of tokens) {
    if (HINDI_LATIN_TOKENS.has(tok)) hindiHits += 1;
    if (hindiHits >= 2) break;
  }
  if (hindiHits >= 2) {
    // 2+ confidence-Hindi tokens in a Latin-script message → hinglish.
    return { language: "hinglish", script: "latin", confidence: "medium" };
  }
  if (hindiHits === 1 && tokens.length <= 5) {
    // Short message with one strong token (e.g. "Namaste") — medium.
    return { language: "hinglish", script: "latin", confidence: "low" };
  }

  // Single-char or very short Latin input falls to english/low (the
  // default mirror behaviour is also english, so this is the safest tier).
  const confidence: DetectedLanguageConfidence =
    trimmed.length <= 2 ? "low" : "high";
  return { language: "english", script: "latin", confidence };
}
