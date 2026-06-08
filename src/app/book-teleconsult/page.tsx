import type { Metadata } from "next";
import { BookLanding } from "@/components/book/BookLanding";

export const metadata: Metadata = {
  title: "Sanocare — Book",
  robots: { index: false, follow: false },
};

const MESSAGE = "Hi Sanocare, I want a Teleconsultation with a doctor";

export default function BookTeleconsultPage() {
  return (
    <BookLanding
      service="teleconsult"
      value={400}
      hero="Talk to an MBBS doctor on live video."
      subhead="Doctor calls within 15 minutes of booking. From ₹399 onwards. Available across India."
      bullets={[
        "Live video with an NMC-licensed Sanocare doctor",
        "Digital prescription delivered to your chat",
        "Cough, cold, fever, follow-ups, and chronic care",
        "Free cancellation before the consult begins",
      ]}
      waUrl={`https://wa.me/919711977782?text=${encodeURIComponent(MESSAGE)}`}
    />
  );
}
