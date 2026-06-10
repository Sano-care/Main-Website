import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the `@/*` -> `src/*` path alias (mirrors tsconfig.json) so unit
// tests can exercise modules that import via the alias, the way the rest
// of the codebase does. Additive: relative-import tests are unaffected.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
