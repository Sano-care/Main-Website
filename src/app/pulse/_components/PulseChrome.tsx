"use client";

import { useState, type ReactNode } from "react";

import PulseAppBar from "./PulseAppBar";
import PulseDrawer from "./PulseDrawer";

/**
 * T90 Pulse v1 Phase 1 — Chrome wrapper owning drawer open/close state.
 *
 * Layout responsibility:
 *   - Renders <PulseDrawer /> first (so the lg-rail occupies the left column)
 *   - Renders main content column with <PulseAppBar /> on top + children
 *   - On lg+: drawer is a 16rem-wide sticky left rail, main content reserves
 *     `lg:ml-64` so it doesn't underlap. Drawer ignores `isOpen` on lg+.
 *   - On <lg: drawer slides in over content, controlled by `isOpen`.
 *
 * Why client: drawer open/close is a useState bool shared between the
 * AppBar's hamburger (mutator) and the Drawer (consumer). Server can't
 * hold that state.
 *
 * The {children} prop is the page subtree from the Pulse layout — Next.js
 * App Router pre-renders server-component children before passing them
 * through a client component, so server pages render fine here.
 */
export default function PulseChrome({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-white lg:gap-0">
      <PulseDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Main column. `min-w-0` so flex children with overflowing content */}
      {/* (e.g., long booking codes) don't blow out the page width. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <PulseAppBar onMenuClick={() => setDrawerOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
