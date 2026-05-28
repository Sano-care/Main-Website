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
  // v5.1 ships no bundled font TTFs — the renderer uses @react-pdf's
  // built-in PDF standard fonts (Times-Roman, Times-Bold, Times-Italic,
  // Times-BoldItalic). These glyphs are present in every PDF viewer,
  // so no font files live on disk and no outputFileTracingIncludes
  // glob is needed for the Rx PDF surface. The Sanocare butterfly
  // icon is still rendered inline via @react-pdf's <Svg><Path/></Svg>
  // in PrescriptionPdf.tsx, so no separate asset bundle either.
};

export default nextConfig;
