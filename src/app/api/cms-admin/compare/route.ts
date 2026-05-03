import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  getCmsDefaultBlogRows,
  getCmsDefaultMediaSeeds,
  getCmsDefaultPageTitles,
  getCmsDefaultSectionSeeds,
} from "@/services/cms/defaults";

const CMS_ADMIN_SECRET = process.env.CMS_ADMIN_SECRET ?? process.env.CMS_REVALIDATE_SECRET ?? process.env.REVALIDATE_SECRET;

function readSecret(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "").trim();
  }

  return request.headers.get("x-cms-admin-secret")?.trim() ?? request.nextUrl.searchParams.get("secret")?.trim();
}

export async function GET(request: NextRequest) {
  if (!CMS_ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Missing CMS_ADMIN_SECRET/CMS_REVALIDATE_SECRET/REVALIDATE_SECRET" },
      { status: 500 },
    );
  }

  if (readSecret(request) !== CMS_ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [pagesResult, sectionsResult, globalsResult, blogsResult, mediaResult] = await Promise.all([
      supabaseAdmin.from("cms_page_registry").select("id, slug, title"),
      supabaseAdmin.from("cms_sections").select("page_id, section_key, is_active"),
      supabaseAdmin.from("cms_site_globals").select("*").eq("id", "00000000-0000-0000-0000-000000000001").maybeSingle(),
      supabaseAdmin.from("cms_blog_posts").select("slug, title"),
      supabaseAdmin.from("cms_media_assets").select("page_slug, section_key, item_key, deleted_at").is("deleted_at", null),
    ]);

    const localPageTitles = getCmsDefaultPageTitles();
    const localSections = getCmsDefaultSectionSeeds();
    const localBlogs = getCmsDefaultBlogRows();
    const localMedia = getCmsDefaultMediaSeeds();

    const cloudPageSlugs = new Set((pagesResult.data ?? []).map((page) => page.slug));
    const cloudSectionKeys = new Map<string, Set<string>>();

    for (const section of sectionsResult.data ?? []) {
      const pageIdStr = section.page_id as string;

      if (!cloudSectionKeys.has(pageIdStr)) {
        cloudSectionKeys.set(pageIdStr, new Set());
      }

      cloudSectionKeys.get(pageIdStr)!.add(section.section_key as string);
    }

    const cloudBlogSlugs = new Set((blogsResult.data ?? []).map((blog) => blog.slug));
    const cloudMediaKeys = new Set(
      (mediaResult.data ?? []).map((asset) => `${asset.page_slug ?? ""}::${asset.section_key ?? ""}::${asset.item_key ?? ""}`),
    );

    const missingPages = Object.keys(localPageTitles).filter((slug) => !cloudPageSlugs.has(slug));
    const extraPages = Array.from(cloudPageSlugs).filter((slug) => !localPageTitles[slug]);

    const missingPageIdMap = new Map<string, string[]>();
    if (pagesResult.data) {
      for (const page of pagesResult.data) {
        const pageSlug = page.slug as string;
        const localPageSections = localSections.filter((section) => section.pageSlug === pageSlug).map((section) => section.sectionKey);
        const cloudPageSections = cloudSectionKeys.get(page.id as string) ?? new Set();
        const missingKeys = localPageSections.filter((key) => !cloudPageSections.has(key));

        if (missingKeys.length > 0) {
          missingPageIdMap.set(pageSlug, missingKeys);
        }
      }
    }

    const missingBlogs = localBlogs.filter((blog) => !cloudBlogSlugs.has(blog.slug)).map((blog) => blog.slug);
    const extraBlogs = Array.from(cloudBlogSlugs).filter((slug) => !localBlogs.find((blog) => blog.slug === slug));

    const missingMedia = localMedia.filter(
      (asset) => !cloudMediaKeys.has(`${asset.pageSlug}::${asset.sectionKey}::${asset.itemKey}`),
    );
    const extraMedia = (mediaResult.data ?? []).filter(
      (asset) => !localMedia.find(
        (localAsset) =>
          localAsset.pageSlug === asset.page_slug &&
          localAsset.sectionKey === asset.section_key &&
          localAsset.itemKey === asset.item_key,
      ),
    );

    const hasGlobals = globalsResult.data !== null;
    const missingSectionsCount = Array.from(missingPageIdMap.values()).reduce((sum, arr) => sum + arr.length, 0);

    return NextResponse.json({
      pages: {
        cloud: Array.from(cloudPageSlugs),
        local: Object.keys(localPageTitles),
        missing: missingPages,
        extra: extraPages,
      },
      sections: {
        missingByPage: Object.fromEntries(missingPageIdMap),
        totalMissing: missingSectionsCount,
      },
      globals: {
        cloudExists: hasGlobals,
        localExists: true,
        missing: !hasGlobals,
      },
      blogs: {
        cloud: Array.from(cloudBlogSlugs),
        local: localBlogs.map((blog) => blog.slug),
        missing: missingBlogs,
        extra: extraBlogs,
      },
      media: {
        cloudCount: (mediaResult.data ?? []).length,
        localCount: localMedia.length,
        missing: missingMedia.map((asset) => ({ pageSlug: asset.pageSlug, sectionKey: asset.sectionKey, itemKey: asset.itemKey })),
        extra: extraMedia.map((asset) => ({ pageSlug: asset.page_slug, sectionKey: asset.section_key, itemKey: asset.item_key })),
      },
      summary: {
        missingPagesCount: missingPages.length,
        missingSectionsCount,
        missingGlobals: !hasGlobals,
        missingBlogsCount: missingBlogs.length,
        missingMediaCount: missingMedia.length,
        readyToSync:
          missingPages.length > 0 ||
          missingSectionsCount > 0 ||
          !hasGlobals ||
          missingBlogs.length > 0 ||
          missingMedia.length > 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to compare CMS data" },
      { status: 500 },
    );
  }
}
