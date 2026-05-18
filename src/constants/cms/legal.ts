// Legal documents — Privacy Policy, Terms of Service, Refund Policy,
// Emergency Disclaimer. Rendered by /privacy, /terms, /refund, /emergency.
//
// Drafts written to comply with the Digital Personal Data Protection Act 2023,
// the Telemedicine Practice Guidelines 2020 (MoHFW), and standard Indian
// healthcare-services contract patterns. Have these reviewed by a practising
// healthcare lawyer or Company Secretary before going live.

export interface LegalDocument {
  slug: "privacy" | "terms" | "refund" | "emergency";
  title: string;
  subtitle: string;
  lastUpdated: string; // ISO date
  effective: string; // ISO date
  /**
   * Markdown body. Rendered with react-markdown; supports headings, bold,
   * italics, lists, tables, blockquotes, inline code, and links. No HTML
   * (kept off for safety since legal text shouldn't need it).
   */
  body: string;
}

const PRIVACY_BODY = `## 1. Who we are

This Privacy Policy explains how **Sanocare Tech Innovations Private Limited** ("Sanocare," "we," "us," or "our"), a company incorporated under the Companies Act 2013 and bearing CIN U86904DL2025PTC446725, with its registered office at 1666/B2, 3rd Floor, Gali 2, Govindpuri Extension, Kalkaji, New Delhi — 110019, collects, processes, stores, and protects personal data of users of the Sanocare website at sanocare.in, the Sanocare Pulse mobile application, and any related services we offer (collectively, the "Services").

Sanocare is the **Data Fiduciary** as defined under the Digital Personal Data Protection Act, 2023 ("**DPDP Act 2023**"). You, as the user of our Services, are the **Data Principal**.

## 2. What personal data we collect

We collect the minimum personal data necessary to provide our Services. The categories of data we collect are:

**Identity and contact data**

- Full name, date of birth, age, gender
- Mobile number and email address
- Photograph (where you upload one to a Pulse profile)
- Residential address, including geocoded GPS coordinates of the address where a visit is requested

**Health data**

- Chief complaint, symptoms, and case description you provide at booking
- Vitals captured by our medics during a visit (blood pressure, heart rate, oxygen saturation, temperature, blood glucose, weight)
- Diagnoses, prescriptions, and treatment notes issued by our doctors
- Risk classifications (Green / Yellow / Red) assigned to each consultation
- Medical history and conditions you share with us, including family medical history
- Reports of laboratory tests collected and processed through us

**Family data**

- Personal data of family members you add as profiles on Sanocare Pulse, provided you have the legal right to share that data on their behalf. For children below 18, the consent of a parent or lawful guardian is required, in line with Section 9 of the DPDP Act 2023.

**Booking and transaction data**

- Records of bookings, visits, consultations, prescriptions, payments, refunds, and cancellations
- Communication history with our care team
- Live case status data (medic dispatch, ETA, arrival timestamps)

**Technical data**

- Device type, operating system, browser, and IP address
- App version, crash reports, performance telemetry
- Cookies and similar technologies (see Section 9)

We do **not** collect: biometric data (other than what is voluntarily uploaded as a profile photo), Aadhaar numbers (unless required by law for a specific service), bank account numbers (these are handled by our payment gateway, not by us), or political opinions.

## 3. How we use your personal data

We process your personal data only for specific, lawful purposes:

1. **Service delivery** — to schedule, dispatch, deliver, and close your healthcare bookings.
2. **Clinical decision-making** — to give the attending doctor and medic the information they need to provide safe care.
3. **Payments** — to process payments and refunds via our payment gateway partner (Razorpay).
4. **Communication** — to send booking confirmations, dispatch updates, prescription notifications, payment receipts, and case summaries via SMS, email, push notification, or in-app messaging.
5. **Record-keeping** — to maintain your clinical and transactional record as required by applicable laws including the Telemedicine Practice Guidelines 2020 and Indian Medical Council regulations.
6. **Service improvement** — to monitor service quality, train our care team, and improve the safety and reliability of our Services. Where this involves any personal data, the data is anonymised before use.
7. **Legal compliance** — to comply with applicable laws, regulatory orders, court orders, or law-enforcement requests where legally obligated.

## 4. Lawful basis for processing

Under Section 4 of the DPDP Act 2023, we process your personal data on the following lawful bases:

- **Your free, specific, informed, unconditional, and unambiguous consent**, given at the point of registration, booking, or feature use, as the primary basis for processing.
- **Performance of the contract** between you and Sanocare, where processing is necessary to deliver a booked Service.
- **Compliance with law**, where processing is required to discharge our legal obligations under healthcare and corporate regulations.

You may withdraw your consent at any time by writing to our Grievance Officer (see Section 11). Withdrawal will not affect the lawfulness of processing carried out before withdrawal, and we will continue to retain records we are legally required to keep.

## 5. How long we retain your personal data

We retain personal data only for as long as necessary for the purposes for which it was collected.

| Data | Retention period |
|---|---|
| Identity and contact data | Duration of active account + 3 years |
| Clinical records (visits, vitals, prescriptions, lab reports) | Minimum 7 years from date of last consultation |
| Transactional data (payments, refunds, invoices) | 8 years, per Companies Act 2013 and Income Tax Act |
| Communication logs | 12 months |
| Technical data (logs, IP addresses, crash reports) | 90 days |

Where you exercise your right to erasure (Section 6), we will delete data not required for legal retention. Clinical records may be irreversibly anonymised but not deleted, where deletion would breach our legal obligations.

## 6. Your rights as a Data Principal

You have the following rights under the DPDP Act 2023:

1. **Right to access** — request a copy of the personal data we hold about you.
2. **Right to correction and erasure** — ask us to correct inaccurate data, complete incomplete data, or erase data that is no longer required (subject to our legal retention obligations).
3. **Right to grievance redressal** — file a grievance with our Grievance Officer. We will respond within 30 days.
4. **Right to nominate** — nominate another individual to exercise your rights in the event of your death or incapacity.
5. **Right to withdraw consent** — withdraw any previously given consent at any time.

To exercise any of these rights, email our Grievance Officer at **contact@sanocare.in** with the subject line "DPDP — [Right Requested]".

## 7. Who we share your data with

We share your personal data with a limited set of third parties strictly necessary to deliver the Services. We do **not** sell your personal data. We do **not** share your personal data with advertisers or analytics platforms for behavioural advertising.

| Third party | Data shared | Purpose |
|---|---|---|
| **Razorpay Software Private Limited** | Payment instrument data, transaction amount, booking ID | Payment processing |
| **Agora.io / LiveKit** | Audio/video call data during in-app consultations | Video consultation delivery |
| **Twilio Inc. / MSG91** | Mobile number, SMS content | Transactional SMS |
| **Google LLC (Firebase Cloud Messaging)** | Device token | Push notifications |
| **NABL-accredited laboratory partners** | Patient identifiers, test order | Lab processing of samples we collect |
| **Government authorities** | As legally required | Compliance with court orders, law enforcement |
| **Our clinicians** (doctors, medics) | The clinical data necessary to deliver your care | Care delivery |

All third-party processors are contractually bound to process your data only on our documented instructions.

## 8. Cross-border transfer

Some of our processors (Razorpay, Agora/LiveKit, Google FCM) may process data on servers located outside India. We rely on the safeguards under Section 16 of the DPDP Act 2023 and on contractual data-protection clauses with these processors.

## 9. Cookies and similar technologies

The Sanocare website uses a minimal set of cookies and similar technologies:

- **Strictly necessary cookies** — required for the site to function. These do not require consent.
- **Functional cookies** — remember your preferences. Set only with your consent.
- **Analytics cookies** — privacy-friendly analytics (Plausible or similar) that do not track individuals across sites. Set only with your consent.

We do **not** use advertising cookies, social-media tracking pixels, or fingerprinting.

## 10. Children's data

Sanocare's Services may be used by adults (18+) on their own behalf, or by parents/lawful guardians on behalf of minors. For users below 18, we process personal data only with the verifiable consent of a parent or lawful guardian, as required by Section 9 of the DPDP Act 2023. We do not undertake tracking or behavioural monitoring of minors, and we do not direct any advertising at minors.

## 11. Grievance Officer

If you have any questions, concerns, or grievances about how we handle your personal data, please contact:

**Shashwat Arora**, Grievance Officer
**Sanocare Tech Innovations Private Limited**
1666/B2, 3rd Floor, Gali 2, Govindpuri Extension, Kalkaji, New Delhi — 110019
Email: **contact@sanocare.in**

We will respond to grievances within 30 days as required under the DPDP Act 2023.

## 12. Security

We protect your personal data with industry-standard measures including encryption in transit (TLS 1.2+), encryption at rest, role-based access control, audit logging of access to clinical records, and regular security reviews. In the unlikely event of a personal data breach, we will notify you and the Data Protection Board of India within the timelines mandated by law.

## 13. Changes to this Policy

We may update this Policy from time to time. We will notify you of material changes by email, SMS, or in-app notice at least 7 days before they take effect. Your continued use of the Services after the effective date constitutes acceptance of the updated Policy.`;

const TERMS_BODY = `## 1. Acceptance of these Terms

By using the Sanocare website, the Sanocare Pulse mobile application, or any of our Services, you ("you," "user," "patient") agree to these Terms of Service ("**Terms**"). If you do not agree, please do not use the Services.

## 2. Who we are

The Services are operated by **Sanocare Tech Innovations Private Limited** (CIN U86904DL2025PTC446725), with registered office at 1666/B2, 3rd Floor, Gali 2, Govindpuri Extension, Kalkaji, New Delhi — 110019.

## 3. The Services

Sanocare offers planned, non-emergency primary healthcare delivered to your home or via teleconsultation. Our Services currently include:

- **Home visits** — a GNM / B.Sc Nursing-qualified medic visits you at home and delivers a structured assessment, with an MBBS doctor joining on live video to lead the consultation and issue a digital prescription.
- **Nursing-only visits** — a single procedure (injection, IV, wound dressing, sample collection) performed by a GNM / B.Sc Nursing-qualified medic, without a doctor consultation.
- **Teleconsultations** — a remote video consultation with an MBBS doctor.
- **Lab sample collection at home** — phlebotomy at your address, with samples processed by NABL-accredited laboratory partners.

Services are currently available in select pincodes of South Delhi. We expand our service area periodically; check the pincode coverage on our website for current availability.

## 4. Eligibility

You must be 18 years of age or older to register on our Services on your own behalf. If you are below 18, you may be registered as a profile under the account of your parent or lawful guardian, who consents to and is responsible for your use of the Services.

You confirm that the personal data you provide is true and accurate to the best of your knowledge.

## 5. Booking and cancellation

By placing a booking, you create a contract with Sanocare for the specific Service requested, at the price displayed at the time of booking. Bookings are confirmed only after payment of the booking fee (₹249 by default; or ₹499 full upfront, at your option) via our payment gateway partner Razorpay.

Cancellation and refund terms are governed by our **Refund & Cancellation Policy**.

## 6. Payment

Sanocare uses Razorpay as its payment processor. All payments are made via UPI, debit card, credit card, net banking, or wallets supported by Razorpay. Sanocare does not store your full card number, CVV, UPI PIN, or banking credentials.

Healthcare consultations provided by Sanocare are exempt from Goods and Services Tax (GST) under the relevant entries of the GST Act. Lab tests, medicines, or other ancillary services billed through third parties may attract GST as applicable.

A typical home visit transaction works as follows:

1. ₹249 is captured at booking confirmation.
2. The case proceeds; the medic visits, vitals are captured, the doctor consults via video, the prescription is issued.
3. When the doctor closes the case, the remaining balance (typically ₹250 for a standard visit) is auto-charged to the same payment instrument.
4. If the consultation extends beyond 15 minutes, additional time is billed at ₹100 per additional 5 minutes.

Receipts and invoices are sent via SMS and stored within your Sanocare account.

## 7. Your obligations

When using the Services, you agree to:

1. Provide truthful and complete information at booking and during consultations.
2. Cooperate with the medic and doctor in good faith, including allowing the medic safe entry to your home during the visit window.
3. Not misuse the Services (no fraudulent bookings, no abusive conduct toward our clinicians, no unauthorised recording or distribution of consultations).
4. Pay any amounts due in accordance with the booking and applicable pricing.
5. Use the Services only for lawful purposes.

We reserve the right to suspend or terminate access to the Services in case of breach of these obligations.

## 8. Our obligations and limitations

Sanocare commits to:

1. Deploy GNM / B.Sc Nursing-qualified medics and MBBS-qualified (or higher) doctors to deliver every consultation.
2. Comply with the Telemedicine Practice Guidelines 2020 issued by the Ministry of Health & Family Welfare, Government of India.
3. Maintain clinical records of every consultation in line with applicable medical record-keeping norms.
4. Strive to meet a median time-to-medic of under 30 minutes within our active service area, while acknowledging that we cannot guarantee a specific arrival time for any individual booking due to traffic, weather, and operational variables.

Sanocare's Services are **not** intended for emergency medical conditions (see **Emergency Disclaimer**). Clinical decisions made during consultations are the professional judgment of the attending doctor based on the information presented; outcomes of medical treatment cannot be guaranteed.

## 9. Intellectual property

All content on the Sanocare website and the Sanocare Pulse application, including logos, text, designs, software, and underlying source code, is owned by or licensed to Sanocare Tech Innovations Pvt. Ltd. and protected by Indian and international intellectual property laws. You may not reproduce, distribute, or create derivative works without our prior written permission, except for personal, non-commercial use as a Sanocare patient.

## 10. Limitation of liability

To the maximum extent permitted by law, Sanocare's aggregate liability arising out of or in connection with the Services shall not exceed the total amount you have paid us for the specific Service giving rise to the claim, in the 12 months preceding the claim. Sanocare shall not be liable for indirect, consequential, incidental, special, or punitive damages.

Nothing in these Terms limits or excludes liability that cannot be excluded under applicable Indian law, including liability for death, personal injury caused by negligence, fraud, or any other liability that cannot lawfully be excluded.

## 11. Indemnity

You agree to indemnify Sanocare and its officers, directors, employees, and clinicians against any claims, damages, or expenses arising out of your breach of these Terms, your misuse of the Services, or your provision of false or misleading information.

## 12. Termination

You may stop using the Services at any time and close your account by writing to **contact@sanocare.in**. Sanocare may suspend or terminate your access in the event of a material breach of these Terms, with reasonable notice except where suspension is required to protect users, clinicians, or our infrastructure.

## 13. Governing law and jurisdiction

These Terms are governed by the laws of India. The courts in New Delhi, India shall have exclusive jurisdiction over any disputes arising out of these Terms or the Services, subject to applicable consumer-protection law.

## 14. Modifications to these Terms

We may amend these Terms from time to time. Material amendments will be notified to you by email, SMS, or in-app notice at least 7 days before they take effect. Your continued use of the Services after the effective date constitutes acceptance of the amended Terms.

## 15. Contact

For any questions about these Terms, write to **contact@sanocare.in** or to our registered office address above.`;

const REFUND_BODY = `## 1. Booking confirmation and the booking fee

When you book a Service, ₹249 is charged at the moment of confirmation (or ₹499 if you choose the full upfront option). This is the "booking fee." The booking is confirmed only after the booking fee is successfully captured.

## 2. Cancellation by you, before medic dispatch

You may cancel a booking at any time before our system marks a medic as "Dispatched." A medic is considered "Dispatched" the moment they accept the case and begin moving toward your address.

- Cancellations before dispatch receive a **full refund** of the booking fee.
- Refunds are processed to your original payment instrument within 5 to 7 working days, depending on your bank or wallet provider.

## 3. Cancellation by you, after medic dispatch

Once a medic has been dispatched, the booking fee (₹249) is non-refundable, as we have already committed clinician time and travel to your case.

- The remaining balance (typically ₹250) is **not** charged if the case is cancelled after dispatch but before the consultation begins.
- If the medic has arrived at your address but you decline the visit, only the booking fee is forfeited; the balance is not charged.

## 4. Cancellation by Sanocare

We may cancel or reschedule a booking in exceptional circumstances such as:

- Severe weather, civil unrest, or other safety conditions affecting the medic's ability to reach you safely.
- Unavailability of a qualified medic or doctor at the time slot you booked.
- Information provided at booking that suggests the case requires emergency care (which we are not equipped to deliver — see **Emergency Disclaimer**).

In all such cases, you receive a **full refund** to your original payment instrument.

## 5. Refund timelines

Refunds are initiated by Sanocare to your original payment instrument via Razorpay. Once initiated, the refund typically reflects in your account within:

- **UPI:** 1–3 working days
- **Debit/credit card:** 5–7 working days
- **Net banking:** 3–5 working days
- **Wallets:** 1–2 working days

If a refund hasn't reflected after 7 working days, please write to **contact@sanocare.in** with the booking ID and we will investigate.

## 6. Service issues and disputes

If you are dissatisfied with the quality of a Service delivered, please write to **contact@sanocare.in** within 7 days of the service date. We review each complaint individually and, where the complaint is upheld, may offer:

- A partial or full refund of the Service charge.
- A complimentary follow-up consultation.
- Other remedies appropriate to the case.

This complaint process is in addition to your statutory consumer rights under Indian law.

## 7. Lab tests and medicines

Refunds for lab tests are governed by the policies of the laboratory partner who processed the samples. Refunds for medicines are governed by the policies of the medicine retailer or e-pharmacy that fulfilled the order. We facilitate refunds where the issue is attributable to Sanocare's handling.

## 8. Disputes

If you dispute a charge with your bank, please first raise the issue with us at **contact@sanocare.in**. We aim to resolve disputes amicably; if that fails, the governing-law and jurisdiction terms in the **Terms of Service** apply.`;

const EMERGENCY_BODY = `**Sanocare is a planned-care service, not an emergency response unit.**

Our Services are designed for non-emergency, planned healthcare delivered at home or via teleconsultation. Our committed median time-to-medic of under 30 minutes is an operational best-effort, not an emergency-medical-services SLA.

## Conditions for which you should call emergency services immediately

If you, or anyone you are caring for, is experiencing any of the following, **do not book a Sanocare visit**. Call **112 (Pan-India Emergency)** or **102 (Ambulance)** immediately, or proceed to the nearest hospital emergency room:

- Chest pain, pressure, or tightness, with or without arm or jaw pain
- Sudden shortness of breath or difficulty breathing
- Sudden severe headache, slurred speech, drooping face, or weakness on one side of the body
- Loss of consciousness, seizure, or sudden confusion
- Severe bleeding that does not stop with pressure
- Severe burns
- Suspected fracture or major trauma
- Anaphylactic reaction (severe allergic reaction)
- Suspected poisoning or overdose
- Severe abdominal pain
- Active suicidal thoughts or behaviour, or any other psychiatric emergency

## What we do offer

We are well-suited to address non-emergency primary healthcare needs such as fever, cough, mild infections, routine vital monitoring, injection administration, IV fluids, wound dressing, chronic disease follow-up, lab sample collection, and teleconsultation for any condition where in-person emergency intervention is not required.

If you are unsure whether your situation is an emergency, please err on the side of calling 112 or 102. We would rather you reach an emergency facility unnecessarily than delay an emergency call to book us.

## Your acknowledgement

By using the Services, you acknowledge that you have read and understood this Emergency Disclaimer, and that you will direct emergency situations to the appropriate emergency services rather than booking a Sanocare visit.

## Important phone numbers

- **112** — Pan-India Emergency (Police, Fire, Ambulance)
- **102** — Ambulance (Government, free)
- **108** — Emergency Medical Services (state-operated in many states)
- **1098** — Childline India (for children in distress)`;

export const LEGAL_CONTENT: Record<LegalDocument["slug"], LegalDocument> = {
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    subtitle: "How we collect, use, and protect your personal data under the DPDP Act 2023.",
    lastUpdated: "16 May 2026",
    effective: "16 May 2026",
    body: PRIVACY_BODY,
  },
  terms: {
    slug: "terms",
    title: "Terms of Service",
    subtitle: "The contract between you and Sanocare when you use our Services.",
    lastUpdated: "16 May 2026",
    effective: "16 May 2026",
    body: TERMS_BODY,
  },
  refund: {
    slug: "refund",
    title: "Refund & Cancellation Policy",
    subtitle: "Full refund before medic dispatch. Honest, customer-friendly terms.",
    lastUpdated: "16 May 2026",
    effective: "16 May 2026",
    body: REFUND_BODY,
  },
  emergency: {
    slug: "emergency",
    title: "Emergency Disclaimer",
    subtitle: "Sanocare is a planned-care service, not an emergency response unit.",
    lastUpdated: "16 May 2026",
    effective: "16 May 2026",
    body: EMERGENCY_BODY,
  },
};
