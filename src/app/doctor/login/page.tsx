import type { Metadata } from "next";
import { DoctorLoginForm } from "./DoctorLoginForm";

export const metadata: Metadata = {
  title: "Doctor sign-in · Sanocare",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DoctorLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const params = await searchParams;
  const reason = params.reason === "inactive" ? "inactive" : null;
  return <DoctorLoginForm initialReason={reason} />;
}
