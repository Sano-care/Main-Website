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
