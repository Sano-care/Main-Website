// Lab test record — matches the shape of /public/lab-tests.json

export interface LabTest {
  /** Partner-lab test code, e.g. "BC0573" */
  code: string;
  /** Public-facing test name, e.g. "(1, 3)-Beta-D-Glucan" */
  name: string;
  /** MRP in ₹ (rupees, not paise) */
  price: number;
  /** Sample requirement, e.g. "3 mL Serum (Red Top)" */
  sample: string;
  /** Turnaround time, e.g. "3 days" */
  tat: string;
  /** Method, e.g. "CLIA", "FISH", "PCR" */
  method: string;
  /** Special instructions (fasting, etc.) */
  instructions: string;
  /** Shipping & stability conditions */
  shipping: string;
  /** Clinical utility (what the test is used for) */
  utility: string;
  /** Category: Routine, Specialty, Oncology, Genetics */
  category: "Routine" | "Specialty" | "Oncology" | "Genetics";
}
