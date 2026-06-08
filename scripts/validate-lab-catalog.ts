/**
 * T85 PR4b — Lab catalog build-time validator.
 *
 * Confirms every Pathcore code referenced in `src/lib/services/labCatalog.ts`
 * resolves in the live `lab_tests` Supabase table. Errors loudly if any
 * code is missing — catches Pathcore code rotations before they silently
 * break the Common Tests grid.
 *
 * Wired into `package.json` as a `prebuild` hook. Local dev runs it via
 * `npm run validate:lab-catalog`. CI runs it as part of `npm run build`.
 *
 * Skips gracefully when SUPABASE env vars are missing (e.g. local dev
 * without secrets, or PR-preview builds before secrets are wired). The
 * intent is to catch real catalog drift in CI, not to block every
 * incidental build. Founder runs this manually before launch to confirm
 * a clean reference state.
 */

import { createClient } from "@supabase/supabase-js";
import { allReferencedPathcoreCodes } from "../src/lib/services/labCatalog";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn(
      "[validate-lab-catalog] SUPABASE env vars missing — skipping validation.",
    );
    console.warn(
      "[validate-lab-catalog] Run with NEXT_PUBLIC_SUPABASE_URL + a SUPABASE key set to enforce.",
    );
    return;
  }

  const codes = allReferencedPathcoreCodes();
  console.log(
    `[validate-lab-catalog] checking ${codes.length} Pathcore code(s) referenced in labCatalog.ts…`,
  );

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("lab_tests")
    .select("code")
    .in("code", codes);

  if (error) {
    console.error("[validate-lab-catalog] supabase query failed:", error);
    process.exit(1);
  }

  const foundCodes = new Set((data ?? []).map((r: { code: string }) => r.code));
  const missing = codes.filter((c) => !foundCodes.has(c));

  if (missing.length > 0) {
    console.error(
      `\n[validate-lab-catalog] ❌ ${missing.length} Pathcore code(s) missing in lab_tests table:`,
    );
    for (const c of missing) console.error(`  - ${c}`);
    console.error(
      "\nEither Pathcore rotated the code OR labCatalog.ts is stale. Resolve before merging.",
    );
    process.exit(1);
  }

  console.log(
    `[validate-lab-catalog] ✅ all ${codes.length} Pathcore codes resolved.`,
  );
}

main().catch((err) => {
  console.error("[validate-lab-catalog] unexpected error:", err);
  process.exit(1);
});
