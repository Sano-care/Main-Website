import type { BlogPost } from "@/data/blog-posts";
import type { CmsResolved } from "./types";

export type CmsSectionSnapshot = Record<string, Record<string, unknown>>;
export type CmsBlogPostSnapshot = Record<string, BlogPost>;

export interface CmsMediaAssetSnapshot {
  id: string;
  pageSlug: string | null;
  sectionKey: string | null;
  itemKey: string | null;
  storagePath: string;
  publicUrl: string;
  altText: string | null;
  caption: string | null;
}

export interface CmsLinkItem {
  label: string;
  href: string;
}

export interface CmsSiteGlobalsSnapshot {
  companyName: string | null;
  tagline: string | null;
  brandDescription: string | null;
  phonePrimary: string | null;
  phoneSecondary: string | null;
  emailPrimary: string | null;
  emailSupport: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  mapsUrl: string | null;
  serviceAreaText: string | null;
  serviceHoursText: string | null;
  socialLinks: CmsLinkItem[];
  legalLinks: CmsLinkItem[];
  logoUrl: string | null;
  logoAlt: string | null;
  faviconUrl: string | null;
}

export interface CmsPreloadSnapshot {
  sections: CmsSectionSnapshot;
  blogPosts: CmsBlogPostSnapshot;
  siteGlobals: CmsSiteGlobalsSnapshot | null;
  mediaAssets: CmsMediaAssetSnapshot[];
}

export function resolveCmsSection<T>(
  snapshot: CmsSectionSnapshot | undefined,
  pageSlug: string,
  sectionKey: string,
  fallback: T,
): CmsResolved<T> {
  const resolved = snapshot?.[pageSlug]?.[sectionKey];

  if (resolved === null || typeof resolved === "undefined") {
    return { data: fallback, source: "fallback" };
  }

  return {
    data: resolved as T,
    source: "cms",
  };
}

export function resolveCmsBlogPost(
  snapshot: CmsBlogPostSnapshot | undefined,
  slug: string,
  fallback: BlogPost | null,
): CmsResolved<BlogPost | null> {
  const resolved = snapshot?.[slug];

  if (!resolved) {
    return { data: fallback, source: "fallback" };
  }

  return {
    data: resolved,
    source: "cms",
  };
}

export function resolveCmsMediaAssets(
  snapshot: CmsMediaAssetSnapshot[] | undefined,
  pageSlug: string,
  sectionKey?: string,
  itemKey?: string,
) {
  return (snapshot ?? []).filter((asset) => {
    if (asset.pageSlug !== pageSlug) {
      return false;
    }

    if (sectionKey && asset.sectionKey !== sectionKey) {
      return false;
    }

    if (itemKey && asset.itemKey !== itemKey) {
      return false;
    }

    return true;
  });
}
