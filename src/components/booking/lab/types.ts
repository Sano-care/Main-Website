// T85 PR4b — shared types for the LabBasketWindow + sub-components.
//
// `BasketLine` is the single basket-entry shape used across the
// LabBasketWindow's local state, sub-component props, and the
// `/api/lab/create-booking-prepaid` request body. Kept locally to the
// lab basket (not promoted to bookingStore) because:
//   - The basket only exists while the basket window is open.
//   - Nothing else in the app reads it — no need to share state.
//   - Legacy lab flow (`LabTestBasket` + `bookingStore.selectedTests`)
//     uses a different shape; mixing them would be a refactor PR4b
//     doesn't want to take on.

export interface BasketLine {
  /**
   * Stable id — Pathcore code for individual tests, or the package id
   * (e.g. "SANO-ESSENTIALS") for branded bundles.
   */
  id: string;
  name: string;
  /** Pathcore code; matches `lab_tests.code`. Packages list components. */
  code: string;
  priceInr: number;
  mrpInr: number;
  /** Quantity — packages cap to 1 (enforced by the BasketSection stepper). */
  qty: number;
  /** True for the 2 Sanocare-branded packages; drives qty cap + badge. */
  isPackage: boolean;
}

/** Coupon successfully validated against the current basket subtotal. */
export interface AppliedLabCoupon {
  code: string;
  discountInr: number;
  discountPercent: number;
  description: string | null;
}
