// Helpers for the customer-profile UX: derived age + profile-completeness
// nudge. Both are pure functions — safe to call from server or client code.

export function computeAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}

// Fields the completeness score is built from. Order matches the form
// layout so the "missing" list reads naturally to the user.
const COMPLETENESS_FIELDS = [
  { key: "date_of_birth", label: "date of birth" },
  { key: "gender", label: "gender" },
  { key: "email", label: "email" },
  { key: "address_line", label: "address" },
  { key: "area", label: "area" },
  { key: "city", label: "city" },
  { key: "pincode", label: "pincode" },
] as const;

export type CompletenessInput = {
  date_of_birth?: string | null;
  gender?: string | null;
  email?: string | null;
  address_line?: string | null;
  area?: string | null;
  city?: string | null;
  pincode?: string | null;
};

export function computeCompleteness(c: CompletenessInput): {
  percent: number;
  filled: number;
  total: number;
  missing: string[];
} {
  let filled = 0;
  const missing: string[] = [];
  for (const f of COMPLETENESS_FIELDS) {
    const v = c[f.key as keyof CompletenessInput];
    if (v != null && String(v).trim() !== "") {
      filled++;
    } else {
      missing.push(f.label);
    }
  }
  const total = COMPLETENESS_FIELDS.length;
  return {
    percent: Math.round((filled / total) * 100),
    filled,
    total,
    missing,
  };
}
