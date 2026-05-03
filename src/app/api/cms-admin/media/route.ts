import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
// lightweight id generator to avoid adding uuid dependency in server bundle
function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

type MediaAssetRow = {
  id: string;
  storage_path: string;
  public_url: string;
  alt_text: string;
  caption: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  page_slug: string | null;
  section_key: string | null;
  item_key: string | null;
  created_at: string;
};

type MediaAssetBody = {
  url?: string | null;
  alt?: string;
  caption?: string | null;
  pageSlug?: string | null;
  sectionKey?: string | null;
  itemKey?: string | null;
};

function readSecret(request: NextRequest) {
  return (
    request.headers.get("x-cms-admin-secret")?.trim() ?? request.nextUrl.searchParams.get("secret")?.trim()
  );
}

function getExpectedSecret() {
  return process.env.CMS_ADMIN_SECRET ?? process.env.CMS_REVALIDATE_SECRET ?? process.env.REVALIDATE_SECRET;
}

function isBucketPath(path: string | null) {
  if (!path) return false;
  // treat http/https URLs as external; otherwise assume bucket-relative path
  return !/^https?:\/\//i.test(path);
}

function normalizeTag(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildContextStoragePath(pageSlug: string | null, sectionKey: string | null, itemKey: string | null) {
  return `cms-external:${pageSlug ?? "global"}:${sectionKey ?? "section"}:${itemKey ?? "item"}:${genId()}`;
}

export async function GET(request: NextRequest) {
  const expected = getExpectedSecret();
  if (!expected) return NextResponse.json({ error: "Missing server secret" }, { status: 500 });
  if (readSecret(request) !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pageSlug = normalizeTag(request.nextUrl.searchParams.get("pageSlug"));
  const sectionKey = normalizeTag(request.nextUrl.searchParams.get("sectionKey"));
  const itemKey = normalizeTag(request.nextUrl.searchParams.get("itemKey"));

  let query = supabaseAdmin
    .from("cms_media_assets")
    .select("id, storage_path, public_url, alt_text, caption, mime_type, width, height, page_slug, section_key, item_key, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (pageSlug) {
    query = query.eq("page_slug", pageSlug);
  }

  if (sectionKey) {
    query = query.eq("section_key", sectionKey);
  }

  if (itemKey) {
    query = query.eq("item_key", itemKey);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: NextRequest) {
  const expected = getExpectedSecret();
  if (!expected) return NextResponse.json({ error: "Missing server secret" }, { status: 500 });
  if (readSecret(request) !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = request.headers.get("content-type") || "";
  // handle multipart/form-data file upload
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const alt = (form.get("alt") as string) ?? "";
    const caption = (form.get("caption") as string) ?? null;
    const pageSlug = normalizeTag(form.get("pageSlug"));
    const sectionKey = normalizeTag(form.get("sectionKey"));
    const itemKey = normalizeTag(form.get("itemKey"));

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const id = genId();
    const filename = `${id}-${file.name}`;
    const path = `uploads/${filename}`;

    // Read file as ArrayBuffer
    const buffer = await file.arrayBuffer();

    const { error: uploadError } = await supabaseAdmin.storage.from("cms_assets").upload(path, new Uint8Array(buffer), { upsert: false });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    const { data: publicData } = supabaseAdmin.storage.from("cms_assets").getPublicUrl(path);
    const publicUrl = publicData?.publicUrl ?? "";

    const row = {
      storage_path: path,
      public_url: publicUrl,
      alt_text: alt ?? "",
      caption,
      mime_type: file.type ?? null,
      page_slug: pageSlug,
      section_key: sectionKey,
      item_key: itemKey,
    };

    const { error: insertErr } = await supabaseAdmin.from("cms_media_assets").insert(row);
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    return NextResponse.json({ success: true, row });
  }

  // handle JSON body for adding by URL or metadata-only
  let payload: MediaAssetBody;
  try {
    payload = (await request.json()) as MediaAssetBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url, alt = "", caption = null, pageSlug, sectionKey, itemKey } = payload;
  if (!url) {
    // allow creating a blank media record with empty URL
    const normalizedPageSlug = normalizeTag(pageSlug);
    const normalizedSectionKey = normalizeTag(sectionKey);
    const normalizedItemKey = normalizeTag(itemKey);
    const identity = buildContextStoragePath(normalizedPageSlug, normalizedSectionKey, normalizedItemKey);
    const { error: insErr } = await supabaseAdmin.from("cms_media_assets").insert({
      storage_path: identity,
      public_url: "",
      alt_text: alt,
      caption,
      page_slug: normalizedPageSlug,
      section_key: normalizedSectionKey,
      item_key: normalizedItemKey,
    });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const normalizedPageSlug = normalizeTag(pageSlug);
  const normalizedSectionKey = normalizeTag(sectionKey);
  const normalizedItemKey = normalizeTag(itemKey);
  const storage_path = buildContextStoragePath(normalizedPageSlug, normalizedSectionKey, normalizedItemKey);
  const public_url = url;

  const { error: insertError } = await supabaseAdmin.from("cms_media_assets").insert({
    storage_path,
    public_url,
    alt_text: alt,
    caption,
    page_slug: normalizedPageSlug,
    section_key: normalizedSectionKey,
    item_key: normalizedItemKey,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const expected = getExpectedSecret();
  if (!expected) return NextResponse.json({ error: "Missing server secret" }, { status: 500 });
  if (readSecret(request) !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: MediaAssetBody & { id?: string };
  try {
    payload = (await request.json()) as MediaAssetBody & { id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, alt, caption, url, pageSlug, sectionKey, itemKey } = payload;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // fetch existing
  const { data: existingData, error: fetchErr } = await supabaseAdmin.from("cms_media_assets").select("storage_path, public_url").eq("id", id).limit(1).maybeSingle<Pick<MediaAssetRow, "storage_path" | "public_url">>();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existingData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const oldPath = existingData.storage_path as string | null;

  // If url provided and different, and oldPath is a bucket path, delete old object
    if (typeof url === "string" && url !== existingData.public_url) {
    if (isBucketPath(oldPath) && oldPath) {
      try {
        await supabaseAdmin.storage.from("cms_assets").remove([oldPath]);
      } catch (e) {
        // non-fatal
        console.error("Failed to remove old asset", e);
      }
    }

      const normalizedPageSlug = normalizeTag(pageSlug);
      const normalizedSectionKey = normalizeTag(sectionKey);
      const normalizedItemKey = normalizeTag(itemKey);
      const newStorage = isBucketPath(url)
        ? url
        : buildContextStoragePath(normalizedPageSlug, normalizedSectionKey, normalizedItemKey);
    const updates: Record<string, unknown> = { storage_path: newStorage, public_url: url };
    if (typeof alt !== "undefined") updates.alt_text = alt;
    if (typeof caption !== "undefined") updates.caption = caption;
      if (typeof pageSlug !== "undefined") updates.page_slug = normalizedPageSlug;
      if (typeof sectionKey !== "undefined") updates.section_key = normalizedSectionKey;
      if (typeof itemKey !== "undefined") updates.item_key = normalizedItemKey;

    const { error: updErr } = await supabaseAdmin.from("cms_media_assets").update(updates).eq("id", id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  // otherwise just update metadata
  const metaUpdates: Record<string, unknown> = {};
  if (typeof alt !== "undefined") metaUpdates.alt_text = alt;
  if (typeof caption !== "undefined") metaUpdates.caption = caption;
  if (typeof pageSlug !== "undefined") metaUpdates.page_slug = normalizeTag(pageSlug);
  if (typeof sectionKey !== "undefined") metaUpdates.section_key = normalizeTag(sectionKey);
  if (typeof itemKey !== "undefined") metaUpdates.item_key = normalizeTag(itemKey);

  if (Object.keys(metaUpdates).length === 0) return NextResponse.json({ success: true });

  const { error: metaErr } = await supabaseAdmin.from("cms_media_assets").update(metaUpdates).eq("id", id);
  if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const expected = getExpectedSecret();
  if (!expected) return NextResponse.json({ error: "Missing server secret" }, { status: 500 });
  if (readSecret(request) !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: { id?: string };
  try {
    payload = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = payload;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: existingData, error: fetchErr } = await supabaseAdmin.from("cms_media_assets").select("storage_path").eq("id", id).limit(1).maybeSingle<Pick<MediaAssetRow, "storage_path">>();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existingData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const storagePath = existingData.storage_path as string | null;
  if (isBucketPath(storagePath) && storagePath) {
    try {
      await supabaseAdmin.storage.from("cms_assets").remove([storagePath]);
    } catch (e) {
      console.error("Failed to remove from storage", e);
    }
  }

  const { error: delErr } = await supabaseAdmin.from("cms_media_assets").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
