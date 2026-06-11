"use client";

// Single family-member tile: shown in the list at /pulse/family-members.
//
// Compact card with name + relation + age. Tap the card itself opens edit;
// the delete action lives in a small icon button to the right so a stray
// tap can't trigger destructive flow.

import { Pencil, Trash2 } from "lucide-react";

import type { FamilyMember } from "@/lib/family-members/types";
import {
  ageWithYearSuffix,
  relationDisplayLabel,
} from "@/lib/family-members/relations";

interface Props {
  member: FamilyMember;
  onEdit: () => void;
  onDelete: () => void;
}

export function MemberCard({ member, onEdit, onDelete }: Props) {
  const relationLabel = relationDisplayLabel(
    member.relation,
    member.relation_other,
  );
  const age = ageWithYearSuffix(member.dob);
  const showAge = member.dob != null; // skip the "—y" placeholder in the list UI

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-1 items-center gap-3 text-left"
        aria-label={`Edit ${member.name}`}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-50 text-base font-bold text-primary">
          {member.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-main">
            {member.name}
          </div>
          <div className="truncate text-xs text-text-secondary">
            {relationLabel}
            {showAge ? ` · ${age}` : ""}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={onEdit}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-slate-100"
        aria-label={`Edit ${member.name}`}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-rose-500 hover:bg-rose-50"
        aria-label={`Delete ${member.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
