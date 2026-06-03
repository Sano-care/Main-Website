import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit/integration tests for the WhatsApp agent. Node environment (these are
// server-side modules); `@/` resolves to ./src to match tsconfig paths.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
