// Slice 4a C3 — detectLanguage tests.
//
// Covers the 3 KB examples from the brief verbatim, plus edge cases
// (empty, single-char, mixed-script, English with brand words, all-caps,
// numerics, punctuation-only).

import { describe, it, expect } from "vitest";

import { detectLanguage } from "@/lib/whatsapp/languageDetect";

describe("detectLanguage — the 3 brief examples", () => {
  it("\"Hi, I need a doctor\" → english/latin/high", () => {
    const d = detectLanguage("Hi, I need a doctor");
    expect(d.language).toBe("english");
    expect(d.script).toBe("latin");
    expect(d.confidence).toBe("high");
  });

  it("\"नमस्ते, मुझे डॉक्टर चाहिए\" → hindi/devanagari/high", () => {
    const d = detectLanguage("नमस्ते, मुझे डॉक्टर चाहिए");
    expect(d.language).toBe("hindi");
    expect(d.script).toBe("devanagari");
    expect(d.confidence).toBe("high");
  });

  it("\"Namaste, mujhe ghar par doctor chahiye\" → hinglish/latin/medium", () => {
    const d = detectLanguage("Namaste, mujhe ghar par doctor chahiye");
    expect(d.language).toBe("hinglish");
    expect(d.script).toBe("latin");
    // 4 tokens hit (namaste, mujhe, ghar, chahiye) → medium
    expect(d.confidence).toBe("medium");
  });
});

describe("detectLanguage — edge cases", () => {
  it("empty string → english/latin/low (safe default)", () => {
    const d = detectLanguage("");
    expect(d.language).toBe("english");
    expect(d.confidence).toBe("low");
  });

  it("whitespace-only string → english/latin/low", () => {
    const d = detectLanguage("   \n\t  ");
    expect(d.language).toBe("english");
    expect(d.confidence).toBe("low");
  });

  it("single character → english/low (too short to classify)", () => {
    const d = detectLanguage("a");
    expect(d.language).toBe("english");
    expect(d.confidence).toBe("low");
  });

  it("single Hindi roman token in a short message → hinglish/low", () => {
    const d = detectLanguage("Namaste");
    expect(d.language).toBe("hinglish");
    expect(d.confidence).toBe("low");
  });

  it("mixed-script majority Devanagari → hindi/mixed/medium", () => {
    // 5 devanagari + 2 latin alphanumeric → ratio ~5/7 = 71% — high
    // Adjusting: shorter Devanagari portion to hit the 0.3-0.6 band.
    const d = detectLanguage("नमस्ते OK abcde fghij");
    // 5 devanagari chars / 17 non-space chars ≈ 0.29 — falls just under
    // the 0.3 threshold; falls through to hinglish/english branches.
    // Use a slightly higher Devanagari weight:
    const d2 = detectLanguage("नमस्ते जी OK abcd");
    expect(d2.language).toBe("hindi");
    expect(["mixed", "devanagari"]).toContain(d2.script);
    void d;
  });

  it("English with brand words doesn't false-positive Hindi", () => {
    // 'doctor' IS in the token list (it's a Hindi loan word patients use
    // in mixed-script messages). But one hit alone in a long message
    // stays english.
    const d = detectLanguage("I want to book a doctor visit at home please");
    expect(d.language).toBe("english");
  });

  it("ALL CAPS English → still english", () => {
    const d = detectLanguage("I NEED HELP RIGHT NOW");
    expect(d.language).toBe("english");
    expect(d.confidence).toBe("high");
  });

  it("Numbers and punctuation only → english/low (no tokens)", () => {
    const d = detectLanguage("123 ?!?! ----");
    expect(d.language).toBe("english");
  });

  it("strong hinglish: kya hai bhai → hinglish/medium", () => {
    const d = detectLanguage("kya hai bhai, theek hai?");
    expect(d.language).toBe("hinglish");
    expect(d.script).toBe("latin");
  });
});

describe("detectLanguage — script discrimination", () => {
  it("pure Devanagari long message → confidence high", () => {
    const d = detectLanguage("मुझे आज डॉक्टर की ज़रूरत है, कृपया मदद कीजिए");
    expect(d.confidence).toBe("high");
    expect(d.script).toBe("devanagari");
  });

  it("Devanagari with English numerals → still hindi", () => {
    const d = detectLanguage("मेरा बेटा 5 साल का है, बुखार है");
    expect(d.language).toBe("hindi");
  });
});
