import Image from "next/image";
import Link from "next/link";
import { Shield, Home, FileText } from "lucide-react";
import { DoctorSignOutButton } from "./DoctorSignOutButton";

/**
 * Minimal chrome for the doctor portal — single page, no left-nav (the
 * portal only has one surface in C1: the doctor home). The header carries
 * identity and a sign-out button; main is a content area.
 *
 * Server component; the only client island is the sign-out button.
 */
export function DoctorShell({
  doctorCode,
  fullName,
  doctorType,
  children,
}: {
  doctorCode: string;
  fullName: string;
  doctorType: "freelancer" | "salaried";
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Image src="/logo.svg" alt="Sanocare" width={32} height={32} className="w-8 h-8" />
            <div>
              <div className="text-sm font-bold text-slate-900">Sanocare Doctor</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Read-only · session 8h
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              <Link
                href="/doctor"
                className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-md hover:bg-slate-100"
              >
                <Home className="w-3.5 h-3.5" /> Home
              </Link>
              <Link
                href="/doctor/prescriptions"
                className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-md hover:bg-slate-100"
              >
                <FileText className="w-3.5 h-3.5" /> Prescriptions
              </Link>
            </nav>
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-900">{fullName}</div>
              <div className="text-[11px] font-mono text-slate-500">
                {doctorCode} · {doctorType}
              </div>
            </div>
            <DoctorSignOutButton />
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
