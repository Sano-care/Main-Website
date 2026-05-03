import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  getCmsDefaultBlogRows,
  getCmsDefaultPageTitles,
  getCmsDefaultMediaSeeds,
  getCmsDefaultSectionSeeds,
  getCmsDefaultSiteGlobals,
} from "@/services/cms/defaults";

const SITE_GLOBALS_ID = "00000000-0000-0000-0000-000000000001";

type CmsAdminAction = "update_site_globals" | "update_section" | "update_blog" | "sync_defaults";

interface SiteGlobalsPayload {
  companyName?: string;
  tagline?: string;
  brandDescription?: string;
  phonePrimary?: string;
  phoneSecondary?: string;
  emailPrimary?: string;
  emailSupport?: string;
  addressLine1?: string;
  addressLine2?: string;
  mapsUrl?: string;
}

interface SectionPayload {
  pageSlug?: string;
  sectionKey?: string;
  contentJson?: unknown;
}

interface BlogPayload {
  slug?: string;
  title?: string;
  excerpt?: string;
  category?: string;
  readTime?: string;
  bodyMarkdown?: string;
  authorName?: string;
  authorRole?: string;
  status?: "draft" | "published";
  publishedAt?: string | null;
}

interface CmsAdminPayload {
  action?: CmsAdminAction;
  data?: SiteGlobalsPayload | SectionPayload | BlogPayload;
}

interface SectionRow {
  id?: string;
  page_id: string;
  section_key: string;
  content_json: unknown;
}

function buildSectionIdentityKey(pageSlug: string, sectionKey: string) {
  return `${pageSlug}::${sectionKey}`;
}

function readSecret(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "").trim();
  }

  return request.headers.get("x-cms-admin-secret")?.trim() ?? request.nextUrl.searchParams.get("secret")?.trim();
}

function getExpectedSecret() {
  return process.env.CMS_ADMIN_SECRET ?? process.env.CMS_REVALIDATE_SECRET ?? process.env.REVALIDATE_SECRET;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getNullableString(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}

// NOTE: kept helper functions minimal; contentJson validation handled inline to allow arrays/primitives

export async function GET(request: NextRequest) {
  const expectedSecret = getExpectedSecret();

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Missing CMS_ADMIN_SECRET/CMS_REVALIDATE_SECRET/REVALIDATE_SECRET" },
      { status: 500 },
    );
  }

  if (readSecret(request) !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [globalsResult, pagesResult, blogsResult] = await Promise.all([
    supabaseAdmin
      .from("cms_site_globals")
      .select(
        "company_name, tagline, brand_description, phone_primary, phone_secondary, email_primary, email_support, address_line_1, address_line_2, maps_url",
      )
      .eq("id", SITE_GLOBALS_ID)
      .maybeSingle(),
    supabaseAdmin
      .from("cms_page_registry")
      .select("slug, title, status")
      .order("slug", { ascending: true }),
    supabaseAdmin
      .from("cms_blog_posts")
      .select("slug, title, status")
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);

  if (globalsResult.error || pagesResult.error || blogsResult.error) {
    return NextResponse.json(
      {
        error:
          globalsResult.error?.message ??
          pagesResult.error?.message ??
          blogsResult.error?.message ??
          "Failed to load CMS admin data",
      },
      { status: 500 },
    );
  }

  // Fetch sections for returned pages so the admin can list keys and existing content
  const pageRows = (pagesResult.data ?? []) as Array<{ slug: string; title?: string; status?: string }>;
  const pageIdsRes = await supabaseAdmin
    .from("cms_page_registry")
    .select("id, slug")
    .in(
      "slug",
      pageRows.map((p) => p.slug),
    );

  const pageIdMap = new Map<string, string>();
  if (!pageIdsRes.error && Array.isArray(pageIdsRes.data)) {
    for (const r of pageIdsRes.data as Array<{ id: string; slug: string }>) {
      pageIdMap.set(r.id, r.slug);
    }
  }

  const pageIds = Array.from(pageIdMap.keys());
  const sectionsData: Array<{ pageSlug: string; sectionKey: string; contentJson: unknown }> = [];

  if (pageIds.length > 0) {
    const { data: sectionRows, error: sectionError } = await supabaseAdmin
      .from("cms_sections")
      .select("page_id, section_key, content_json")
      .in("page_id", pageIds)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (!sectionError && Array.isArray(sectionRows)) {
      for (const row of sectionRows as SectionRow[]) {
        const slug = pageIdMap.get(row.page_id) ?? "";
        sectionsData.push({ pageSlug: slug, sectionKey: row.section_key, contentJson: row.content_json });
      }
    }
  }

  return NextResponse.json({
    siteGlobals: globalsResult.data,
    pages: pagesResult.data ?? [],
    blogs: blogsResult.data ?? [],
    sections: sectionsData,
  });
}

export async function POST(request: NextRequest) {
  const expectedSecret = getExpectedSecret();

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Missing CMS_ADMIN_SECRET/CMS_REVALIDATE_SECRET/REVALIDATE_SECRET" },
      { status: 500 },
    );
  }

  if (readSecret(request) !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: CmsAdminPayload;

  try {
    payload = (await request.json()) as CmsAdminPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!payload.action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  if (payload.action !== "sync_defaults" && !payload.data) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  if (payload.action === "update_site_globals") {
    const data = payload.data as SiteGlobalsPayload;

    const updateRow = {
      id: SITE_GLOBALS_ID,
      company_name: getNullableString(data.companyName),
      tagline: getNullableString(data.tagline),
      brand_description: getNullableString(data.brandDescription),
      phone_primary: getNullableString(data.phonePrimary),
      phone_secondary: getNullableString(data.phoneSecondary),
      email_primary: getNullableString(data.emailPrimary),
      email_support: getNullableString(data.emailSupport),
      address_line_1: getNullableString(data.addressLine1),
      address_line_2: getNullableString(data.addressLine2),
      maps_url: getNullableString(data.mapsUrl),
    };

    if (!isNonEmptyString(updateRow.company_name)) {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from("cms_site_globals")
      .upsert(updateRow, { onConflict: "id" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    revalidateTag("cms", "max");
    revalidateTag("cms:globals", "max");
    revalidatePath("/");

    return NextResponse.json({ success: true, action: payload.action });
  }

  if (payload.action === "update_section") {
    const data = payload.data as SectionPayload;

    if (!isNonEmptyString(data.pageSlug) || !isNonEmptyString(data.sectionKey)) {
      return NextResponse.json(
        { error: "pageSlug and sectionKey are required" },
        { status: 400 },
      );
    }

    // Allow any valid JSON value for content_json (object, array, string, number, etc.)
    const contentJson = typeof data.contentJson === "undefined" ? null : data.contentJson;

    if (contentJson === null) {
      return NextResponse.json(
        { error: "contentJson is required" },
        { status: 400 },
      );
    }

    const { data: pageRow, error: pageError } = await supabaseAdmin
      .from("cms_page_registry")
      .select("id")
      .eq("slug", data.pageSlug)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (pageError || !pageRow?.id) {
      return NextResponse.json(
        { error: pageError?.message ?? "Page slug not found" },
        { status: 400 },
      );
    }

    const { data: sectionRow, error: sectionFindError } = await supabaseAdmin
      .from("cms_sections")
      .select("id")
      .eq("page_id", pageRow.id)
      .eq("section_key", data.sectionKey)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (sectionFindError && sectionFindError.code !== "PGRST116") {
      return NextResponse.json({ error: sectionFindError.message }, { status: 400 });
    }

    if (sectionRow?.id) {
      const { error: updateError } = await supabaseAdmin
        .from("cms_sections")
        .update({ content_json: contentJson, is_active: true })
        .eq("id", sectionRow.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("cms_sections")
        .insert({
          page_id: pageRow.id,
          section_key: data.sectionKey,
          content_json: contentJson,
          sort_order: 0,
          is_active: true,
        });

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }
    }

    revalidateTag("cms", "max");
    revalidateTag("cms:sections", "max");
    revalidatePath(data.pageSlug === "home" ? "/" : `/${data.pageSlug}`);

    return NextResponse.json({ success: true, action: payload.action });
  }

  if (payload.action === "update_blog") {
    const data = payload.data as BlogPayload;

    if (!isNonEmptyString(data.slug) || !isNonEmptyString(data.title) || !isNonEmptyString(data.bodyMarkdown)) {
      return NextResponse.json(
        { error: "slug, title, and bodyMarkdown are required" },
        { status: 400 },
      );
    }

    const row = {
      slug: data.slug,
      title: data.title,
      excerpt: getNullableString(data.excerpt),
      category: getNullableString(data.category),
      read_time: getNullableString(data.readTime),
      body_markdown: data.bodyMarkdown,
      author_name: getNullableString(data.authorName),
      author_role: getNullableString(data.authorRole),
      status: data.status ?? "published",
      published_at: data.publishedAt ?? new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("cms_blog_posts")
      .upsert(row, { onConflict: "slug" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    revalidateTag("cms", "max");
    revalidateTag("cms:blog", "max");
    revalidatePath(`/blog/${data.slug}`);

    return NextResponse.json({ success: true, action: payload.action });
  }

  if (payload.action === "sync_defaults") {
    const pageTitles = getCmsDefaultPageTitles();
    const defaultSections = getCmsDefaultSectionSeeds();
    const defaultMediaSeeds = getCmsDefaultMediaSeeds();
    const defaultSiteGlobals = getCmsDefaultSiteGlobals();
    const defaultBlogRows = getCmsDefaultBlogRows();

    const expectedPageSlugs = Object.keys(pageTitles);

    const { data: existingPages, error: existingPagesError } = await supabaseAdmin
      .from("cms_page_registry")
      .select("id, slug")
      .in("slug", expectedPageSlugs);

    if (existingPagesError) {
      return NextResponse.json({ error: existingPagesError.message }, { status: 400 });
    }

    const existingPageSlugSet = new Set((existingPages ?? []).map((page) => page.slug));
    const missingPageRows = expectedPageSlugs
      .filter((slug) => !existingPageSlugSet.has(slug))
      .map((slug) => ({
        slug,
        title: pageTitles[slug],
        status: "published",
      }));

    let insertedPages = 0;
    if (missingPageRows.length > 0) {
      const { error: insertPagesError } = await supabaseAdmin
        .from("cms_page_registry")
        .insert(missingPageRows);

      if (insertPagesError) {
        return NextResponse.json({ error: insertPagesError.message }, { status: 400 });
      }

      insertedPages = missingPageRows.length;
    }

    const { data: allPages, error: allPagesError } = await supabaseAdmin
      .from("cms_page_registry")
      .select("id, slug")
      .in("slug", expectedPageSlugs);

    if (allPagesError) {
      return NextResponse.json({ error: allPagesError.message }, { status: 400 });
    }

    const pageIdBySlug = new Map((allPages ?? []).map((page) => [page.slug, page.id]));

    const pageIds = (allPages ?? []).map((page) => page.id);
    const { data: existingSections, error: existingSectionsError } = await supabaseAdmin
      .from("cms_sections")
      .select("id, page_id, section_key, content_json")
      .in("page_id", pageIds);

    if (existingSectionsError) {
      return NextResponse.json({ error: existingSectionsError.message }, { status: 400 });
    }

    const slugByPageId = new Map((allPages ?? []).map((page) => [page.id, page.slug]));
    const sectionByIdentity = new Map(
      (existingSections ?? []).map((row) => {
        const pageSlug = slugByPageId.get(row.page_id) ?? "";
        const identity = buildSectionIdentityKey(pageSlug, row.section_key);
        return [identity, row];
      }),
    );

    const sectionInserts: Array<{
      page_id: string;
      section_key: string;
      content_json: unknown;
      sort_order: number;
      is_active: boolean;
    }> = [];
    const sectionUpdates: Array<{ id: string; content_json: unknown; is_active: boolean }> = [];

    for (const seed of defaultSections) {
      const pageId = pageIdBySlug.get(seed.pageSlug);
      if (!pageId) {
        continue;
      }

      const identity = buildSectionIdentityKey(seed.pageSlug, seed.sectionKey);
      const existingSection = sectionByIdentity.get(identity);

      if (!existingSection) {
        sectionInserts.push({
          page_id: pageId,
          section_key: seed.sectionKey,
          content_json: seed.contentJson,
          sort_order: seed.sortOrder,
          is_active: true,
        });
        continue;
      }

      const existingJson = JSON.stringify(existingSection.content_json ?? null);
      const seedJson = JSON.stringify(seed.contentJson ?? null);
      if (existingJson !== seedJson && existingSection.id) {
        sectionUpdates.push({
          id: existingSection.id,
          content_json: seed.contentJson,
          is_active: true,
        });
      }
    }

    if (sectionInserts.length > 0) {
      const { error: insertSectionsError } = await supabaseAdmin
        .from("cms_sections")
        .insert(sectionInserts);

      if (insertSectionsError) {
        return NextResponse.json({ error: insertSectionsError.message }, { status: 400 });
      }
    }

    for (const row of sectionUpdates) {
      const { error: updateSectionError } = await supabaseAdmin
        .from("cms_sections")
        .update({
          content_json: row.content_json,
          is_active: row.is_active,
        })
        .eq("id", row.id);

      if (updateSectionError) {
        return NextResponse.json({ error: updateSectionError.message }, { status: 400 });
      }
    }

    const { error: globalsError } = await supabaseAdmin
      .from("cms_site_globals")
      .upsert({ id: SITE_GLOBALS_ID, ...defaultSiteGlobals }, { onConflict: "id" });

    if (globalsError) {
      return NextResponse.json({ error: globalsError.message }, { status: 400 });
    }

    let syncedBlogs = 0;
    if (defaultBlogRows.length > 0) {
      const { error: blogError } = await supabaseAdmin
        .from("cms_blog_posts")
        .upsert(defaultBlogRows, { onConflict: "slug" });

      if (blogError) {
        return NextResponse.json({ error: blogError.message }, { status: 400 });
      }

      syncedBlogs = defaultBlogRows.length;
    }

    if (defaultMediaSeeds.length > 0) {
      const { error: mediaError } = await supabaseAdmin
        .from("cms_media_assets")
        .upsert(
          defaultMediaSeeds.map((asset) => ({
            storage_path: asset.storagePath,
            public_url: asset.publicUrl,
            alt_text: asset.altText,
            caption: asset.caption,
            page_slug: asset.pageSlug,
            section_key: asset.sectionKey,
            item_key: asset.itemKey,
          })),
          { onConflict: "storage_path" },
        );

      if (mediaError) {
        return NextResponse.json({ error: mediaError.message }, { status: 400 });
      }
    }

    revalidateTag("cms", "max");
    revalidateTag("cms:preload", "max");
    revalidateTag("cms:sections", "max");
    revalidateTag("cms:globals", "max");
    revalidateTag("cms:blog", "max");
    revalidatePath("/");

    return NextResponse.json({
      success: true,
      action: payload.action,
      summary: {
        insertedPages,
        insertedSections: sectionInserts.length,
        updatedSections: sectionUpdates.length,
        syncedBlogs,
      },
    });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
