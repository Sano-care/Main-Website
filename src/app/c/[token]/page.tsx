import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isValidConsultJoinTokenFormat } from "@/lib/consult/tokens";
import { PatientJoinClient } from "./PatientJoinClient";

export const metadata: Metadata = {
  title: "Join your consultation · Sanocare",
  robots: { index: false, follow: false }, // token-gated; never index
};

export const dynamic = "force-dynamic";

type SessionStatus =
  | "scheduled"
  | "waiting"
  | "in_progress"
  | "completed"
  | "cancelled";

interface ParticipantWithSession {
  participant_id: string;
  joined_at: string | null;
  join_token_expires_at: string | null;
  customer_full_name: string | null;
  session_id: string;
  session_status: SessionStatus;
  modality: string;
  scheduled_at: string;
  duty_room_url_snapshot: string | null;
  teleconsult_consent: boolean | null;
  /** bookings.booking_code via consultation_sessions.booking_id —
   *  user-facing identifier (SAN-B-NNNNN) shown in the page header. */
  booking_code: string | null;
  /** C2-V Task #43, M029: drives the patient-side waiting-room →
   *  Daily transition. Null = patient sits in Sanocare waiting room;
   *  non-null = doctor has admitted, mount Daily. */
  doctor_admitted_at: string | null;
  /** Set by POST /api/doctor/mark-attended. Once non-null, the patient
   *  lands on the post-consult screen and Daily unmounts. SSR-loaded
   *  so a re-tap after wrap goes directly to that screen instead of
   *  flickering through waiting-room. */
  ended_at: string | null;
  /** Derived from consultation_sessions.first_admitted_at IS NOT NULL
   *  (M031). Drives the patient waiting-screen copy split — true
   *  switches to "Dr stepped out for a moment" (brief-hold);
   *  false keeps the initial "Dr will admit you shortly". */
  was_ever_admitted: boolean;
  doctor_id: string;
  doctor_code: string;
  doctor_full_name: string;
  doctor_qualification: string | null;
  doctor_duty_room_join_url: string | null;
}

/**
 * Resolve a participant token to the joined view we need to render.
 * Uses the service-role client (RLS-bypassing) because the patient is
 * unauthenticated — the token IS the auth. Same posture as
 * /reports/[token] (M008).
 *
 * Returns null on:
 *   - token not present in DB
 *   - participant.role is not 'patient' (defensive — only patient rows
 *     ever get a token in C2)
 */
async function fetchParticipantByToken(
  token: string,
): Promise<ParticipantWithSession | null> {
  // Two-step lookup to keep the query simple and the join shape obvious.
  // 1. participant + session via the FK from consultation_participants
  // 2. doctor + customer name lookups on the resolved ids
  const { data: participant, error: participantErr } = await supabaseAdmin
    .from("consultation_participants")
    .select(
      "id, role, customer_id, join_token, join_token_expires_at, joined_at, session_id",
    )
    .eq("join_token", token)
    .maybeSingle();
  if (participantErr || !participant) return null;
  if (participant.role !== "patient") return null;

  const [{ data: session }, { data: customer }] = await Promise.all([
    supabaseAdmin
      .from("consultation_sessions")
      .select(
        // M029: doctor_admitted_at gates the patient's Daily mount.
        // PR #22 redirect: ended_at signals Mark Attended → post-consult.
        // M031: first_admitted_at powers the brief-hold copy split.
        "id, booking_id, status, modality, scheduled_at, duty_room_url_snapshot, teleconsult_consent, doctor_admitted_at, ended_at, first_admitted_at, doctor_id",
      )
      .eq("id", participant.session_id)
      .maybeSingle(),
    participant.customer_id
      ? supabaseAdmin
          .from("customers")
          .select("full_name")
          .eq("id", participant.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!session) return null;

  // Doctor + booking lookups in parallel — both fan-out from the
  // already-loaded session row.
  const [{ data: doctor }, { data: booking }] = await Promise.all([
    supabaseAdmin
      .from("doctors")
      .select("id, doctor_code, full_name, qualification, duty_room_join_url")
      .eq("id", session.doctor_id)
      .maybeSingle(),
    supabaseAdmin
      .from("bookings")
      .select("booking_code")
      .eq("id", (session as { booking_id: string }).booking_id)
      .maybeSingle(),
  ]);
  if (!doctor) return null;

  return {
    participant_id: participant.id,
    joined_at: participant.joined_at,
    join_token_expires_at: participant.join_token_expires_at,
    customer_full_name: customer?.full_name ?? null,
    session_id: session.id,
    session_status: session.status as SessionStatus,
    modality: session.modality,
    scheduled_at: session.scheduled_at,
    duty_room_url_snapshot: session.duty_room_url_snapshot,
    teleconsult_consent: session.teleconsult_consent,
    doctor_admitted_at:
      (session as { doctor_admitted_at?: string | null })
        .doctor_admitted_at ?? null,
    ended_at:
      (session as { ended_at?: string | null }).ended_at ?? null,
    was_ever_admitted:
      (session as { first_admitted_at?: string | null })
        .first_admitted_at != null,
    booking_code:
      (booking as { booking_code?: string | null } | null)?.booking_code ??
      null,
    doctor_id: doctor.id,
    doctor_code: doctor.doctor_code,
    doctor_full_name: doctor.full_name,
    doctor_qualification: doctor.qualification,
    doctor_duty_room_join_url: doctor.duty_room_join_url,
  };
}

export default async function PatientJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isValidConsultJoinTokenFormat(token)) notFound();

  const data = await fetchParticipantByToken(token);
  if (!data) notFound();

  const expired =
    data.join_token_expires_at != null &&
    new Date(data.join_token_expires_at) < new Date();

  // The Duty Room URL we hand to the embedded Daily client: prefer the
  // session snapshot (denormalised at session-create), fall back to the
  // doctor's current duty_room_join_url so a doctor whose room was
  // provisioned after the session was scheduled still works. The actual
  // join needs both a URL and a fresh meeting token — the API route
  // mints the token; this URL is the host fallback only (the API also
  // resolves it from the same chain).
  const roomUrl =
    data.duty_room_url_snapshot ?? data.doctor_duty_room_join_url ?? null;

  return (
    <div className="min-h-screen bg-background-light">
      <div className="mx-auto max-w-xl px-6 py-12 lg:py-20">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Sanocare
        </Link>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="font-mono text-[11px] tracking-widest uppercase text-primary mb-1">
              Sanocare teleconsultation
            </div>
            <h1 className="text-2xl font-bold text-text-main">
              {data.customer_full_name
                ? `Hi ${data.customer_full_name.split(" ")[0]},`
                : "Hi,"}{" "}
              your consultation is ready.
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              {data.booking_code
                ? <>Booking <span className="font-mono">{data.booking_code}</span></>
                : <>Booking #{data.session_id.slice(0, 8)}</>}
              {" "}·{" "}
              {/* Server-side render runs in Netlify's UTC, so toLocaleString
                  used to emit UTC like "30 May 2026, 1:28 pm" while the
                  inner scheduled-time pill showed IST "6:58 pm" — same
                  booking, two different times in the header. Explicit
                  Asia/Kolkata timezone via Intl.DateTimeFormat forces IST
                  everywhere this server-renders. Other UTC leakages are
                  out of scope here — Task #51 sweeps the system. */}
              {new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              }).format(new Date(data.scheduled_at))}
            </p>
          </div>

          {/* Doctor identity card — NMC requirement: doctor's identity
              must be disclosed to the patient before a teleconsultation. */}
          <div className="px-6 py-5 border-b border-slate-100">
            <div className="font-mono text-[10px] tracking-widest uppercase text-text-secondary mb-3">
              Your doctor
            </div>
            <div className="text-text-main font-semibold">
              {data.doctor_full_name}
            </div>
            {data.doctor_qualification && (
              <div className="text-sm text-text-secondary mt-0.5">
                {data.doctor_qualification}
              </div>
            )}
            <div className="text-xs text-text-secondary font-mono mt-1">
              {data.doctor_code}
            </div>
          </div>

          {/* State-specific body */}
          <div className="px-6 py-6">
            <StateBody
              token={token}
              status={data.session_status}
              expired={expired}
              roomUrl={roomUrl}
              patientName={data.customer_full_name}
              alreadyConsented={data.teleconsult_consent === true}
              sessionId={data.session_id}
              joinedAt={data.joined_at}
              admittedAt={data.doctor_admitted_at}
              endedAt={data.ended_at}
              wasEverAdmitted={data.was_ever_admitted}
              doctorFullName={data.doctor_full_name}
              doctorQualification={data.doctor_qualification}
              scheduledAt={data.scheduled_at}
            />
          </div>

          <div className="bg-slate-50 px-6 py-4 text-xs text-text-secondary">
            Trouble joining? Call us at{" "}
            <a href="tel:+919711977782" className="text-primary underline">
              +91-97119 77782
            </a>
            . This link is private — please don&apos;t forward it.
          </div>
        </div>

        <p className="mt-6 text-xs text-text-secondary text-center">
          Sanocare Tech Innovations Pvt. Ltd. · NMC Telemedicine Practice
          Guidelines 2020 compliant
        </p>
      </div>
    </div>
  );
}

function StateBody({
  token,
  status,
  expired,
  roomUrl,
  patientName,
  alreadyConsented,
  sessionId,
  joinedAt,
  admittedAt,
  endedAt,
  wasEverAdmitted,
  doctorFullName,
  doctorQualification,
  scheduledAt,
}: {
  token: string;
  status: SessionStatus;
  expired: boolean;
  roomUrl: string | null;
  patientName: string | null;
  alreadyConsented: boolean;
  sessionId: string;
  joinedAt: string | null;
  admittedAt: string | null;
  endedAt: string | null;
  wasEverAdmitted: boolean;
  doctorFullName: string;
  doctorQualification: string | null;
  scheduledAt: string;
}) {
  if (status === "cancelled") {
    return (
      <Notice
        tone="rose"
        title="This consultation was cancelled."
        body="If you believe this is wrong, please call ops on +91-97119 77782."
      />
    );
  }
  if (status === "completed") {
    return (
      <Notice
        tone="slate"
        title="This consultation has ended."
        body="If you need a follow-up, please book again from sanocare.in."
      />
    );
  }
  if (expired) {
    return (
      <Notice
        tone="amber"
        title="This link has expired."
        body="Please contact ops on +91-97119 77782 to receive a fresh join link."
      />
    );
  }
  if (!roomUrl) {
    return (
      <Notice
        tone="amber"
        title="Your doctor's room isn't set up yet."
        body="Please call ops on +91-97119 77782 — we'll sort this out and send you a fresh link."
      />
    );
  }
  return (
    <PatientJoinClient
      token={token}
      patientName={patientName}
      alreadyConsented={alreadyConsented}
      sessionId={sessionId}
      initialJoinedAt={joinedAt}
      initialAdmittedAt={admittedAt}
      initialEndedAt={endedAt}
      initialWasEverAdmitted={wasEverAdmitted}
      doctorFullName={doctorFullName}
      doctorQualification={doctorQualification}
      scheduledAt={scheduledAt}
    />
  );
}

function Notice({
  tone,
  title,
  body,
}: {
  tone: "rose" | "amber" | "slate";
  title: string;
  body: string;
}) {
  const toneCls =
    tone === "rose"
      ? "bg-rose-50 border-rose-200 text-rose-900"
      : tone === "amber"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : "bg-slate-50 border-slate-200 text-slate-900";
  return (
    <div className={`rounded-xl border p-4 ${toneCls}`}>
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-sm opacity-90">{body}</div>
    </div>
  );
}
