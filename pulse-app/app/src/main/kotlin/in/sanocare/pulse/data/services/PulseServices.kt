package `in`.sanocare.pulse.data.services

// Single source of truth for the Pulse app's four services. Tiles, booking
// screens, and order-create calls all read from here — no per-screen hardcoded
// prices or slugs, so a label/price/slug can never diverge across screens.
//
// Money model (founder, 2026-08): the Home tile shows the FULL "starting from"
// price (priceLabel); checkout charges the server-computed amount — a 50%
// advance for non-lab services, the ₹200 collection fee for lab. The client
// NEVER sends an amount; /api/razorpay/create-order derives it from `t85Slug`
// server-side (getServiceHalfRoundedUp), so a client mismap can't mischarge.
//
//   serviceCategory — value written to bookings.service_category (T85 slug;
//                     serviceMapper.ts's "new writes use the T85 slug" rule).
//   t85Slug         — /api/razorpay/create-order order param (must be one of
//                     VALID_T85_SLUGS on that route).

enum class PulseService(
    val label: String,
    val serviceCategory: String,
    val t85Slug: String,
    val fullPriceInr: Int,
    val priceLabel: String,
) {
    TELECONSULT(
        label = "Talk to a doctor",
        serviceCategory = "teleconsultation",
        t85Slug = "teleconsultation",
        fullPriceInr = 399,
        priceLabel = "from ₹399",
    ),
    LAB(
        label = "Get tested at home",
        serviceCategory = "lab-tests",
        t85Slug = "lab-tests",
        fullPriceInr = 200,
        priceLabel = "₹200 collection",
    ),
    HOME_VISIT(
        label = "Care at Home",
        serviceCategory = "home-visit",
        t85Slug = "home-visit",
        fullPriceInr = 499,
        priceLabel = "from ₹499",
    ),
    MEDIC(
        label = "Book a medic",
        serviceCategory = "medic-at-home",
        t85Slug = "medic-at-home",
        fullPriceInr = 199,
        priceLabel = "from ₹199",
    ),
}
