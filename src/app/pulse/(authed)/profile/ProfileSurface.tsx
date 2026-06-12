"use client";

import Link from "next/link";
import { Users } from "lucide-react";

import type { FamilyMember } from "@/lib/family-members/types";

import { useViewingMember } from "../../_lib/MemberViewingContext";

import EmailField from "./EmailField";
import HealthNotesField from "./HealthNotesField";
import IdentityCard from "./IdentityCard";
import PlaceholderDocumentsCard from "./PlaceholderDocumentsCard";

/**
 * T90 Slice 2 Step 13 — Profile tab client surface (Surface 8).
 *
 * Server hands down `customer` + `members[]`; this client reads the
 * active viewing target via useViewingMember() and slices the right
 * subject for rendering. Re-renders when the chrome chip switches
 * viewing — EmailField stays mounted (self-only) and HealthNotesField
 * re-syncs internal state via its targetKey prop.
 *
 * Section stack per brief Surface 8:
 *   1. IdentityCard
 *   2. Account — Phone (read-only) + Email (self only)
 *   3. Health  — DOB row (dimmed) + HealthNotesField (any target)
 *   4. PlaceholderDocumentsCard
 *   5. Family count row (self-context only — "{N} family members" + Manage →)
 *
 * Per founder confirmation (3): family members have no email field
 * in Phase 1. EmailField is hidden when viewing a family member.
 */

export interface CustomerSnapshot {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  date_of_birth: string | null;
  gender: string | null;
  health_notes: string | null;
}

interface Props {
  customer: CustomerSnapshot;
  members: FamilyMember[];
}

export default function ProfileSurface({ customer, members }: Props) {
  const { viewing } = useViewingMember();

  const isSelf = viewing.kind === "self";
  const viewingMember = viewing.kind === "member" ? viewing.member : null;
  const customerFirstName = firstWord(customer.full_name);

  const targetKey = viewingMember ? viewingMember.id : "self";
  const healthNotesInitial = viewingMember
    ? (viewingMember.health_notes ?? null)
    : customer.health_notes;
  const healthNotesTarget = viewingMember
    ? ({ kind: "member" as const, memberId: viewingMember.id })
    : ("self" as const);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-5">
      {/* 1 — Identity */}
      {isSelf ? (
        <IdentityCard
          kind="self"
          fullName={customer.full_name}
          phone={customer.phone}
          dateOfBirth={customer.date_of_birth}
          gender={customer.gender}
        />
      ) : (
        <IdentityCard
          kind="member"
          member={viewingMember!}
          accountHolderFirstName={customerFirstName}
          caregiverPhone={customer.phone}
        />
      )}

      {/* 2 — Account section */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
          Account
        </h3>
        <div className="mt-3 space-y-3">
          {/* Phone — read-only */}
          <div className="px-1 py-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Phone
            </p>
            <p className="mt-0.5 text-sm font-semibold text-text-main">
              {formatIndianPhone(customer.phone)}
            </p>
          </div>
          {/* Email — self only */}
          {isSelf ? <EmailField initialEmail={customer.email} /> : null}
        </div>
      </section>

      {/* 3 — Health section */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
          Health profile
        </h3>
        <div className="mt-3 space-y-3">
          {/* DOB row — dimmed in Phase 1 (Phase 2 picker pending) */}
          <div
            aria-disabled="true"
            className="cursor-not-allowed px-1 py-1.5 opacity-60"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Date of birth
            </p>
            <p className="mt-0.5 text-sm font-medium text-text-secondary">
              Add date of birth <span aria-hidden="true">→</span>
            </p>
            <p className="mt-0.5 text-[11px] text-text-secondary">
              Coming in next update
            </p>
          </div>
          {/* Health notes — functional for any target */}
          <HealthNotesField
            initialNotes={healthNotesInitial}
            target={healthNotesTarget}
            targetKey={targetKey}
          />
        </div>
      </section>

      {/* 4 — Documents (P3 placeholder) */}
      <PlaceholderDocumentsCard />

      {/* 5 — Family count (self only — when viewing a member, the */}
      {/*     identity card already names them; family count is a */}
      {/*     "your tree" surface, not a member-self loop). */}
      {isSelf ? (
        <Link
          href="/pulse/family-members"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
              <Users className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-sm font-medium text-text-main">
              {members.length} family member{members.length === 1 ? "" : "s"}
            </span>
          </span>
          <span className="text-sm font-medium text-primary">
            Manage <span aria-hidden="true">→</span>
          </span>
        </Link>
      ) : null}
    </div>
  );
}

function firstWord(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}

function formatIndianPhone(phone: string): string {
  const digits = phone.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2)}`;
  }
  return phone;
}
