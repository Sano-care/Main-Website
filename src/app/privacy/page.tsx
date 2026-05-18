import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { LEGAL_CONTENT } from "@/constants/cms-content";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Sanocare collects, processes, stores, and protects your personal data under the DPDP Act 2023. Grievance officer details included.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalLayout doc={LEGAL_CONTENT.privacy} />;
}
