"use client";

import { relationDisplayLabel } from "@/lib/family-members/relations";
import type { FamilyMember } from "@/lib/family-members/types";

/**
 * T90 Slice 2 Step 13 — Identity card (Profile tab, top of page).
 *
 * Branches on viewing target:
 *   self    → avatar with caregiver's initials, full_name, age (from
 *             customers.date_of_birth — Phase 2 will surface picker),
 *             gender, formatted phone, "That's you." relation line.
 *   family  → avatar with family member's initials, name, age (from
 *             family_members.dob), gender, parent caregiver's phone
 *             (Phase 1 — no per-member phone capture yet),
 *             "{relation} of {accountHolderFirstName}" relation line.
 *
 * Fallbacks (founder confirmation 6):
 *   - no photo → initials avatar (always — no photo upload in Phase 1)
 *   - no age (no dob) → omit the age dot in the meta line
 *   - no gender → omit the gender dot in the meta line
 *   - no relation (defensive) → omit the relation line
 */

interface SelfProps {
  kind: "self";
  fullName: string | null;
  phone: string;
  dateOfBirth: string | null;
  gender: string | null;
}

interface MemberProps {
  kind: "member";
  member: FamilyMember;
  /** First word of customers.full_name — for "Daughter of {Shashwat}". */
  accountHolderFirstName: string | null;
  /** Caregiver's phone — Phase 1 has no per-member phone capture. */
  caregiverPhone: string;
}

type Props = SelfProps | MemberProps;

export default function IdentityCard(props: Props) {
  if (props.kind === "self") {
    return (
      <CardShell
        initials={deriveInitials(props.fullName)}
        name={props.fullName ?? "Your account"}
        metaParts={metaLine({
          age: computeAge(props.dateOfBirth),
          gender: props.gender,
        })}
        phoneDisplay={formatIndianPhone(props.phone)}
        relationLine="That's you."
      />
    );
  }

  const { member, accountHolderFirstName, caregiverPhone } = props;
  const relation = relationDisplayLabel(member.relation, member.relation_other);
  const relationLine = accountHolderFirstName
    ? `${relation} of ${accountHolderFirstName}`
    : relation;

  return (
    <CardShell
      initials={deriveInitials(member.name)}
      name={member.name}
      metaParts={metaLine({
        age: computeAge(member.dob),
        gender: member.gender ?? null,
      })}
      phoneDisplay={formatIndianPhone(caregiverPhone)}
      relationLine={relationLine}
    />
  );
}

interface ShellProps {
  initials: string;
  name: string;
  metaParts: string[];
  phoneDisplay: string;
  relationLine: string;
}

function CardShell({
  initials,
  name,
  metaParts,
  phoneDisplay,
  relationLine,
}: ShellProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-coral text-base font-semibold text-white">
          {initials}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-text-main">{name}</h2>
          {metaParts.length > 0 ? (
            <p className="mt-0.5 text-xs text-text-secondary">
              {metaParts.join(" · ")}
            </p>
          ) : null}
          <p className="mt-0.5 text-xs text-text-secondary">{phoneDisplay}</p>
          {relationLine ? (
            <p className="mt-1 text-xs font-medium text-primary">
              {relationLine}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ====== helpers =====================================================

function metaLine(args: {
  age: number | null;
  gender: string | null;
}): string[] {
  const out: string[] = [];
  if (args.age !== null) out.push(`Age ${args.age}`);
  if (args.gender && args.gender.trim()) out.push(formatGender(args.gender));
  return out;
}

function formatGender(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "male") return "Male";
  if (key === "female") return "Female";
  if (key === "other") return "Other";
  if (key === "prefer-not-to-say" || key === "prefer_not_to_say") return "—";
  // Defensive fallthrough — render whatever was stored, capitalised.
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function deriveInitials(fullName: string | null): string {
  if (!fullName) return "•";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) {
    const w = parts[0];
    return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
  }
  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  const initials = `${first}${last}`.toUpperCase();
  return initials || "•";
}

function formatIndianPhone(phone: string): string {
  const digits = phone.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2)}`;
  }
  return phone;
}
