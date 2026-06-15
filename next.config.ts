import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
  // "Patient Portal" is deprecated — the surface is Sanocare Pulse. Anyone
  // landing on a legacy /portal link (old bookmarks, WhatsApp threads, the
  // marketing footer pre-rebuild) is forwarded to the matching /pulse path.
  // 308 (permanent) so crawlers + browsers update the canonical. Both the
  // bare /portal and any /portal/* subpath are covered.
  //
  // T91 — /book is referenced by legacy footer links, external bookmarks,
  // and old WhatsApp shares. There's no real /book route yet (T80 in the
  // workspace tracker is the multi-step booking flow that will land at
  // /book later). For now, forward to the homepage Home-Visit section so
  // the click lands on a relevant booking surface instead of a 404. 307
  // (NOT 308) because /book will become a real page in T80 — we don't
  // want crawlers to bake in the redirect and lose SEO authority that
  // should belong to the future real page.
  //
  // T93 — /coming-soon and /blog both only have `[slug]/page.tsx`, so the
  // bare URLs 404. Forward them to relevant landing surfaces — /coming-soon
  // to the homepage (caller most likely arrived from a stale link),
  // /blog to /research (closest existing content surface). Both 307 (NOT
  // 308) — if we ever build a real /coming-soon index or /blog index,
  // we want the redirect cleared without crawlers caching it.
  async redirects() {
    return [
      { source: "/portal", destination: "/pulse", permanent: true },
      {
        source: "/portal/:path*",
        destination: "/pulse/:path*",
        permanent: true,
      },
      { source: "/book", destination: "/#service-home-visit", permanent: false },
      { source: "/coming-soon", destination: "/", permanent: false },
      { source: "/blog", destination: "/research", permanent: false },
    ];
  },

  // NOTE: the /book-* paid-campaign aliases are NOT config rewrites — Next on
  // Netlify drops a rewrite destination's static query (?service=…), so they
  // silently fell back to the generic message. They are real route handlers
  // (src/app/book-*/route.ts) that share @/lib/wa/conversion with the service
  // hard-set: guaranteed 200 + correct service + UTM passthrough.

  // v5.1 ships no bundled font TTFs — the renderer uses @react-pdf's
  // built-in PDF standard fonts (Times-Roman, Times-Bold, Times-Italic,
  // Times-BoldItalic). These glyphs are present in every PDF viewer,
  // so no font files live on disk and no outputFileTracingIncludes
  // glob is needed for the Rx PDF surface. The Sanocare butterfly
  // icon is still rendered inline via @react-pdf's <Svg><Path/></Svg>
  // in PrescriptionPdf.tsx, so no separate asset bundle either.
};

export default nextConfig;
