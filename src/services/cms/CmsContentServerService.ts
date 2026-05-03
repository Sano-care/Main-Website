import "server-only";

import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBlogPostBySlug } from "@/data/blog-posts";
import type { BlogPost } from "@/data/blog-posts";
import type { CmsLinkItem, CmsPreloadSnapshot, CmsSiteGlobalsSnapshot, CmsMediaAssetSnapshot } from "./snapshot";

interface CmsPageRow {
  id: string;
  slug: string;
}

interface CmsSectionSnapshotRow {
  page_id: string;
  section_key: string;
  content_json: unknown;
}

interface CmsBlogPostRow {
  slug: string;
  category: string | null;
  read_time: string | null;
  title: string;
  excerpt: string | null;
  body_markdown: string;
  author_name: string | null;
  author_role: string | null;
  published_at: string | null;
}

interface CmsSiteGlobalsRow {
  company_name: string;
  tagline: string | null;
  brand_description: string | null;
  phone_primary: string | null;
  phone_secondary: string | null;
  email_primary: string | null;
  email_support: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  maps_url: string | null;
  service_area_text: string | null;
  service_hours_text: string | null;
  social_links_json: unknown;
  legal_links_json: unknown;
  logo_asset_id: string | null;
  favicon_asset_id: string | null;
}

interface CmsMediaAssetRow {
  id: string;
  page_slug: string | null;
  section_key: string | null;
  item_key: string | null;
  storage_path: string;
  public_url: string;
  alt_text: string | null;
  caption: string | null;
}

function getServerPublicClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function resolveFallbackImage(slug: string) {
  const fallbackPost = getBlogPostBySlug(slug);

  return (
    fallbackPost?.image ??
    "https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=1200&auto=format&fit=crop"
  );
}

function normalizeLinkArray(value: unknown): CmsLinkItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as { label?: unknown; href?: unknown };

      if (typeof candidate.label !== "string" || typeof candidate.href !== "string") {
        return null;
      }

      return {
        label: candidate.label,
        href: candidate.href,
      } satisfies CmsLinkItem;
    })
    .filter((item): item is CmsLinkItem => item !== null);
}

async function resolveMediaUrlById(supabase: SupabaseClient, assetId: string | null) {
  if (!assetId) {
    return null;
  }

  const { data, error } = await supabase
    .from("cms_media_assets")
    .select("public_url, alt_text")
    .eq("id", assetId)
    .maybeSingle<CmsMediaAssetRow>();

  if (error || !data?.public_url) {
    return null;
  }

  return data;
}

function toMediaAssetSnapshot(row: CmsMediaAssetRow): CmsMediaAssetSnapshot {
  return {
    id: row.id,
    pageSlug: row.page_slug,
    sectionKey: row.section_key,
    itemKey: row.item_key,
    storagePath: row.storage_path,
    publicUrl: row.public_url,
    altText: row.alt_text,
    caption: row.caption,
  };
}

async function buildSiteGlobalsSnapshot(
  supabase: SupabaseClient,
  row: CmsSiteGlobalsRow | null,
): Promise<CmsSiteGlobalsSnapshot | null> {
  if (!row) {
    return null;
  }

  const [logoAsset, faviconAsset] = await Promise.all([
    resolveMediaUrlById(supabase, row.logo_asset_id),
    resolveMediaUrlById(supabase, row.favicon_asset_id),
  ]);

  return {
    companyName: row.company_name ?? null,
    tagline: row.tagline,
    brandDescription: row.brand_description,
    phonePrimary: row.phone_primary,
    phoneSecondary: row.phone_secondary,
    emailPrimary: row.email_primary,
    emailSupport: row.email_support,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    mapsUrl: row.maps_url,
    serviceAreaText: row.service_area_text,
    serviceHoursText: row.service_hours_text,
    socialLinks: normalizeLinkArray(row.social_links_json),
    legalLinks: normalizeLinkArray(row.legal_links_json),
    logoUrl: logoAsset?.public_url ?? null,
    logoAlt: logoAsset?.alt_text ?? row.company_name ?? null,
    faviconUrl: faviconAsset?.public_url ?? null,
  };
}

async function fetchCmsPreloadSnapshotUncached(): Promise<CmsPreloadSnapshot> {
  const supabase = getServerPublicClient();

  if (!supabase) {
    return {
      sections: {},
      blogPosts: {},
      siteGlobals: null,
        mediaAssets: [],
    };
  }

  try {
    const [
      { data: pages, error: pagesError },
      { data: blogPosts, error: blogError },
      { data: siteGlobals, error: globalsError },
    ] = await Promise.all([
      supabase
        .from("cms_page_registry")
        .select("id, slug")
        .eq("status", "published"),
      supabase
        .from("cms_blog_posts")
        .select("slug, category, read_time, title, excerpt, body_markdown, author_name, author_role, published_at")
        .eq("status", "published")
        .or(`published_at.is.null,published_at.lte.${new Date().toISOString()}`),
      supabase
        .from("cms_site_globals")
        .select(
          "company_name, tagline, brand_description, phone_primary, phone_secondary, email_primary, email_support, address_line_1, address_line_2, maps_url, service_area_text, service_hours_text, social_links_json, legal_links_json, logo_asset_id, favicon_asset_id",
        )
        .limit(1)
        .maybeSingle<CmsSiteGlobalsRow>(),
    ]);

    if (pagesError) {
      throw pagesError;
    }

    if (blogError) {
      throw blogError;
    }

    if (globalsError) {
      throw globalsError;
    }

    const pageRows = (pages ?? []) as CmsPageRow[];
    const blogRows = (blogPosts ?? []) as CmsBlogPostRow[];
    const siteGlobalsSnapshot = await buildSiteGlobalsSnapshot(
      supabase,
      (siteGlobals ?? null) as CmsSiteGlobalsRow | null,
    );
    const pageById = new Map(pageRows.map((page) => [page.id, page.slug]));
    const sectionsSnapshot: CmsPreloadSnapshot["sections"] = {};
    const blogSnapshot: CmsPreloadSnapshot["blogPosts"] = {};
    const mediaAssetsSnapshot: CmsPreloadSnapshot["mediaAssets"] = [];

    if (pageRows.length > 0) {
      const pageIds = pageRows.map((page) => page.id);
      const { data: sectionRows, error: sectionError } = await supabase
        .from("cms_sections")
        .select("page_id, section_key, content_json")
        .in("page_id", pageIds)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (sectionError) {
        throw sectionError;
      }

      for (const row of (sectionRows ?? []) as CmsSectionSnapshotRow[]) {
        const slug = pageById.get(row.page_id);

        if (!slug || row.content_json === null || typeof row.content_json === "undefined") {
          continue;
        }

        if (!sectionsSnapshot[slug]) {
          sectionsSnapshot[slug] = {};
        }

        sectionsSnapshot[slug][row.section_key] = row.content_json;
      }
    }

    const { data: mediaRows, error: mediaError } = await supabase
      .from("cms_media_assets")
      .select("id, page_slug, section_key, item_key, storage_path, public_url, alt_text, caption")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (mediaError) {
      throw mediaError;
    }

    for (const row of (mediaRows ?? []) as CmsMediaAssetRow[]) {
      mediaAssetsSnapshot.push(toMediaAssetSnapshot(row));
    }

    for (const row of blogRows) {
      const fallbackPost = getBlogPostBySlug(row.slug);

      blogSnapshot[row.slug] = {
        slug: row.slug,
        category: row.category ?? fallbackPost?.category ?? "General",
        readTime: row.read_time ?? fallbackPost?.readTime ?? "5 min read",
        title: row.title,
        description: row.excerpt ?? fallbackPost?.description ?? "",
        image: resolveFallbackImage(row.slug),
        author: {
          name: row.author_name ?? fallbackPost?.author.name ?? "Sanocare Team",
          role: row.author_role ?? fallbackPost?.author.role ?? "Medical Reviewer",
        },
        publishedAt: row.published_at ?? fallbackPost?.publishedAt ?? new Date().toISOString(),
        content: row.body_markdown,
      } satisfies BlogPost;
    }

    return {
      sections: sectionsSnapshot,
      blogPosts: blogSnapshot,
      siteGlobals: siteGlobalsSnapshot,
      mediaAssets: mediaAssetsSnapshot,
    };
  } catch {
    return {
      sections: {},
      blogPosts: {},
      siteGlobals: null,
      mediaAssets: [],
    };
  }
}

const getCmsPreloadSnapshotCached = unstable_cache(
  fetchCmsPreloadSnapshotUncached,
  ["cms-preload-snapshot"],
  {
    tags: ["cms", "cms:preload", "cms:sections", "cms:blog", "cms:globals"],
  },
);

export async function getCmsPreloadSnapshot(): Promise<CmsPreloadSnapshot> {
  return getCmsPreloadSnapshotCached();
}
