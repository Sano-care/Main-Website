"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarCheck2,
  MessagesSquare,
  CreditCard,
  FlaskConical,
  Users,
  Building2,
  Stethoscope,
  HeartPulse,
  Microscope,
  Settings,
  LogOut,
  Shield,
  FileText,
  Menu,
  X,
} from "lucide-react";
import Image from "next/image";
import { useOpsAuth } from "../OpsAuthProvider";
import { sidebarClassName } from "./opsShellClasses";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { href: "/ops/bookings", label: "Bookings", icon: CalendarCheck2 },
  { href: "/ops/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/ops/sessions", label: "Patient sessions", icon: Activity },
  { href: "/ops/payments", label: "Payments", icon: CreditCard },
  { href: "/ops/lab-orders", label: "Lab Orders", icon: FlaskConical },
  { href: "/ops/patients", label: "Patients", icon: Users },
  { href: "/ops/partners", label: "Partners", icon: Building2 },
  { href: "/ops/doctors", label: "Doctors", icon: Stethoscope },
  // T65 Phase 2B — Medics Hub list page. agent role sees read-only;
  // admin sees Add Medic / edit / deactivate. No NAV-level role filter
  // (page-level gate is sufficient).
  { href: "/ops/medics", label: "Medics", icon: HeartPulse },
  { href: "/ops/prescriptions", label: "Prescriptions", icon: FileText },
  { href: "/ops/labs", label: "Labs", icon: Microscope },
  { href: "/ops/settings", label: "Settings", icon: Settings },
];

interface OpsShellProps {
  fullName: string;
  email: string;
  role: string;
  children: React.ReactNode;
}

export function OpsShell({ fullName, email, role, children }: OpsShellProps) {
  const pathname = usePathname();
  const { signOut } = useOpsAuth();
  // Mobile sidebar open/closed. Local-only, defaults closed on every page load
  // (WhatsApp-native pattern — navigation = focused intent). No persistence.
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Esc closes the mobile sidebar.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Mobile backdrop — tap to dismiss. Below the sidebar (z-50), above
          the app-bar (z-30) so the open sidebar owns the screen. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Left nav — fixed slide-in overlay on mobile, static column on desktop */}
      <aside aria-label="Ops navigation" className={sidebarClassName(open)}>
        <div className="flex items-center justify-between border-b border-slate-200 pr-2">
          <Link
            href="/ops"
            onClick={close}
            className="flex flex-1 items-center gap-3 px-5 py-5 cursor-pointer hover:bg-slate-50 transition-colors"
          >
            <Image src="/logo.svg" alt="Sanocare" width={32} height={32} className="w-8 h-8" />
            <div>
              <div className="text-sm font-bold text-slate-900">Sanocare Ops</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Internal · {role}
              </div>
            </div>
          </Link>
          {/* Close (mobile only) */}
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="lg:hidden shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={close}
                    className={
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors " +
                      (active
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100")
                    }
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="px-3 py-4 border-t border-slate-200">
          <div className="px-3 py-2 mb-2">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Shield className="w-3 h-3" />
              Signed in
            </div>
            <div className="text-sm font-semibold text-slate-900 truncate">{fullName}</div>
            <div className="text-xs text-slate-500 truncate">{email}</div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Right column: mobile app-bar (hamburger) + main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top app-bar — hidden on desktop (sidebar is always visible). */}
        <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="-ml-1 rounded-lg p-2 text-slate-700 hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Image src="/logo.svg" alt="" width={24} height={24} className="h-6 w-6" />
          <span className="text-sm font-bold text-slate-900">Sanocare Ops</span>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
