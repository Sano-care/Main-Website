import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // T51 guardrail — DPDP / patient-experience datetime hygiene.
  //
  // Disallow raw Date.toLocaleString() / toLocaleDateString() /
  // toLocaleTimeString() in app code. Every user-visible datetime
  // MUST go through src/lib/time/formatIST.ts so IST display stays
  // consistent across server (Netlify UTC) and client (whatever
  // browser locale).
  //
  // Allowlist (use eslint-disable-next-line with a one-line reason):
  // - Server-side telemetry / log lines that aren't user-visible.
  // - Third-party SDK callbacks (Razorpay, Daily, etc.) where the
  //   library hands us a Date and we're stringifying for ITS log.
  // - The formatIST helper itself doesn't trip — it uses
  //   Intl.DateTimeFormat directly, not the toLocale* methods.
  //
  // The helper file itself is allowlisted so its internal AM/PM
  // .replace() doesn't trip if a future contributor adds a
  // toLocaleString anywhere inside it.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/time/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='toLocaleString'][arguments.length=0]",
          message:
            "Don't use Date.toLocaleString() — use formatIST() from @/lib/time/formatIST. See T51 brief for format tokens.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString']",
          message:
            "Don't use Date.toLocaleDateString() — use formatIST(value, 'date') or formatIST(value, 'dateLong') from @/lib/time/formatIST.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleTimeString']",
          message:
            "Don't use Date.toLocaleTimeString() — use formatIST(value, 'time') from @/lib/time/formatIST.",
        },
      ],
    },
  },
]);

export default eslintConfig;
