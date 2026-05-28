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
  // The Rx PDF renderer (src/lib/rx/pdf/renderPrescriptionPdf.ts) reads
  // Inter-Variable.ttf from src/lib/rx/pdf/fonts/ at module load via
  // fs.readFileSync(path.join(process.cwd(), ...)). Next.js's static
  // tracer can't see through the dynamic path.join, so we explicitly
  // include the fonts directory in the function bundle for every
  // route that can transitively reach the renderer.
  //
  // v5 trimmed the font set from {Cormorant, SourceSerif, Inter} ×
  // {upright, italic} to Inter-Variable only — that's the only TTF
  // left in fonts/. The Sanocare butterfly icon is rendered inline
  // via @react-pdf's <Svg><Path/></Svg> (paths embedded in
  // PrescriptionPdf.tsx), so no separate asset bundle is needed.
  outputFileTracingIncludes: {
    "/doctor/**": ["./src/lib/rx/pdf/fonts/**"],
    "/ops/**":    ["./src/lib/rx/pdf/fonts/**"],
    "/api/**":    ["./src/lib/rx/pdf/fonts/**"],
    "/rx/**":     ["./src/lib/rx/pdf/fonts/**"],
  },
};

export default nextConfig;
