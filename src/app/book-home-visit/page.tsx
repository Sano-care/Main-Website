import type { Metadata } from "next";
import { BookLanding } from "@/components/book/BookLanding";

// Paid landing page (Google Ads). Rendered content so the policy classifier
// sees a real page; conversion fires on load; WhatsApp is a button click.
export const metadata: Metadata = {
  title: "Sanocare — Book",
  robots: { index: false, follow: false },
};

const MESSAGE = "Hi Sanocare, I'm interested in Home Visit + Doctor Consult";

export default function BookHomeVisitPage() {
  return (
    <BookLanding
      service="home_visit"
      value={500}
      hero="Sanocare Medic visits your home. Doctor consults on video."
      subhead="South Delhi. Medic arrives within 30 minutes of confirmation. From ₹499 onwards."
      bullets={[
        "Trained Sanocare Medic for vitals and sample collection",
        "NMC-licensed doctor on live video for diagnosis and prescription",
        "Care for elders, post-surgery, and chronic conditions",
        "Free cancellation before the Medic departs",
      ]}
      waUrl={`https://wa.me/919711977782?text=${encodeURIComponent(MESSAGE)}`}
    />
  );
}
