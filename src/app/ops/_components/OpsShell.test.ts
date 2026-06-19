import { describe, expect, it } from "vitest";

import { SIDEBAR_BASE, sidebarClassName } from "./opsShellClasses";

// The interaction wiring (hamburger onClick → setOpen(true), backdrop / nav-link
// / Esc → setOpen(false)) drives this single boolean, whose only observable
// output is the sidebar's transform class. The repo's test env is node-only
// (no DOM renderer, and new deps are out of scope), so we test that
// state → class mapping directly — it's the substantive, regression-prone part.

describe("sidebarClassName — mobile slide-in toggle", () => {
  it("closed → sits off-canvas (-translate-x-full), no mobile slide-in class", () => {
    const cls = sidebarClassName(false);
    expect(cls).toContain("-translate-x-full");
    expect(cls).not.toContain(" translate-x-0"); // mobile-open class absent
  });

  it("open → slides in (translate-x-0) and drops the off-canvas class", () => {
    const cls = sidebarClassName(true);
    expect(cls).toContain(" translate-x-0");
    expect(cls).not.toContain("-translate-x-full");
  });

  it("keeps the desktop-always-visible overrides in BOTH states", () => {
    for (const open of [true, false]) {
      const cls = sidebarClassName(open);
      expect(cls).toContain("lg:static"); // desktop: back in normal flow
      expect(cls).toContain("lg:translate-x-0"); // desktop: never translated away
      expect(cls).toContain("fixed"); // mobile: overlay
      expect(cls).toContain("w-64"); // width unchanged from pre-mobile design
    }
  });

  it("animates the slide via a transform transition", () => {
    expect(SIDEBAR_BASE).toContain("transition-transform");
  });
});
