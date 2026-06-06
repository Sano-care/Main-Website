import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { ProfileMenu } from "./ProfileMenu";

// Shared blue app-bar for the interior Pulse pages (vitals, medications).
// Mirrors the mockup's .app-bar: brand-blue background, circular back affordance
// on the left, title centred-ish, account menu on the right. Pass `action` to
// override the right slot (e.g. a PDF-export button); it defaults to the
// account/sign-out menu so every interior page surfaces sign-out.

export function PulsePageHeader({
  title,
  backHref = "/pulse",
  action,
}: {
  title: string;
  backHref?: string;
  action?: ReactNode;
}) {
  return (
    <header className="bg-primary text-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
        <Link
          href={backHref}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold tracking-tight">{title}</h1>
        <div className="flex h-9 min-w-9 items-center justify-end">
          {action ?? <ProfileMenu variant="icon" />}
        </div>
      </div>
    </header>
  );
}
