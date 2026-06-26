import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Pulse A1 Part 1 — the "I'll do this later" control must be a real anchor
// (<Link href="/pulse">), NOT an onClick-only <button>. A JS-only button is
// dead until this "use client" page hydrates, which on a slow mobile network
// is the live "nothing happens on click" bug. An anchor navigates straight
// from the server-rendered HTML, independent of hydration, and is natively
// keyboard-focusable + Enter-activatable.
//
// Interaction-level proof (click + keyboard lands on Pulse home) is left to
// Cowork/founder verification per the brief; this is the regression guard
// that keeps the control an anchor.

const src = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../page.tsx"),
  "utf8",
);

describe("welcome/family skip control", () => {
  it("renders 'I'll do this later' inside a <Link href=\"/pulse\">", () => {
    expect(src).toMatch(
      /<Link\s+href="\/pulse"[\s\S]{0,400}?>\s*I&apos;ll do this later\s*<\/Link>/,
    );
  });

  it("is NOT an onClick-only <button> (the dead-until-hydration form)", () => {
    expect(src).not.toMatch(/<button[\s\S]{0,300}?I&apos;ll do this later/);
    expect(src).not.toContain("handleSkip");
  });
});
