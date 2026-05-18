import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { LEGAL_CONTENT } from "@/constants/cms-content";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing your use of Sanocare's home healthcare services. Booking, payment, eligibility, our obligations, liability, governing law.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalLayout doc={LEGAL_CONTENT.terms} />;
}
