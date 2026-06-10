"use client";

import { useState, type ReactNode } from "react";

import { MemberViewingProvider } from "../_lib/MemberViewingContext";
import MemberSwitcherSheet from "./MemberSwitcherSheet";
import PulseAppBar from "./PulseAppBar";
import PulseAvatarMenu from "./PulseAvatarMenu";
import PulseDrawer from "./PulseDrawer";

/**
 * T90 Pulse v1 Phase 1 — Chrome wrapper.
 *
 * Owns three overlay states (drawer, member-switcher sheet, avatar menu)
 * and wraps the authed pulse tree in <MemberViewingProvider /> so every
 * chrome surface shares one viewing state.
 *
 * Layout (mobile): vertical stack — fixed slide-in drawer, sticky AppBar,
 * scrollable {children}, optional overlays.
 * Layout (lg+): two-column — sticky left rail drawer (16rem), main
 * column with sticky AppBar + scrollable {children}. Overlays still
 * render on top when open.
 *
 * Avatar-menu → member-switcher hand-off:
 *   Avatar menu's "Switch member" closes the menu (via its internal
 *   onClose) AND tells this chrome to open the sheet (via
 *   onSwitchMember). Both state updates fire in the same React tick,
 *   so framer-motion cross-fades the exit + enter cleanly. The two
 *   surfaces share the same easing so the transition reads as one
 *   continuous motion, not two stacked animations.
 *
 * Why client: drawer + sheet + avatar-menu open/close are useState
 * bools shared across multiple chrome components. Server can't hold
 * that state.
 *
 * The {children} prop is the page subtree from the Pulse layout. Next.js
 * App Router pre-renders server-component children before passing them
 * through a client component, so server pages render fine here.
 */
export default function PulseChrome({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);

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
            onAvatarClick={() => setAvatarMenuOpen(true)}
          />
          <main className="flex-1">{children}</main>
        </div>

        {/* Overlays — both render inside the chrome tree so they can */}
        {/* read viewing/customer context. AnimatePresence in each handles */}
        {/* enter/exit independently. */}
        <MemberSwitcherSheet
          open={memberSheetOpen}
          onClose={() => setMemberSheetOpen(false)}
        />
        <PulseAvatarMenu
          open={avatarMenuOpen}
          onClose={() => setAvatarMenuOpen(false)}
          onSwitchMember={() => setMemberSheetOpen(true)}
        />
      </div>
    </MemberViewingProvider>
  );
}
