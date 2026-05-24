"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";

/**
 * Sign-out client island. POSTs /api/doctor/logout (which clears the
 * sanocare_doctor_session cookie), then navigates to /doctor/login. The
 * logout endpoint always succeeds, so we don't branch on the response —
 * we just race the navigation against it.
 */
export function DoctorSignOutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      try {
        await fetch("/api/doctor/logout", { method: "POST" });
      } catch {
        /* logout is best-effort — even if the network call fails, the
           safest thing is still to navigate to /doctor/login (which
           re-runs the layout auth gate and reveals a stale cookie). */
      }
      router.replace("/doctor/login");
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
      Sign out
    </button>
  );
}
