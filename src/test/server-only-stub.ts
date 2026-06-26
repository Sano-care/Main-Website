// Empty stub for the `server-only` marker package under vitest.
//
// `server-only` is a build-time guard Next.js resolves internally (it has no
// physical node_modules entry), so vitest — plain vite — can't resolve it when a
// server module under test imports it (e.g. customerLink.ts). vitest.config.ts
// aliases `server-only` to this no-op so those modules load in the node test env.
// Does NOT affect `next build`, which handles `server-only` itself.
export {};
