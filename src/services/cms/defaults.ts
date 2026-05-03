import {
  ABOUT_PAGE_CONTENT,
  BLOG_PAGE_CONTENT,
  CAREHUB_PAGE_CONTENT,
  COMING_SOON_PAGE_CONTENT,
  CONTACT_PAGE_CONTENT,
  HOME_CONTENT,
  NOT_FOUND_PAGE_CONTENT,
  NOW_PAGE_CONTENT,
  PORTAL_PAGE_CONTENT,
  RESEARCH_PAGE_CONTENT,
  SANOCARE_ADVANTAGE_CONTENT,
  SERVICES_PAGE_CONTENT,
  SHARED_CONTENT,
} from "@/constants/cms-content";
import { BLOG_POSTS } from "@/data/blog-posts";

export interface CmsDefaultSectionSeed {
  pageSlug: string;
  sectionKey: string;
  contentJson: unknown;
  sortOrder: number;
}

export interface CmsDefaultMediaSeed {
  pageSlug: string;
  sectionKey: string;
  itemKey: string;
  publicUrl: string;
  altText: string;
  caption: string | null;
  storagePath: string;
}

function sanitizeForJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForJson(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeForJson(item);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }

    return output;
  }

  return undefined;
}

function sectionMapToSeeds(pageSlug: string, sections: Record<string, unknown>): CmsDefaultSectionSeed[] {
  return Object.entries(sections).map(([sectionKey, contentJson], index) => ({
    pageSlug,
    sectionKey,
    contentJson: sanitizeForJson(contentJson),
    sortOrder: index,
  }));
}

function isImageUrl(value: unknown) {
  return typeof value === "string" && (/^https?:\/\//i.test(value) || value.startsWith("/"));
}

function normalizeKey(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function buildStoragePath(pageSlug: string, sectionKey: string, itemKey: string) {
  return `cms-external:${pageSlug}:${sectionKey}:${itemKey}`;
}

function collectMediaSeedsFromValue(
  value: unknown,
  pageSlug: string,
  sectionKey: string,
  path: Array<string | number> = [],
  inheritedItemKey?: string,
): CmsDefaultMediaSeed[] {
  if (typeof value === "string") {
    const fieldName = path[path.length - 1];
    if (typeof fieldName === "string" && fieldName.toLowerCase().includes("image") && isImageUrl(value)) {
      const itemKey = inheritedItemKey ?? normalizeKey(fieldName, sectionKey);
      return [
        {
          pageSlug,
          sectionKey,
          itemKey,
          publicUrl: value,
          altText: "",
          caption: null,
          storagePath: buildStoragePath(pageSlug, sectionKey, itemKey),
        },
      ];
    }

    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectMediaSeedsFromValue(item, pageSlug, sectionKey, [...path, index], inheritedItemKey ?? `${sectionKey}_${index + 1}`),
    );
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directItemKey =
    normalizeKey(record.key, "") ||
    normalizeKey(record.id, "") ||
    normalizeKey(record.slug, "") ||
    inheritedItemKey;

  return Object.entries(record).flatMap(([key, child]) => {
    const nextPath = [...path, key];

    if (typeof child === "string" && key.toLowerCase().includes("image") && isImageUrl(child)) {
      const itemKey = directItemKey ?? normalizeKey(key, sectionKey);
      return [
        {
          pageSlug,
          sectionKey,
          itemKey,
          publicUrl: child,
          altText: typeof record.alt === "string" ? record.alt : typeof record.altText === "string" ? record.altText : typeof record.name === "string" ? record.name : "",
          caption: typeof record.caption === "string" ? record.caption : null,
          storagePath: buildStoragePath(pageSlug, sectionKey, itemKey),
        },
      ];
    }

    return collectMediaSeedsFromValue(child, pageSlug, sectionKey, nextPath, directItemKey);
  });
}

function uniqueMediaSeeds(seeds: CmsDefaultMediaSeed[]) {
  const byStoragePath = new Map<string, CmsDefaultMediaSeed>();
  for (const seed of seeds) {
    byStoragePath.set(seed.storagePath, seed);
  }
  return Array.from(byStoragePath.values());
}

export function getCmsDefaultSectionSeeds(): CmsDefaultSectionSeed[] {
  const allSeeds: CmsDefaultSectionSeed[] = [];

  allSeeds.push(
    ...sectionMapToSeeds("shared", {
      top_banner_announcements: SHARED_CONTENT.topBannerAnnouncements,
      navbar: SHARED_CONTENT.navbar,
      floating_sidebar: SHARED_CONTENT.floatingSidebar,
      mobile_sticky_bar: SHARED_CONTENT.mobileStickyBar,
      footer: SHARED_CONTENT.footer,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("home", {
      hero: HOME_CONTENT.hero,
      hero_booking_form: HOME_CONTENT.hero.bookingForm,
      booking_modal: HOME_CONTENT.bookingModal,
      features: HOME_CONTENT.features,
      stats_bar: HOME_CONTENT.statsBar,
      journey: HOME_CONTENT.journey,
      testimonials_header: HOME_CONTENT.testimonialsHeader,
      testimonials: HOME_CONTENT.testimonials,
      insights: HOME_CONTENT.insights,
      trust: HOME_CONTENT.trust,
      sanocare_advantage_page_copy: SANOCARE_ADVANTAGE_CONTENT.pageCopy,
      sanocare_advantage_comparison: SANOCARE_ADVANTAGE_CONTENT.comparisonData,
      sanocare_advantage_service_offerings: SANOCARE_ADVANTAGE_CONTENT.serviceOfferings,
      sanocare_advantage_value_propositions: SANOCARE_ADVANTAGE_CONTENT.valuePropositions,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("services", {
      page_copy: SERVICES_PAGE_CONTENT.pageCopy,
      medical_services: SERVICES_PAGE_CONTENT.medicalServices,
      advantage_points: SERVICES_PAGE_CONTENT.advantagePoints,
      signature_programs: SERVICES_PAGE_CONTENT.signaturePrograms,
      trust_badges: SERVICES_PAGE_CONTENT.trustBadges,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("now", {
      page_copy: NOW_PAGE_CONTENT.pageCopy,
      services: NOW_PAGE_CONTENT.services,
      how_it_works: NOW_PAGE_CONTENT.howItWorks,
      advantages: NOW_PAGE_CONTENT.advantages,
      stats: NOW_PAGE_CONTENT.stats,
      pricing_points: NOW_PAGE_CONTENT.pricingPoints,
      trust_points: NOW_PAGE_CONTENT.trustPoints,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("carehub", {
      page_copy: CAREHUB_PAGE_CONTENT.pageCopy,
      benefits: CAREHUB_PAGE_CONTENT.benefits,
      how_it_works: CAREHUB_PAGE_CONTENT.howItWorks,
      stats: CAREHUB_PAGE_CONTENT.stats,
      inquiry_benefits: CAREHUB_PAGE_CONTENT.inquiryBenefits,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("contact", {
      page_copy: CONTACT_PAGE_CONTENT.pageCopy,
      contact_info: CONTACT_PAGE_CONTENT.contactInfo,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("research", {
      page_copy: RESEARCH_PAGE_CONTENT.pageCopy,
      health_facts: RESEARCH_PAGE_CONTENT.healthFacts,
      featured_blogs: RESEARCH_PAGE_CONTENT.featuredBlogs,
      health_tips: RESEARCH_PAGE_CONTENT.healthTips,
      media_mentions: RESEARCH_PAGE_CONTENT.mediaMentions,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("about", {
      page_copy: ABOUT_PAGE_CONTENT.pageCopy,
      company_info: ABOUT_PAGE_CONTENT.companyInfo,
      pillars: ABOUT_PAGE_CONTENT.pillars,
      values: ABOUT_PAGE_CONTENT.values,
      milestones: ABOUT_PAGE_CONTENT.milestones,
      team_members: ABOUT_PAGE_CONTENT.teamMembers,
      accreditations: ABOUT_PAGE_CONTENT.accreditations,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("blog", {
      template: BLOG_PAGE_CONTENT.template,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("not-found", {
      page_copy: NOT_FOUND_PAGE_CONTENT,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("coming-soon", {
      page_copy: COMING_SOON_PAGE_CONTENT,
    }),
  );

  allSeeds.push(
    ...sectionMapToSeeds("portal", {
      page_copy: PORTAL_PAGE_CONTENT,
    }),
  );

  return allSeeds;
}

export function getCmsDefaultPageTitles(): Record<string, string> {
  return {
    shared: "Shared",
    home: "Home",
    services: "Services",
    now: "Now",
    carehub: "CareHub",
    contact: "Contact",
    research: "Research",
    about: "About",
    blog: "Blog",
    "not-found": "Not Found",
    "coming-soon": "Coming Soon",
    portal: "Portal",
  };
}

export function getCmsDefaultSiteGlobals() {
  return {
    company_name: SHARED_CONTENT.footer.brandName,
    tagline: "Reimagining Primary Healthcare for Urban India",
    brand_description: SHARED_CONTENT.footer.brandDescription,
    phone_primary: SHARED_CONTENT.footer.contact.phone,
    phone_secondary: null,
    email_primary: SHARED_CONTENT.footer.contact.email,
    email_support: null,
    address_line_1: SHARED_CONTENT.footer.contact.addressLines[0] ?? null,
    address_line_2: SHARED_CONTENT.footer.contact.addressLines[1] ?? null,
    maps_url: SHARED_CONTENT.footer.contact.mapsHref,
    logo_url: "/logo.svg",
    logo_alt: SHARED_CONTENT.footer.logoAlt,
    social_links: sanitizeForJson(
      SHARED_CONTENT.footer.socialLinks.map((link) => ({
        label: link.label,
        href: link.href,
      })),
    ),
    legal_links: sanitizeForJson(SHARED_CONTENT.footer.links.legal),
  };
}

export function getCmsDefaultBlogRows() {
  return BLOG_POSTS.map((post) => ({
    slug: post.slug,
    title: post.title,
    excerpt: post.description,
    category: post.category,
    read_time: post.readTime,
    hero_image_url: post.image,
    body_markdown: post.content,
    author_name: post.author.name,
    author_role: post.author.role,
    status: "published" as const,
    published_at: post.publishedAt,
  }));
}

export function getCmsDefaultMediaSeeds(): CmsDefaultMediaSeed[] {
  const seeds: CmsDefaultMediaSeed[] = [];

  const collectFromSections = (pageSlug: string, sections: Record<string, unknown>) => {
    for (const [sectionKey, contentJson] of Object.entries(sections)) {
      seeds.push(...collectMediaSeedsFromValue(contentJson, pageSlug, sectionKey));
    }
  };

  collectFromSections("home", {
    hero: HOME_CONTENT.hero,
    features: HOME_CONTENT.features,
    journey: HOME_CONTENT.journey,
    insights: HOME_CONTENT.insights,
    trust: HOME_CONTENT.trust,
    sanocare_advantage_comparison: SANOCARE_ADVANTAGE_CONTENT.comparisonData,
    sanocare_advantage_service_offerings: SANOCARE_ADVANTAGE_CONTENT.serviceOfferings,
  });

  collectFromSections("services", {
    page_copy: SERVICES_PAGE_CONTENT.pageCopy,
    medical_services: SERVICES_PAGE_CONTENT.medicalServices,
    signature_programs: SERVICES_PAGE_CONTENT.signaturePrograms,
    trust_badges: SERVICES_PAGE_CONTENT.trustBadges,
  });

  collectFromSections("now", {
    page_copy: NOW_PAGE_CONTENT.pageCopy,
    services: NOW_PAGE_CONTENT.services,
    how_it_works: NOW_PAGE_CONTENT.howItWorks,
    stats: NOW_PAGE_CONTENT.stats,
    trust_points: NOW_PAGE_CONTENT.trustPoints,
  });

  collectFromSections("carehub", {
    page_copy: CAREHUB_PAGE_CONTENT.pageCopy,
    benefits: CAREHUB_PAGE_CONTENT.benefits,
    how_it_works: CAREHUB_PAGE_CONTENT.howItWorks,
  });

  collectFromSections("contact", {
    page_copy: CONTACT_PAGE_CONTENT.pageCopy,
    contact_info: CONTACT_PAGE_CONTENT.contactInfo,
  });

  collectFromSections("research", {
    page_copy: RESEARCH_PAGE_CONTENT.pageCopy,
    featured_blogs: RESEARCH_PAGE_CONTENT.featuredBlogs,
    media_mentions: RESEARCH_PAGE_CONTENT.mediaMentions,
  });

  collectFromSections("about", {
    page_copy: ABOUT_PAGE_CONTENT.pageCopy,
    team_members: ABOUT_PAGE_CONTENT.teamMembers,
    accreditations: ABOUT_PAGE_CONTENT.accreditations,
  });

  return uniqueMediaSeeds(seeds);
}
