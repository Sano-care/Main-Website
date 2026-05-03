import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

type SectionRow = {
  page_id: string;
  page_slug: string;
  section_key: string;
  content_json: unknown;
};

type MediaCandidate = {
  publicUrl: string;
  altText: string;
  pageSlug: string;
  sectionKey: string;
  itemKey: string;
  storagePath: string;
  caption: string | null;
};

const MEDIA_FIELD_NAMES = new Set([
  "image",
  "imageSrc",
  "backgroundImageSrc",
  "avatar",
  "photo",
  "picture",
  "thumbnail",
  "banner",
  "logo",
  "heroImage",
  "src",
]);

function readSecret(request: NextRequest) {
  return request.headers.get("x-cms-admin-secret")?.trim() ?? request.nextUrl.searchParams.get("secret")?.trim();
}

function getExpectedSecret() {
  return process.env.CMS_ADMIN_SECRET ?? process.env.CMS_REVALIDATE_SECRET ?? process.env.REVALIDATE_SECRET;
}

function normalizeTag(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeMediaUrl(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

function buildStoragePath(candidate: Omit<MediaCandidate, "storagePath">) {
  return `cms-external:${candidate.pageSlug}:${candidate.sectionKey}:${candidate.itemKey}`;
}

function collectCandidates(
  value: unknown,
  pageSlug: string,
  sectionKey: string,
  trail: Array<string | number> = [],
  inheritedItemKey: string | null = null,
): MediaCandidate[] {
  if (typeof value === "string") {
    const fieldName = trail[trail.length - 1];
    if (typeof fieldName === "string" && MEDIA_FIELD_NAMES.has(fieldName) && looksLikeMediaUrl(value)) {
      const itemKey = inheritedItemKey ?? sectionKey;
      return [
        {
          publicUrl: value,
          altText: "",
          pageSlug,
          sectionKey,
          itemKey,
          storagePath: buildStoragePath({ publicUrl: value, altText: "", pageSlug, sectionKey, itemKey, caption: null }),
          caption: null,
        },
      ];
    }

    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      const nextTrail = [...trail, index];
      const derivedItemKey = inheritedItemKey ?? `item_${index + 1}`;
      return collectCandidates(item, pageSlug, sectionKey, nextTrail, derivedItemKey);
    });
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directItemKey = normalizeTag(record.key) ?? normalizeTag(record.id) ?? normalizeTag(record.slug) ?? inheritedItemKey;
  const altText = normalizeTag(record.alt) ?? normalizeTag(record.altText) ?? normalizeTag(record.imageAlt) ?? normalizeTag(record.name) ?? "";
  const caption = normalizeTag(record.caption);

  return Object.entries(record).flatMap(([key, child]) => {
    const nextTrail = [...trail, key];

    if (typeof child === "string" && MEDIA_FIELD_NAMES.has(key) && looksLikeMediaUrl(child)) {
      const itemKey = directItemKey ?? sectionKey;
      return [
        {
          publicUrl: child,
          altText,
          pageSlug,
          sectionKey,
          itemKey,
          storagePath: `cms-external:${pageSlug}:${sectionKey}:${itemKey}:${key}`,
          caption,
        },
      ];
    }

    return collectCandidates(child, pageSlug, sectionKey, nextTrail, directItemKey);
  });
}

export async function POST(request: NextRequest) {
  const expected = getExpectedSecret();
  if (!expected) return NextResponse.json({ error: "Missing server secret" }, { status: 500 });
  if (readSecret(request) !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: pages, error: pagesError } = await supabaseAdmin
    .from("cms_page_registry")
    .select("id, slug")
    .eq("status", "published");

  if (pagesError) return NextResponse.json({ error: pagesError.message }, { status: 500 });

  const pageIds = (pages ?? []).map((page) => page.id);
  const { data: sections, error: sectionsError } = await supabaseAdmin
    .from("cms_sections")
    .select("page_id, section_key, content_json")
    .eq("is_active", true)
    .in("page_id", pageIds);

  if (sectionsError) return NextResponse.json({ error: sectionsError.message }, { status: 500 });

  const pageById = new Map((pages ?? []).map((page) => [page.id, page.slug]));
  const candidates = (sections ?? []).flatMap((sectionRow) => {
    const row = sectionRow as SectionRow;
    const pageSlug = pageById.get(row.page_id) ?? null;
    if (!pageSlug) {
      return [];
    }

    return collectCandidates(row.content_json, pageSlug, row.section_key);
  });

  const uniqueByStorage = new Map<string, MediaCandidate>();
  for (const candidate of candidates) {
    uniqueByStorage.set(candidate.storagePath, candidate);
  }

  const upsertRows = Array.from(uniqueByStorage.values()).map((candidate) => ({
    storage_path: candidate.storagePath,
    public_url: candidate.publicUrl,
    alt_text: candidate.altText,
    caption: candidate.caption,
    page_slug: candidate.pageSlug,
    section_key: candidate.sectionKey,
    item_key: candidate.itemKey,
  }));

  if (upsertRows.length === 0) {
    return NextResponse.json({ success: true, insertedOrUpdated: 0 });
  }

  const { error: upsertError } = await supabaseAdmin
    .from("cms_media_assets")
    .upsert(upsertRows, { onConflict: "storage_path" });

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  return NextResponse.json({ success: true, insertedOrUpdated: upsertRows.length });
}