// Pure presentation helper for OpsShell's mobile slide-in sidebar.
// Extracted so the open/closed → transform-class mapping is unit-testable in
// the repo's node-only vitest env (no DOM renderer / new dependency needed).

export const SIDEBAR_BASE =
  "fixed lg:static inset-y-0 left-0 z-50 w-64 shrink-0 bg-white border-r " +
  "border-slate-200 flex flex-col transform transition-transform " +
  "duration-200 ease-out lg:translate-x-0";

/**
 * Sidebar wrapper classes.
 * - Mobile: slides in (`translate-x-0`) when `open`, sits off-canvas
 *   (`-translate-x-full`) when closed.
 * - Desktop (lg): `lg:static` + `lg:translate-x-0` keep it permanently
 *   visible in normal flow regardless of `open`.
 */
export function sidebarClassName(open: boolean): string {
  return `${SIDEBAR_BASE} ${open ? "translate-x-0" : "-translate-x-full"}`;
}
