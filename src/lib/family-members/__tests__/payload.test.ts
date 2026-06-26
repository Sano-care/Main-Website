import { describe, expect, it } from "vitest";

import { buildFamilyMemberPayload } from "../payload";
import { ALL_GENDERS, ALL_RELATIONS } from "../types";

// Pulse A1 Part 2 — the add-path enum contract. The route + DB CHECK are the
// ultimate enforcers; this guards the client never sends a label or a stray
// relation_other that would trip them.

describe("buildFamilyMemberPayload", () => {
  it("sends relation as the EXACT enum, never a label", () => {
    const p = buildFamilyMemberPayload({
      name: "Anjali",
      relation: "spouse",
      relationOther: "Wife", // present but MUST be dropped (relation !== 'other')
      dob: "",
      gender: "",
      notes: "",
    });
    expect(p.relation).toBe("spouse");
    expect((ALL_RELATIONS as readonly string[]).includes(p.relation)).toBe(true);
    expect(p.relation_other).toBeNull(); // never leaks the "Wife" label
  });

  it("keeps relation_other ONLY when relation === 'other' (trimmed)", () => {
    const other = buildFamilyMemberPayload({
      name: "X",
      relation: "other",
      relationOther: "  Father-in-law  ",
      dob: "",
      gender: "",
      notes: "",
    });
    expect(other.relation).toBe("other");
    expect(other.relation_other).toBe("Father-in-law");

    for (const r of ALL_RELATIONS.filter((x) => x !== "other")) {
      const p = buildFamilyMemberPayload({
        name: "X",
        relation: r,
        relationOther: "should be dropped",
        dob: "",
        gender: "",
        notes: "",
      });
      expect(p.relation_other).toBeNull();
    }
  });

  it("sends gender as the exact enum or null (never the '' placeholder)", () => {
    expect(
      buildFamilyMemberPayload({
        name: "X",
        relation: "father",
        relationOther: "",
        dob: "",
        gender: "",
        notes: "",
      }).gender,
    ).toBeNull();

    for (const g of ALL_GENDERS) {
      const p = buildFamilyMemberPayload({
        name: "X",
        relation: "father",
        relationOther: "",
        dob: "",
        gender: g,
        notes: "",
      });
      expect(p.gender).toBe(g);
    }
  });

  it("trims name; empty dob/notes → null", () => {
    const p = buildFamilyMemberPayload({
      name: "  Ramesh Kumar  ",
      relation: "father",
      relationOther: "",
      dob: "",
      gender: "male",
      notes: "   ",
    });
    expect(p.name).toBe("Ramesh Kumar");
    expect(p.dob).toBeNull();
    expect(p.notes).toBeNull();
  });

  it("passes through a valid dob and trimmed notes", () => {
    const p = buildFamilyMemberPayload({
      name: "Sita",
      relation: "mother",
      relationOther: "",
      dob: "1968-04-12",
      gender: "female",
      notes: "  diabetic, on metformin ",
    });
    expect(p.dob).toBe("1968-04-12");
    expect(p.notes).toBe("diabetic, on metformin");
  });
});
