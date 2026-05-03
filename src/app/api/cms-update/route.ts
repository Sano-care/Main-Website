import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";

type RevalidatePayload = {
  tags?: string[];
  paths?: string[];
  table?: string;
  record?: {
    slug?: string;
    page_slug?: string;
    page_id?: string;
  };
  old_record?: {
    slug?: string;
    page_slug?: string;
    page_id?: string;
  };
};

function sanitizePath(path: string) {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}

function readSecret(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "").trim();
  }

  return request.headers.get("x-cms-secret")?.trim() ?? request.nextUrl.searchParams.get("secret")?.trim();
}

async function resolvePageSlugFromPageId(pageId?: string) {
  if (!pageId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("cms_page_registry")
    .select("slug")
    .eq("id", pageId)
    .limit(1)
    .maybeSingle<{ slug: string }>();

  if (error || !data?.slug) {
    return null;
  }

  return data.slug;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "cms-update",
  });
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.CMS_REVALIDATE_SECRET ?? process.env.REVALIDATE_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Missing CMS_REVALIDATE_SECRET or REVALIDATE_SECRET" },
      { status: 500 },
    );
  }

  const providedSecret = readSecret(request);

  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: RevalidatePayload = {};

  try {
    payload = (await request.json()) as RevalidatePayload;
  } catch {
    payload = {};
  }

  const tags = new Set<string>(["cms"]);
  const paths = new Set<string>(["/"]);

  for (const tag of payload.tags ?? []) {
    if (tag) {
      tags.add(tag);
    }
  }

  for (const path of payload.paths ?? []) {
    if (path) {
      paths.add(sanitizePath(path));
    }
  }

  const slugFromPayload = payload.record?.slug ?? payload.old_record?.slug;
  const pageSlugFromPayload = payload.record?.page_slug ?? payload.old_record?.page_slug;
  const pageIdFromPayload = payload.record?.page_id ?? payload.old_record?.page_id;

  if (payload.table === "cms_blog_posts" && slugFromPayload) {
    tags.add("cms:blog");
    paths.add(`/blog/${slugFromPayload}`);
  }

  if (payload.table === "cms_sections") {
    tags.add("cms:sections");

    const resolvedPageSlug = pageSlugFromPayload ?? (await resolvePageSlugFromPageId(pageIdFromPayload));

    if (resolvedPageSlug) {
      paths.add(resolvedPageSlug === "home" ? "/" : `/${resolvedPageSlug}`);
    }
  }

  if (payload.table === "cms_site_globals") {
    tags.add("cms:globals");
  }

  for (const tag of tags) {
    revalidateTag(tag, "max");
  }

  for (const path of paths) {
    revalidatePath(path);
  }

  return NextResponse.json({
    revalidated: true,
    tags: Array.from(tags),
    paths: Array.from(paths),
  });
}
