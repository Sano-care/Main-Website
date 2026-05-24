import { DoctorShell } from "../_components/DoctorShell";
import { getCurrentDoctor } from "../_lib/getCurrentDoctor";

// Force per-request render so the cookie is re-read every navigation.
// Same posture as /ops/(shell)/layout.
export const dynamic = "force-dynamic";

/**
 * Layout-only auth gate. Calling getCurrentDoctor() either resolves to a
 * valid doctor record or short-circuits via redirect() — there is no
 * middleware for /doctor in C1 (the patient OTP flow doesn't use one
 * either; we mirror that). An ops or patient browser session reaching
 * /doctor/* has no `sanocare_doctor_session` cookie, so the gate fails
 * closed and they land at /doctor/login.
 */
export default async function DoctorShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const doctor = await getCurrentDoctor();
  return (
    <DoctorShell
      doctorCode={doctor.doctor_code}
      fullName={doctor.full_name}
      doctorType={doctor.doctor_type}
    >
      {children}
    </DoctorShell>
  );
}
