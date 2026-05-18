// Lab coupon types — server-validated, no client-side trust.

export interface LabCoupon {
  code: string;
  discount_type: "percent" | "flat";
  discount_value: number;
  min_basket_inr: number;
  max_discount_inr: number | null;
  description: string | null;
}

export interface AppliedCoupon {
  code: string;
  discount_percent: number; // 0-100
  discount_inr: number; // rupees off the subtotal
  final_inr: number; // subtotal - discount, clamped to >= 0
  description: string | null;
}
