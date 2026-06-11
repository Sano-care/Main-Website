import type { MetadataRoute } from "next";

/**
 * Next.js 16 App Router dynamic sitemap.
 * Output: https://sanocare.in/sitemap.xml
 *
 * Lists every publicly indexable route. Excluded:
 *   - /ops/*           — internal ops dashboards
 *   - /cms-admin       — CMS admin
 *   - /api/*           — API endpoints
 *   - /reports/[token] — magic-link gated, marked noindex anyway
 *   - /coming-soon/*   — dynamic placeholders
 *
 * Blog posts under /blog/[slug] are not yet enumerated dynamically because
 * the existing CMS doesn't expose a public list endpoint we can read at
 * build time. Add an env var SANOCARE_BLOG_SLUGS (comma-separated) to
 * include them temporarily, or extend this file to query Supabase directly.
 */

const SITE = "https://sanocare.in";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Marketing + product pages — high importance
  const marketing: MetadataRoute.Sitemap = [
    { url: `${SITE}/`,              changeFrequency: "weekly",  priority: 1.0, lastModified: now },
    { url: `${SITE}/services`,      changeFrequency: "monthly", priority: 0.9, lastModified: now },
    { url: `${SITE}/lab-tests`,     changeFrequency: "weekly",  priority: 0.9, lastModified: now },
    { url: `${SITE}/now`,           changeFrequency: "monthly", priority: 0.8, lastModified: now },
    { url: `${SITE}/carehub`,       changeFrequency: "monthly", priority: 0.8, lastModified: now },
    { url: `${SITE}/sanopulse`,     changeFrequency: "weekly",  priority: 0.8, lastModified: now },
    { url: `${SITE}/about`,         changeFrequency: "monthly", priority: 0.7, lastModified: now },
    { url: `${SITE}/research`,      changeFrequency: "weekly",  priority: 0.7, lastModified: now },
    { url: `${SITE}/contact`,       changeFrequency: "monthly", priority: 0.7, lastModified: now },
    { url: `${SITE}/portal`,        changeFrequency: "monthly", priority: 0.5, lastModified: now },
  ];

  // Dedicated SEO service landing pages (/services/[slug]). Keep this list
  // in sync with src/app/services/[slug]/serviceContent.ts.
  const servicePages: MetadataRoute.Sitemap = [
    "doctor-home-visit-delhi",
    "home-nurse-delhi-ncr",
    "lab-tests-at-home-delhi",
    "online-doctor-consultation-india",
  ].map((slug) => ({
    url: `${SITE}/services/${slug}`,
    changeFrequency: "monthly",
    priority: 0.8,
    lastModified: now,
  }));

  // Legal pages — important for credibility + Razorpay KYC
  const legal: MetadataRoute.Sitemap = [
    { url: `${SITE}/privacy`,   changeFrequency: "yearly", priority: 0.5, lastModified: now },
    { url: `${SITE}/terms`,     changeFrequency: "yearly", priority: 0.5, lastModified: now },
    { url: `${SITE}/refund`,    changeFrequency: "yearly", priority: 0.5, lastModified: now },
    { url: `${SITE}/emergency`, changeFrequency: "yearly", priority: 0.5, lastModified: now },
  ];

  // Optional: comma-separated blog slugs from env var
  const blogEnv = process.env.SANOCARE_BLOG_SLUGS || "";
  const blogSlugs = blogEnv.split(",").map((s) => s.trim()).filter(Boolean);
  const blog: MetadataRoute.Sitemap = blogSlugs.map((slug) => ({
    url: `${SITE}/blog/${slug}`,
    changeFrequency: "monthly",
    priority: 0.6,
    lastModified: now,
  }));

  return [...marketing, ...servicePages, ...legal, ...blog];
}
