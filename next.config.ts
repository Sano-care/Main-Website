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
  // variable TTFs (Cormorant Garamond, Source Serif 4, Inter) from
  // src/lib/rx/pdf/fonts/ at module load via fs.readFileSync(path.join(
  // process.cwd(), ...)). Next.js's static tracer can't see through the
  // dynamic path.join, so we explicitly include the fonts directory in
  // the function bundle for every route that can transitively reach the
  // renderer. The glob covers all current and future TTF/license files.
  outputFileTracingIncludes: {
    "/doctor/**": ["./src/lib/rx/pdf/fonts/**"],
    "/ops/**": ["./src/lib/rx/pdf/fonts/**"],
    "/api/**": ["./src/lib/rx/pdf/fonts/**"],
    "/rx/**": ["./src/lib/rx/pdf/fonts/**"],
  },
};

export default nextConfig;
