import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { LEGAL_CONTENT } from "@/constants/cms-content";

export const metadata: Metadata = {
  title: "Emergency Disclaimer",
  description:
    "Sanocare is a planned-care service, not an emergency response unit. For chest pain, breathlessness, stroke, severe bleeding or trauma, call 112 or 102 immediately.",
  alternates: { canonical: "/emergency" },
};

export default function EmergencyPage() {
  return <LegalLayout doc={LEGAL_CONTENT.emergency} />;
}
