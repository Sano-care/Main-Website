"use client";

import { useState, type ReactNode } from "react";

import { MemberViewingProvider } from "../_lib/MemberViewingContext";
import MemberSwitcherSheet from "./MemberSwitcherSheet";
import PulseAppBar from "./PulseAppBar";
import PulseDrawer from "./PulseDrawer";

/**
 * T90 Pulse v1 Phase 1 — Chrome wrapper.
 *
 * Owns the open/close state for both the hamburger drawer and the
 * member-switcher sheet, and wraps the authed pulse tree in the
 * <MemberViewingProvider /> so AppBar / Drawer / Sheet share one
 * viewing state.
 *
 * Layout (mobile): vertical stack — fixed slide-in drawer, sticky
 * AppBar, scrollable {children}, optional sheet overlay.
 * Layout (lg+): two-column — sticky left rail drawer (16rem), main
 * column with sticky AppBar + scrollable {children}. Sheet still
 * overlays on top when open.
 *
 * Why client: drawer + sheet open/close state are useState bools shared
 * across multiple chrome components. Server can't hold that state.
 *
 * The {children} prop is the page subtree from the Pulse layout. Next.js
 * App Router pre-renders server-component children before passing them
 * through a client component, so server pages render fine here.
 */
export default function PulseChrome({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [memberSheetOpen, setMemberSheetOpen] = useState(false);

  return (
    <MemberViewingProvider>
      <div className="flex min-h-screen bg-white lg:gap-0">
        <PulseDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />

        {/* Main column. `min-w-0` so flex children with overflowing */}
        {/* content (e.g., long booking codes) don't blow out width. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <PulseAppBar
            onMenuClick={() => setDrawerOpen(true)}
            onMemberChipClick={() => setMemberSheetOpen(true)}
          />
          <main className="flex-1">{children}</main>
        </div>

        {/* Sheet renders inside the chrome tree so it can read viewing */}
        {/* context. AnimatePresence inside the sheet handles enter/exit. */}
        <MemberSwitcherSheet
          open={memberSheetOpen}
          onClose={() => setMemberSheetOpen(false)}
        />
      </div>
    </MemberViewingProvider>
  );
}
