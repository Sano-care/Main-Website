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
  // - variable TTFs (Cormorant Garamond, Source Serif 4, Inter) from
  //   src/lib/rx/pdf/fonts/
  // - the horizontal Sanocare lockup PNG from src/lib/rx/pdf/assets/
  //   (added in v4 — replaces the text wordmark on page 1)
  // at module load via fs.readFileSync(path.join(process.cwd(), ...)).
  // Next.js's static tracer can't see through the dynamic path.join, so
  // we explicitly include both directories in the function bundle for
  // every route that can transitively reach the renderer. The globs
  // cover all current and future TTF / asset / license files.
  outputFileTracingIncludes: {
    "/doctor/**": ["./src/lib/rx/pdf/fonts/**", "./src/lib/rx/pdf/assets/**"],
    "/ops/**":    ["./src/lib/rx/pdf/fonts/**", "./src/lib/rx/pdf/assets/**"],
    "/api/**":    ["./src/lib/rx/pdf/fonts/**", "./src/lib/rx/pdf/assets/**"],
    "/rx/**":     ["./src/lib/rx/pdf/fonts/**", "./src/lib/rx/pdf/assets/**"],
  },
};

export default nextConfig;
