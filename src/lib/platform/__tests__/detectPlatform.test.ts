import { describe, it, expect } from "vitest";

import { detectClientPlatform } from "../detectPlatform";

// Representative real-world UA strings.
const UA = {
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadClassic:
    "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  ipadOS13Plus:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  linuxDesktop:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

describe("detectClientPlatform", () => {
  it("routes Android phones and tablets to android", () => {
    expect(detectClientPlatform({ userAgent: UA.androidPhone })).toBe("android");
    expect(detectClientPlatform({ userAgent: UA.androidTablet })).toBe("android");
  });

  it("routes iPhone and classic iPad UAs to ios", () => {
    expect(detectClientPlatform({ userAgent: UA.iphone })).toBe("ios");
    expect(detectClientPlatform({ userAgent: UA.ipadClassic })).toBe("ios");
  });

  it("unmasks iPadOS 13+ (Macintosh UA + touch) as ios", () => {
    expect(
      detectClientPlatform({ userAgent: UA.ipadOS13Plus, maxTouchPoints: 5 }),
    ).toBe("ios");
  });

  it("keeps a real Mac (no touch) on desktop even with the same UA", () => {
    expect(
      detectClientPlatform({ userAgent: UA.macDesktop, maxTouchPoints: 0 }),
    ).toBe("desktop");
    // Macintosh UA with maxTouchPoints unset must not be mistaken for an iPad.
    expect(detectClientPlatform({ userAgent: UA.ipadOS13Plus })).toBe("desktop");
  });

  it("routes Windows and Linux desktops to desktop", () => {
    expect(detectClientPlatform({ userAgent: UA.windows })).toBe("desktop");
    expect(detectClientPlatform({ userAgent: UA.linuxDesktop })).toBe("desktop");
  });

  it("falls back to desktop (QR) on an empty UA", () => {
    expect(detectClientPlatform({ userAgent: "" })).toBe("desktop");
  });
});
