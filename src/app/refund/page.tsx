import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { LEGAL_CONTENT } from "@/constants/cms-content";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy",
  description:
    "Full refund of the booking fee before medic dispatch. Honest, customer-friendly cancellation terms with clear timelines.",
  alternates: { canonical: "/refund" },
};

export default function RefundPage() {
  return <LegalLayout doc={LEGAL_CONTENT.refund} />;
}
