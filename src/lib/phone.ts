/**
 * Canonical Indian-phone normalizer used by every customer create / update /
 * lookup path. Returns null when the input can't be canonicalised — callers
 * decide whether to reject the row or store the original verbatim.
 *
 * SQL twin: public.normalise_indian_phone(text) from migration 016. Keep the
 * two in sync.
 */
export function normaliseIndianPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, "");
  let local: string;
  if (digits.length === 10) {
    local = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    local = digits.slice(2);
  } else {
    return null;
  }
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

/** True iff `input` parses to a valid Indian E.164 number. */
export function isValidIndianPhone(input: string | null | undefined): boolean {
  return normaliseIndianPhone(input) !== null;
}
