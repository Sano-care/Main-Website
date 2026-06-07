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
  async redirects() {
    return [
      { source: "/portal", destination: "/pulse", permanent: true },
      {
        source: "/portal/:path*",
        destination: "/pulse/:path*",
        permanent: true,
      },
    ];
  },

  // Marketing alias URLs for paid campaigns (Google Ads Final URLs). Each is an
  // internal REWRITE (HTTP 200, stays on-domain) to the /wa conversion endpoint
  // with the service preset. UTM params on the alias (utm_source/campaign/term…)
  // are forwarded to /wa automatically by Next.js, so attribution + the GA4/Ads
  // conversion fire work unchanged. Rewrites (not redirects) so the click lands
  // on the conversion page in a single hop and Smart Bidding sees a clean URL.
  async rewrites() {
    return [
      { source: "/book-home-visit", destination: "/wa?service=home_visit" },
      { source: "/book-teleconsult", destination: "/wa?service=teleconsult" },
      { source: "/book-lab-test", destination: "/wa?service=lab" },
    ];
  },

  // v5.1 ships no bundled font TTFs — the renderer uses @react-pdf's
  // built-in PDF standard fonts (Times-Roman, Times-Bold, Times-Italic,
  // Times-BoldItalic). These glyphs are present in every PDF viewer,
  // so no font files live on disk and no outputFileTracingIncludes
  // glob is needed for the Rx PDF surface. The Sanocare butterfly
  // icon is still rendered inline via @react-pdf's <Svg><Path/></Svg>
  // in PrescriptionPdf.tsx, so no separate asset bundle either.
};

export default nextConfig;
