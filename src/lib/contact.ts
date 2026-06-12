// Sanocare contact constants — single source of truth for the support
// phone number, WhatsApp deeplink, and email surfaces.
//
// Introduced in T90 Slice 2 Steps 14–15 (Account settings + Help & support
// stubs) to avoid hardcoding the phone number a third time. Navbar.tsx still
// inlines PHONE_TEL pre-Step-17 cleanup — Step 17 will migrate it to consume
// from here so a number change is a single-grep operation.
//
// Email correction (founder lock, 2026-06-12): contact@sanocare.in is the
// canonical address. Legacy occurrences of hello@sanocare.in should migrate.

/** Tel-link target — E.164. Used as `tel:${PHONE_TEL}`. */
export const PHONE_TEL = "+919711977782";

/** Display format — used in surfaced UI labels. */
export const PHONE_DISPLAY = "+91 97119 77782";

/** WhatsApp click-to-chat deeplink. */
export const WHATSAPP_DEEPLINK = "https://wa.me/919711977782";

/** Canonical support email (founder-locked 2026-06-12). */
export const SUPPORT_EMAIL = "contact@sanocare.in";
