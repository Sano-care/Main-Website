// Canonical design primitives for the Sanocare web app.
//
// This file is the single TypeScript source of truth for the raw token
// values — colors, typography, spacing, radius, shadows, and motion — that
// the CSS theme in `src/app/globals.css` mirrors as `@theme` custom
// properties. Components that need a token *in JS* (Framer Motion configs,
// inline canvas/chart styling, computed gradients) import from here instead
// of hard-coding hex strings or magic numbers.
//
// T62 lands this file first on the Pulse branch; T61 (web-v2 marketing
// refresh) consumes the same tokens later. Keep the values in lockstep with
// globals.css — if you change a hue here, change the matching
// `--color-*` there in the same commit.
//
// Color ramp is the logo-aligned single-saturation blue (#2B81FF) plus the
// coral CTA accent, exactly as defined in globals.css. Motion values are the
// T61 reveal/count-up anchors: the shared ease curve [0.22, 1, 0.36, 1]
// (an "ease-out-quint"-ish cubic-bezier) and the 400 ms reveal / 1500 ms
// counter / 150 ms micro-interaction durations already used by
// SectionReveal and AnimatedCounter. Shadow values are read from the
// `.glass-panel`, `.btn-glow`, and Pulse mockup elevation steps.
//
// Everything is `as const` so the literal types are preserved for autocomplete
// and so downstream `keyof typeof` lookups stay exhaustive.

/* ───────────────────────────── Colors ───────────────────────────── */

export const colors = {
  // Brand blue — single-saturation ramp aligned to the logo (#2B81FF).
  primary: {
    DEFAULT: "#2b81ff",
    dark: "#1b65db",
    50: "#e8f1ff",
    100: "#cfe0ff",
    300: "#79aaff",
    700: "#134cb0",
    900: "#0a2670",
  },
  // Coral accent — warmth + family-friendly CTA highlights.
  coral: {
    DEFAULT: "#f4845a",
    dark: "#dc6a40",
    50: "#fff1ec",
  },
  // Surfaces & ink.
  surface: {
    light: "#ffffff",
    dark: "#1e293b",
  },
  background: {
    light: "#f7fafc",
    dark: "#0f172a",
  },
  text: {
    main: "#0f172a",
    secondary: "#475569",
  },
  line: "#e2e8ee",
  glass: {
    light: "rgba(255, 255, 255, 0.7)",
    dark: "rgba(30, 41, 54, 0.7)",
  },
  // Semantic status hues for the Pulse vitals/medication surfaces.
  // (Vitals out-of-range, adherence taken/missed, refill warnings.) These
  // map to Tailwind's emerald/amber/rose at the 500/600 stops so the
  // utility classes and the JS tokens agree.
  status: {
    good: "#16a34a", // green-600 — in-range / dose taken
    goodSoft: "#dcfce7", // green-100 — pill background
    warn: "#d97706", // amber-600 — needs-review / refill soon
    warnSoft: "#fef3c7", // amber-100
    danger: "#e11d48", // rose-600 — out-of-range / dose missed
    dangerSoft: "#ffe4e6", // rose-100
    neutral: "#475569", // slate-600 — pending / no data
  },
} as const;

/* ────────────────────────── Typography ──────────────────────────── */

export const typography = {
  fontFamily: {
    // Inter is the single sans across display + body; mono for clinical
    // detail (codes, vitals values). The `var(--font-*)` indirection lets
    // next/font inject the hashed family name at build time.
    sans: 'var(--font-inter), system-ui, -apple-system, "Segoe UI", sans-serif',
    display:
      'var(--font-inter), system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
  },
  // rem-based type scale. Keys read as semantic sizes, values as the rem
  // string + a comfortable line-height pairing.
  fontSize: {
    xs: ["0.75rem", "1rem"], // 12 / 16
    sm: ["0.875rem", "1.25rem"], // 14 / 20
    base: ["1rem", "1.5rem"], // 16 / 24
    lg: ["1.125rem", "1.75rem"], // 18 / 28
    xl: ["1.25rem", "1.75rem"], // 20 / 28
    "2xl": ["1.5rem", "2rem"], // 24 / 32
    "3xl": ["1.875rem", "2.25rem"], // 30 / 36
    "4xl": ["2.25rem", "2.5rem"], // 36 / 40
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  letterSpacing: {
    tight: "-0.02em",
    normal: "0",
    wide: "0.04em",
    widest: "0.1em", // eyebrow / uppercase mono labels
  },
} as const;

/* ──────────────────────────── Spacing ───────────────────────────── */

// 4px base grid. Keys are the canonical step names used across the Pulse
// layouts; values are rem strings (1 unit = 0.25rem = 4px).
export const spacing = {
  0: "0",
  1: "0.25rem", // 4
  2: "0.5rem", // 8
  3: "0.75rem", // 12
  4: "1rem", // 16
  5: "1.25rem", // 20
  6: "1.5rem", // 24
  8: "2rem", // 32
  10: "2.5rem", // 40
  12: "3rem", // 48
  16: "4rem", // 64
  20: "5rem", // 80
} as const;

/* ──────────────────────────── Radius ────────────────────────────── */

export const radius = {
  none: "0",
  sm: "0.375rem", // 6  — inputs, small chips
  md: "0.5rem", // 8  — buttons
  lg: "0.75rem", // 12 — inline fields, OTP boxes
  xl: "1rem", // 16 — cards
  "2xl": "1.5rem", // 24 — hero tiles, modals
  full: "9999px", // pills, avatars
} as const;

/* ──────────────────────────── Shadows ───────────────────────────── */

// Elevation ramp. `glass` matches the `.glass-panel` utility; `glow*`
// match `.btn-glow` / `.btn-accent:hover`. The card/raised steps are the
// Pulse mockup's tile elevations (brand-blue-tinted, not neutral grey, so
// surfaces feel of-a-piece with the logo).
export const shadows = {
  none: "none",
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  card: "0 2px 8px -2px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04)",
  raised: "0 8px 24px -8px rgba(43, 129, 255, 0.16)",
  glass: "0 20px 40px -10px rgba(43, 129, 255, 0.12)",
  glowPrimary: "0 0 20px rgba(43, 129, 255, 0.4)",
  glowCoral: "0 0 20px rgba(244, 132, 90, 0.35)",
} as const;

/* ──────────────────────────── Motion ────────────────────────────── */

// The T61 motion language. `ease.standard` is the shared cubic-bezier used
// by SectionReveal + AnimatedCounter; durations are in both ms (for JS /
// Framer Motion's `transition.duration` once divided by 1000) and seconds
// for direct Framer use. Anything user-facing must degrade under
// `prefers-reduced-motion` — these tokens describe the *enabled* path only.
export const motion = {
  ease: {
    // ease-out-quint-ish — decisive entrance, gentle settle.
    standard: [0.22, 1, 0.36, 1] as const,
    // symmetric ease for hovers / toggles.
    inOut: [0.4, 0, 0.2, 1] as const,
  },
  duration: {
    micro: 150, // hovers, button state, pill toggles
    fast: 250, // small enter/exit (toasts, popovers)
    reveal: 400, // SectionReveal fade/slide-up
    counter: 1500, // AnimatedCounter count-up
  },
  // Convenience seconds form for Framer Motion's `transition.duration`.
  durationSec: {
    micro: 0.15,
    fast: 0.25,
    reveal: 0.4,
    counter: 1.5,
  },
} as const;

/* ───────────────────────────── Bundle ───────────────────────────── */

// A single namespaced export for callers that prefer `tokens.colors.primary`
// over individual imports. Both styles are supported.
export const tokens = {
  colors,
  typography,
  spacing,
  radius,
  shadows,
  motion,
} as const;

export type Tokens = typeof tokens;
