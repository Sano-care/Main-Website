import type { MetadataRoute } from "next";

/**
 * Next.js 16 App Router robots.txt generator.
 * Output: https://sanocare.in/robots.txt
 *
 * Allows search engines on all marketing/product/legal pages, disallows
 * internal ops surfaces, API endpoints, token-gated routes, and CMS admin.
 * Points to the dynamic sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/ops/",
          "/cms-admin",
          "/cms-admin/",
          "/api/",
          "/reports/",
          "/coming-soon/",
          "/_next/",
          "/private/",
          "/wa", // paid conversion redirect — noindex, keep out of search
          "/book-home-visit", // paid alias → /wa (noindex)
          "/book-teleconsult", // paid alias → /wa (noindex)
          "/book-lab-test", // paid alias → /wa (noindex)
        ],
      },
      // Slow down the more aggressive crawlers
      {
        userAgent: ["AhrefsBot", "SemrushBot", "MJ12bot", "DotBot"],
        crawlDelay: 10,
      },
      // Block paid scrapers + AI-training crawlers from clinical content
      // (commercial-AI training fair-use is contested for healthcare data;
      //  err on the side of explicit opt-out, allow user-prompted citations)
      {
        userAgent: ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "PerplexityBot"],
        disallow: "/",
      },
    ],
    sitemap: "https://sanocare.in/sitemap.xml",
    host: "https://sanocare.in",
  };
}
