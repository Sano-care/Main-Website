"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarCheck2,
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
} from "lucide-react";
import Image from "next/image";
import { useOpsAuth } from "../OpsAuthProvider";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { href: "/ops/bookings", label: "Bookings", icon: CalendarCheck2 },
  { href: "/ops/sessions", label: "Patient sessions", icon: Activity },
  { href: "/ops/payments", label: "Payments", icon: CreditCard },
  { href: "/ops/lab-orders", label: "Lab Orders", icon: FlaskConical },
  { href: "/ops/patients", label: "Patients", icon: Users },
  { href: "/ops/partners", label: "Partners", icon: Building2 },
  { href: "/ops/doctors", label: "Doctors", icon: Stethoscope },
  // T65 Phase 2A — interim entry pointing at the add-form. The full
  // Hub list page (/ops/medics) ships in Phase 2B; until then this
  // link bounces admins straight to the create form. Page enforces
  // admin role; this flat NAV list has no per-role filter so the
  // entry stays visible to agents (who hit the role gate on click).
  { href: "/ops/medics/new", label: "Medics", icon: HeartPulse },
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

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Left nav */}
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <Link
          href="/ops"
          className="px-5 py-5 border-b border-slate-200 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition-colors"
        >
          <Image src="/logo.svg" alt="Sanocare" width={32} height={32} className="w-8 h-8" />
          <div>
            <div className="text-sm font-bold text-slate-900">Sanocare Ops</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Internal · {role}
            </div>
          </div>
        </Link>

        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
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

      {/* Main */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
