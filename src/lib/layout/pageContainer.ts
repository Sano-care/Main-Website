// Shared homepage width container — ONE definition, applied to every homepage
// section (hero, carousel, About, the four services, numbers, advantage,
// footer) so their widths stay in lockstep.
//
// Near-full-bleed: 92vw wide (≈4vw breathing room each side) capped at 1720px
// on very wide screens, centred, with consistent inner gutters (24px mobile /
// 40px desktop) so content never touches the container edge. Widening a
// section is a matter of using this constant; there is no per-section width to
// keep in sync.
export const PAGE_CONTAINER = "mx-auto w-[92vw] max-w-[1720px] px-6 lg:px-10";
