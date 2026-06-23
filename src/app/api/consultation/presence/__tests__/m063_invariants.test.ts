// C3 C4 — M063 bridge invariants.
//
// The threshold mark, freelancer no-op, double-post guard, and upsert
// idempotency live in the SQL trigger (verified end-to-end against live
// doctors in a rolled-back transaction during the build). They can't run in
// vitest without a Postgres, so this test locks the SQL's critical guards
// against regression: if someone edits 063 and drops a guard, a test breaks.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/063_presence_to_attendance.sql"),
  "utf8",
);

describe("M063 presence→attendance bridge invariants", () => {
  it("threshold is 30 minutes", () => {
    expect(sql).toMatch(/v_min_minutes\s+constant\s+int\s*:=\s*30/);
  });

  it("only salaried doctors auto-mark — freelancers are a no-op", () => {
    expect(sql).toMatch(/doctor_type\s+IS\s+DISTINCT\s+FROM\s+'salaried'/i);
  });

  it("double-post is guarded by ON CONFLICT (doctor_id, work_date) DO NOTHING", () => {
    expect(sql).toMatch(/ON CONFLICT \(doctor_id, work_date\)\s+DO NOTHING/i);
  });

  it("is idempotent: short-circuits once attendance_auto_marked_at is set, and stamps it", () => {
    expect(sql).toMatch(/attendance_auto_marked_at IS NOT NULL/i);
    expect(sql).toMatch(/NEW\.attendance_auto_marked_at\s*:=\s*now\(\)/i);
  });

  it("system-created attendance rows use created_by = NULL (created_by FKs to ops_users)", () => {
    expect(sql).toMatch(/true,\s*NULL,\s*'auto: duty-room presence/);
  });

  it("upsert preserves first_login_at on conflict — only last_seen_at advances", () => {
    expect(sql).toMatch(/DO UPDATE SET last_seen_at = now\(\)/i);
  });

  it("bridge is a BEFORE trigger so the in-place NEW stamp persists", () => {
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE ON public\.doctor_presence_log/i);
  });
});
