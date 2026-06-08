import type { Metadata } from "next";
import { BookLanding } from "@/components/book/BookLanding";

export const metadata: Metadata = {
  title: "Sanocare — Book",
  robots: { index: false, follow: false },
};

const MESSAGE = "Hi Sanocare, I want to book a Lab Test at Home";

export default function BookLabTestPage() {
  return (
    <BookLanding
      service="lab"
      value={200}
      hero="Lab tests collected at your home."
      subhead="NABL-accredited labs. Reports in 24 to 48 hours. From ₹200 onwards. Delhi NCR."
      bullets={[
        "Trained Sanocare phlebotomist at your doorstep",
        "Morning (7 to 10 AM) or evening (5 to 8 PM) slots",
        "Digital reports delivered via chat and email",
        "NABL-accredited labs (Pathcore)",
      ]}
      waUrl={`https://wa.me/919711977782?text=${encodeURIComponent(MESSAGE)}`}
    />
  );
}
