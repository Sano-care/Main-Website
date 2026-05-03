"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SiteGlobalsResponse = {
  company_name?: string;
  tagline?: string;
  brand_description?: string;
  phone_primary?: string;
  phone_secondary?: string;
  email_primary?: string;
  email_support?: string;
  address_line_1?: string;
  address_line_2?: string;
  maps_url?: string;
};

type SectionBootRow = {
  pageSlug: string;
  sectionKey: string;
  contentJson: unknown;
};

type AdminBootResponse = {
  siteGlobals?: SiteGlobalsResponse | null;
  pages: Array<{ slug: string; title: string; status: string }>;
  blogs: Array<{ slug: string; title: string; status: string }>;
  sections: SectionBootRow[];
};

type CmsComparison = {
  pages: { cloud: string[]; local: string[]; missing: string[]; extra: string[] };
  sections: { missingByPage: Record<string, string[]>; totalMissing: number };
  globals: { cloudExists: boolean; localExists: boolean; missing: boolean };
  blogs: { cloud: string[]; local: string[]; missing: string[]; extra: string[] };
  media: {
    cloudCount: number;
    localCount: number;
    missing: Array<{ pageSlug: string; sectionKey: string; itemKey: string }>;
    extra: Array<{ pageSlug: string | null; sectionKey: string | null; itemKey: string | null }>;
  };
  summary: {
    missingPagesCount: number;
    missingSectionsCount: number;
    missingGlobals: boolean;
    missingBlogsCount: number;
    missingMediaCount: number;
    readyToSync: boolean;
  };
};

type ApiResult = {
  success?: boolean;
  error?: string;
  summary?: {
    insertedPages?: number;
    insertedSections?: number;
    updatedSections?: number;
    syncedBlogs?: number;
  };
};

type MediaAssetRecord = {
  id: string;
  storage_path: string;
  public_url: string;
  alt_text: string | null;
  caption: string | null;
  page_slug: string | null;
  section_key: string | null;
  item_key: string | null;
};

const defaultSectionJson = {
  title: "",
  description: "",
};

export default function CmsAdminPage() {
  const [secret, setSecret] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("Not connected");
  const [bootData, setBootData] = useState<AdminBootResponse>({ pages: [], blogs: [], sections: [] });

  const [siteGlobalsForm, setSiteGlobalsForm] = useState({
    companyName: "",
    tagline: "",
    brandDescription: "",
    phonePrimary: "",
    phoneSecondary: "",
    emailPrimary: "",
    emailSupport: "",
    addressLine1: "",
    addressLine2: "",
    mapsUrl: "",
  });

  const [sectionForm, setSectionForm] = useState({
    pageSlug: "home",
    sectionKey: "",
    contentJson: JSON.stringify(defaultSectionJson, null, 2),
  });

  const [blogForm, setBlogForm] = useState({
    slug: "",
    title: "",
    excerpt: "",
    category: "",
    readTime: "",
    authorName: "",
    authorRole: "",
    bodyMarkdown: "",
  });

  const [cmsDevMode, setCmsDevMode] = useState(false);
  const [cmsComparison, setCmsComparison] = useState<CmsComparison | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [mediaList, setMediaList] = useState<MediaAssetRecord[]>([]);
  const [mediaPageSlug, setMediaPageSlug] = useState("home");
  const [mediaSectionKey, setMediaSectionKey] = useState("");
  const [mediaItemKey, setMediaItemKey] = useState("");
  const [mediaForm, setMediaForm] = useState({ url: "", alt: "", caption: "", file: null as File | null });
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);

  const pageSlugs = useMemo(() => bootData.pages.map((page) => page.slug), [bootData.pages]);
  const blogSlugs = useMemo(() => bootData.blogs.map((blog) => blog.slug), [bootData.blogs]);
  const sectionsForPage = useMemo(
    () => bootData.sections.filter((section) => section.pageSlug === sectionForm.pageSlug),
    [bootData.sections, sectionForm.pageSlug],
  );
  const sectionKeys = useMemo(
    () => Array.from(new Set(sectionsForPage.map((section) => section.sectionKey))),
    [sectionsForPage],
  );
  const mediaSectionsForPage = useMemo(
    () => bootData.sections.filter((section) => section.pageSlug === mediaPageSlug),
    [bootData.sections, mediaPageSlug],
  );
  const mediaSectionKeys = useMemo(
    () => Array.from(new Set(mediaSectionsForPage.map((section) => section.sectionKey))),
    [mediaSectionsForPage],
  );

  useEffect(() => {
    if (sectionKeys.length === 0) {
      setSectionForm((prev) => ({
        ...prev,
        sectionKey: "",
        contentJson: JSON.stringify(defaultSectionJson, null, 2),
      }));
      return;
    }

    if (!sectionKeys.includes(sectionForm.sectionKey)) {
      setSectionForm((prev) => ({
        ...prev,
        sectionKey: sectionKeys[0],
      }));
    }
  }, [sectionKeys, sectionForm.sectionKey]);

  useEffect(() => {
    if (!sectionForm.sectionKey) {
      return;
    }

    const selectedSection = sectionsForPage.find((section) => section.sectionKey === sectionForm.sectionKey);

    if (!selectedSection) {
      return;
    }

    setSectionForm((prev) => ({
      ...prev,
      contentJson: JSON.stringify(selectedSection.contentJson ?? defaultSectionJson, null, 2),
    }));
  }, [sectionsForPage, sectionForm.sectionKey]);

  async function connect() {
    if (!secret.trim()) {
      setStatusText("Enter the CMS admin secret to connect");
      return;
    }

    setIsLoading(true);
    setStatusText("Connecting...");

    try {
      const response = await fetch(`/api/cms-admin?secret=${encodeURIComponent(secret.trim())}`);
      const data = (await response.json()) as AdminBootResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to connect");
      }

      setBootData({
        pages: data.pages ?? [],
        blogs: data.blogs ?? [],
        siteGlobals: data.siteGlobals ?? null,
        sections: data.sections ?? [],
      });

      const devMode = process.env.NEXT_PUBLIC_CMS_DEV === "true";
      setCmsDevMode(devMode);

      if (devMode) {
        try {
          const compareResponse = await fetch(`/api/cms-admin/compare?secret=${encodeURIComponent(secret.trim())}`);
          const compareData = (await compareResponse.json()) as CmsComparison;
          setCmsComparison(compareData);
        } catch (compareError) {
          console.error("Failed to load comparison data:", compareError);
        }
      }

      const globals = data.siteGlobals;

      setSiteGlobalsForm({
        companyName: globals?.company_name ?? "",
        tagline: globals?.tagline ?? "",
        brandDescription: globals?.brand_description ?? "",
        phonePrimary: globals?.phone_primary ?? "",
        phoneSecondary: globals?.phone_secondary ?? "",
        emailPrimary: globals?.email_primary ?? "",
        emailSupport: globals?.email_support ?? "",
        addressLine1: globals?.address_line_1 ?? "",
        addressLine2: globals?.address_line_2 ?? "",
        mapsUrl: globals?.maps_url ?? "",
      });

      if ((data.pages ?? []).length > 0) {
        const firstPageSlug = data.pages[0].slug;
        const firstPageSections = (data.sections ?? []).filter((section) => section.pageSlug === firstPageSlug);

        setSectionForm((prev) => ({
          ...prev,
          pageSlug: firstPageSlug,
          sectionKey: firstPageSections[0]?.sectionKey ?? "",
          contentJson: JSON.stringify(firstPageSections[0]?.contentJson ?? defaultSectionJson, null, 2),
        }));

        setMediaPageSlug(firstPageSlug);
        setMediaSectionKey(firstPageSections[0]?.sectionKey ?? "");
      }

      if ((data.blogs ?? []).length > 0) {
        setBlogForm((prev) => ({
          ...prev,
          slug: data.blogs[0].slug,
        }));
      }

      setIsConnected(true);
      setStatusText("Connected");
    } catch (error) {
      setIsConnected(false);
      setStatusText(error instanceof Error ? error.message : "Failed to connect");
    } finally {
      setIsLoading(false);
    }
  }

  async function postAction(body: unknown) {
    const response = await fetch("/api/cms-admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cms-admin-secret": secret.trim(),
      },
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as ApiResult;

    if (!response.ok) {
      throw new Error(result.error ?? "CMS update failed");
    }

    return result;
  }

  async function saveSiteGlobals() {
    setIsLoading(true);
    setStatusText("Saving site globals...");

    try {
      await postAction({
        action: "update_site_globals",
        data: siteGlobalsForm,
      });
      setStatusText("Site globals saved and cache revalidated");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to save site globals");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveSection() {
    setIsLoading(true);
    setStatusText("Saving section...");

    try {
      const parsed = JSON.parse(sectionForm.contentJson) as Record<string, unknown>;

      await postAction({
        action: "update_section",
        data: {
          pageSlug: sectionForm.pageSlug,
          sectionKey: sectionForm.sectionKey,
          contentJson: parsed,
        },
      });

      setStatusText("Section saved and cache revalidated");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to save section");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveBlog() {
    setIsLoading(true);
    setStatusText("Saving blog post...");

    try {
      await postAction({
        action: "update_blog",
        data: {
          ...blogForm,
          status: "published",
        },
      });

      setStatusText("Blog post saved and cache revalidated");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to save blog post");
    } finally {
      setIsLoading(false);
    }
  }

  async function syncDefaults() {
    setIsLoading(true);
    setStatusText("Syncing local defaults to Supabase...");

    try {
      const result = await postAction({
        action: "sync_defaults",
        data: {},
      });

      await connect();

      const insertedPages = result.summary?.insertedPages ?? 0;
      const insertedSections = result.summary?.insertedSections ?? 0;
      const updatedSections = result.summary?.updatedSections ?? 0;
      const syncedBlogs = result.summary?.syncedBlogs ?? 0;

      setStatusText(
        `Defaults synced: ${insertedPages} pages, ${insertedSections} inserted sections, ${updatedSections} updated sections, ${syncedBlogs} blog posts.`,
      );
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to sync defaults");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchMedia(pageSlug = mediaPageSlug, sectionKey = mediaSectionKey, itemKey = mediaItemKey) {
    if (!secret.trim()) return;
    try {
      const params = new URLSearchParams({ secret: secret.trim() });
      if (pageSlug) params.set("pageSlug", pageSlug);
      if (sectionKey) params.set("sectionKey", sectionKey);
      if (itemKey) params.set("itemKey", itemKey);

      const res = await fetch(`/api/cms-admin/media?${params.toString()}`);
      const json = await res.json();
      setMediaList(json.data ?? []);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (isConnected) {
      fetchMedia();
    }
  }, [isConnected, mediaPageSlug, mediaSectionKey, mediaItemKey]);

  useEffect(() => {
    if (mediaSectionKeys.length === 0) {
      if (mediaSectionKey !== "") {
        setMediaSectionKey("");
      }
      return;
    }

    if (!mediaSectionKeys.includes(mediaSectionKey)) {
      setMediaSectionKey(mediaSectionKeys[0]);
    }
  }, [mediaSectionKeys, mediaSectionKey]);

  useEffect(() => {
    setMediaItemKey("");
  }, [mediaPageSlug, mediaSectionKey]);

  async function uploadMedia() {
    setIsLoading(true);
    setStatusText("Uploading media...");
    try {
      if (mediaForm.file) {
        const fd = new FormData();
        fd.append("file", mediaForm.file);
        fd.append("alt", mediaForm.alt ?? "");
        fd.append("caption", mediaForm.caption ?? "");
        fd.append("pageSlug", mediaPageSlug);
        fd.append("sectionKey", mediaSectionKey);
        fd.append("itemKey", mediaItemKey);

        const res = await fetch(`/api/cms-admin/media?secret=${encodeURIComponent(secret.trim())}`, {
          method: "POST",
          body: fd,
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Upload failed");
      } else {
        if (!mediaForm.url?.trim()) {
          throw new Error("Select an image file or provide a URL before uploading");
        }

        const res = await fetch(`/api/cms-admin/media?secret=${encodeURIComponent(secret.trim())}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: mediaForm.url || null,
            alt: mediaForm.alt,
            caption: mediaForm.caption,
            pageSlug: mediaPageSlug,
            sectionKey: mediaSectionKey,
            itemKey: mediaItemKey,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Save failed");
      }

      setStatusText("Media uploaded");
      setMediaForm({ url: "", alt: "", caption: "", file: null });
      await fetchMedia();
    } catch (e) {
      setStatusText(e instanceof Error ? e.message : "Upload error");
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteMedia(id: string) {
    if (!confirm("Delete this media? This will remove the DB row and delete the file if it was stored in the bucket.")) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/cms-admin/media?secret=${encodeURIComponent(secret.trim())}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Delete failed");
      setStatusText("Media deleted");
      await fetchMedia();
    } catch (e) {
      setStatusText(e instanceof Error ? e.message : "Delete error");
    } finally {
      setIsLoading(false);
    }
  }

  async function updateMedia(
    id: string,
    updates: { alt?: string; caption?: string; url?: string; pageSlug?: string; sectionKey?: string; itemKey?: string },
  ) {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/cms-admin/media?secret=${encodeURIComponent(secret.trim())}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates, pageSlug: mediaPageSlug, sectionKey: mediaSectionKey, itemKey: mediaItemKey }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Update failed");
      setStatusText("Media updated");
      await fetchMedia();
    } catch (e) {
      setStatusText(e instanceof Error ? e.message : "Update error");
    } finally {
      setIsLoading(false);
    }
  }

  async function runMediaSweep() {
    setIsLoading(true);
    setStatusText("Sweeping page content for media tags...");
    try {
      const res = await fetch(`/api/cms-admin/media/sweep?secret=${encodeURIComponent(secret.trim())}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sweep failed");
      setStatusText(`Media sweep complete: ${json.insertedOrUpdated ?? 0} assets tagged`);
      await fetchMedia();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Sweep failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 md:px-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">CMS Admin</h1>
          <p className="mt-2 text-sm text-slate-600">
            Lightweight content editor for agency handover. Updates trigger cache revalidation automatically.
          </p>
          <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
            <input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="CMS admin secret"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
            />
            <button
              onClick={connect}
              disabled={isLoading}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              Connect
            </button>
            {isConnected && cmsDevMode && (
              <button
                onClick={() => setShowComparison(!showComparison)}
                disabled={isLoading}
                className="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {showComparison ? "Hide" : "Show"} Comparison
              </button>
            )}
            {isConnected && cmsDevMode && cmsComparison?.summary.readyToSync && (
              <button
                onClick={syncDefaults}
                disabled={isLoading}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                Sync Local Defaults
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">Status: {statusText}</p>
        </header>

        {isConnected && showComparison && cmsComparison && cmsDevMode && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">📊 Dev Mode: Cloud vs Local Comparison</h2>
            <p className="mt-1 text-sm text-slate-600">Review what&apos;s missing locally before syncing.</p>
            <div className="mt-6 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg bg-white p-4 border border-amber-200">
                  <h3 className="font-semibold text-sm text-slate-900">Pages</h3>
                  <p className="text-xs text-slate-500 mt-1">Cloud: {cmsComparison.pages.cloud.length} | Local: {cmsComparison.pages.local.length}</p>
                  {cmsComparison.pages.missing.length > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      <strong>Missing:</strong> {cmsComparison.pages.missing.join(", ")}
                    </div>
                  )}
                </div>
                <div className="rounded-lg bg-white p-4 border border-amber-200">
                  <h3 className="font-semibold text-sm text-slate-900">Sections</h3>
                  <p className="text-xs text-slate-500 mt-1">Missing {cmsComparison.sections.totalMissing} sections</p>
                  {cmsComparison.sections.totalMissing > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      {Object.entries(cmsComparison.sections.missingByPage).map(([page, keys]) => (
                        <div key={page}>
                          <strong>{page}:</strong> {keys.join(", ")}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg bg-white p-4 border border-amber-200">
                  <h3 className="font-semibold text-sm text-slate-900">Globals</h3>
                  <p className="text-xs text-slate-500 mt-1">{cmsComparison.globals.cloudExists ? "✓ Exists" : "✗ Missing"}</p>
                </div>
                <div className="rounded-lg bg-white p-4 border border-amber-200">
                  <h3 className="font-semibold text-sm text-slate-900">Blogs</h3>
                  <p className="text-xs text-slate-500 mt-1">Cloud: {cmsComparison.blogs.cloud.length} | Local: {cmsComparison.blogs.local.length}</p>
                  {cmsComparison.blogs.missing.length > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      <strong>Missing:</strong> {cmsComparison.blogs.missing.slice(0, 3).join(", ")}{cmsComparison.blogs.missing.length > 3 ? "..." : ""}
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-lg bg-white p-4 border border-amber-200">
                <h3 className="font-semibold text-sm text-slate-900">Media</h3>
                <p className="text-xs text-slate-500 mt-1">Cloud: {cmsComparison.media.cloudCount} | Local: {cmsComparison.media.localCount}</p>
                {cmsComparison.summary.missingMediaCount > 0 && (
                  <div className="mt-2 text-xs text-red-600 space-y-1">
                    <div><strong>Missing tagged media:</strong> {cmsComparison.summary.missingMediaCount}</div>
                    <div>
                      {cmsComparison.media.missing.slice(0, 4).map((item) => `${item.pageSlug}/${item.sectionKey}/${item.itemKey}`).join(", ")}
                      {cmsComparison.media.missing.length > 4 ? "..." : ""}
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-white p-4 border border-amber-200">
                <h3 className="font-semibold text-sm text-slate-900">Summary</h3>
                <ul className="mt-2 text-xs text-slate-600 space-y-1">
                  <li>• Pages to insert: {cmsComparison.summary.missingPagesCount}</li>
                  <li>• Sections to insert: {cmsComparison.summary.missingSectionsCount}</li>
                  <li>• Globals: {cmsComparison.summary.missingGlobals ? "will upsert" : "already exists"}</li>
                  <li>• Blogs to insert: {cmsComparison.summary.missingBlogsCount}</li>
                  <li>• Media to insert: {cmsComparison.summary.missingMediaCount}</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {isConnected && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">🖼️ Media Manager</h2>
            <p className="mt-1 text-sm text-slate-600">Upload images to the `cms_assets` bucket or add an external URL.</p>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={mediaPageSlug}
                onChange={(event) => setMediaPageSlug(event.target.value)}
              >
                {pageSlugs.map((slug) => (
                  <option key={slug} value={slug}>
                    {slug}
                  </option>
                ))}
              </select>

              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={mediaSectionKey}
                onChange={(event) => setMediaSectionKey(event.target.value)}
              >
                <option value="">All sections</option>
                {mediaSectionKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>

              <input
                placeholder="Item key (optional)"
                value={mediaItemKey}
                onChange={(event) => setMediaItemKey(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />

              <button
                onClick={runMediaSweep}
                disabled={isLoading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Sweep Media Tags
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="p-4 border rounded">
                <label className="text-sm font-medium">Upload file</label>
                <input
                  ref={mediaFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setMediaForm((prev) => ({ ...prev, file: e.target.files?.[0] ?? null }))}
                  className="hidden"
                />
                <input
                  value={mediaForm.file?.name ?? ""}
                  placeholder="No image selected"
                  readOnly
                  className="w-full mt-2 rounded border px-3 py-2 text-sm bg-slate-50"
                />
                <input
                  placeholder="Alt text"
                  value={mediaForm.alt}
                  onChange={(e) => setMediaForm((prev) => ({ ...prev, alt: e.target.value }))}
                  className="w-full mt-2 rounded border px-3 py-2 text-sm"
                />
                <input
                  placeholder="Caption"
                  value={mediaForm.caption}
                  onChange={(e) => setMediaForm((prev) => ({ ...prev, caption: e.target.value }))}
                  className="w-full mt-2 rounded border px-3 py-2 text-sm"
                />
                <div className="mt-2 text-xs text-slate-500">
                  Context tags: {mediaPageSlug} / {mediaSectionKey || "all sections"} / {mediaItemKey || "item optional"}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => mediaFileInputRef.current?.click()}
                    disabled={isLoading}
                    className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-60"
                  >
                    Select Image
                  </button>
                  <button
                    onClick={uploadMedia}
                    disabled={isLoading || !mediaForm.file}
                    className="rounded bg-indigo-600 text-white px-4 py-2 text-sm disabled:opacity-60"
                  >
                    Upload
                  </button>
                </div>
              </div>

              <div className="p-4 border rounded">
                <label className="text-sm font-medium">Or provide an external URL (leave blank to create placeholder)</label>
                <input
                  placeholder="https://..."
                  value={mediaForm.url}
                  onChange={(e) => setMediaForm((prev) => ({ ...prev, url: e.target.value }))}
                  className="w-full mt-2 rounded border px-3 py-2 text-sm"
                />
                <input
                  placeholder="Alt text"
                  value={mediaForm.alt}
                  onChange={(e) => setMediaForm((prev) => ({ ...prev, alt: e.target.value }))}
                  className="w-full mt-2 rounded border px-3 py-2 text-sm"
                />
                <input
                  placeholder="Caption"
                  value={mediaForm.caption}
                  onChange={(e) => setMediaForm((prev) => ({ ...prev, caption: e.target.value }))}
                  className="w-full mt-2 rounded border px-3 py-2 text-sm"
                />
                <div className="mt-2 text-xs text-slate-500">
                  Context tags: {mediaPageSlug} / {mediaSectionKey || "all sections"} / {mediaItemKey || "item optional"}
                </div>
                <div className="mt-3">
                  <button onClick={uploadMedia} disabled={isLoading} className="rounded bg-indigo-600 text-white px-4 py-2 text-sm">Save</button>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="font-semibold text-sm">Existing Media</h3>
              <div className="mt-3 grid gap-3">
                {mediaList.map((m) => (
                  <div key={m.id} className="flex items-center gap-4 border p-3 rounded">
                    <div className="w-20 h-12 bg-slate-100 rounded overflow-hidden flex items-center justify-center">
                      {m.public_url ? <img src={m.public_url} alt={m.alt_text ?? ""} className="object-cover w-full h-full" /> : <span className="text-xs text-slate-400">No preview</span>}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{m.caption ?? "Untitled"}</div>
                      <div className="text-xs text-slate-500">{m.public_url || m.storage_path}</div>
                      <div className="text-xs text-slate-400 mt-1">
                        {m.page_slug ?? "unassigned"} / {m.section_key ?? "-"} / {m.item_key ?? "-"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => {
                        const newAlt = prompt("Alt text:", m.alt_text ?? "") ?? m.alt_text ?? "";
                        const newCaption = prompt("Caption:", m.caption ?? "") ?? m.caption ?? "";
                        const newUrl = prompt("Image URL (leave blank to clear):", m.public_url ?? "") ?? m.public_url;
                        const newPageSlug = prompt("Page slug:", m.page_slug ?? mediaPageSlug) ?? m.page_slug ?? mediaPageSlug;
                        const newSectionKey = prompt("Section key:", m.section_key ?? mediaSectionKey) ?? m.section_key ?? mediaSectionKey;
                        const newItemKey = prompt("Item key:", m.item_key ?? mediaItemKey) ?? m.item_key ?? mediaItemKey;
                        updateMedia(m.id, { alt: newAlt, caption: newCaption, url: newUrl, pageSlug: newPageSlug, sectionKey: newSectionKey, itemKey: newItemKey });
                      }} className="text-sm px-3 py-1 rounded border">Edit</button>
                      <button onClick={() => deleteMedia(m.id)} className="text-sm px-3 py-1 rounded border text-red-600">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        {isConnected && (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">1. Site Globals</h2>
              <p className="mt-1 text-sm text-slate-600">Phone, email, address, and brand-level copy.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Company Name" value={siteGlobalsForm.companyName} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, companyName: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Tagline" value={siteGlobalsForm.tagline} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, tagline: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Primary Phone" value={siteGlobalsForm.phonePrimary} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, phonePrimary: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Secondary Phone" value={siteGlobalsForm.phoneSecondary} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, phoneSecondary: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Primary Email" value={siteGlobalsForm.emailPrimary} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, emailPrimary: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Support Email" value={siteGlobalsForm.emailSupport} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, emailSupport: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Address Line 1" value={siteGlobalsForm.addressLine1} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, addressLine1: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Address Line 2" value={siteGlobalsForm.addressLine2} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, addressLine2: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Maps URL" value={siteGlobalsForm.mapsUrl} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, mapsUrl: event.target.value }))} />
                <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Brand description" rows={3} value={siteGlobalsForm.brandDescription} onChange={(event) => setSiteGlobalsForm((prev) => ({ ...prev, brandDescription: event.target.value }))} />
              </div>
              <button onClick={saveSiteGlobals} disabled={isLoading} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                Save Site Globals
              </button>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">2. Section JSON Editor</h2>
              <p className="mt-1 text-sm text-slate-600">Select a page and section key to edit the existing JSON content.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={sectionForm.pageSlug} onChange={(event) => setSectionForm((prev) => ({ ...prev, pageSlug: event.target.value }))}>
                  {pageSlugs.map((slug) => (
                    <option key={slug} value={slug}>{slug}</option>
                  ))}
                </select>
                <select
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={sectionForm.sectionKey}
                  onChange={(event) => setSectionForm((prev) => ({ ...prev, sectionKey: event.target.value }))}
                  disabled={sectionKeys.length === 0}
                >
                  {sectionKeys.length === 0 ? (
                    <option value="">No sections found for this page</option>
                  ) : (
                    sectionKeys.map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))
                  )}
                </select>
                <textarea className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs md:col-span-2" rows={12} value={sectionForm.contentJson} onChange={(event) => setSectionForm((prev) => ({ ...prev, contentJson: event.target.value }))} />
              </div>
              <button onClick={saveSection} disabled={isLoading} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                Save Section JSON
              </button>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">3. Blog Editor</h2>
              <p className="mt-1 text-sm text-slate-600">Publish or update blog content by slug.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input list="blog-slugs" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="blog slug" value={blogForm.slug} onChange={(event) => setBlogForm((prev) => ({ ...prev, slug: event.target.value }))} />
                <datalist id="blog-slugs">
                  {blogSlugs.map((slug) => (
                    <option key={slug} value={slug} />
                  ))}
                </datalist>
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Title" value={blogForm.title} onChange={(event) => setBlogForm((prev) => ({ ...prev, title: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Category" value={blogForm.category} onChange={(event) => setBlogForm((prev) => ({ ...prev, category: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Read time (for example: 5 min read)" value={blogForm.readTime} onChange={(event) => setBlogForm((prev) => ({ ...prev, readTime: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Author name" value={blogForm.authorName} onChange={(event) => setBlogForm((prev) => ({ ...prev, authorName: event.target.value }))} />
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Author role" value={blogForm.authorRole} onChange={(event) => setBlogForm((prev) => ({ ...prev, authorRole: event.target.value }))} />
                <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" rows={3} placeholder="Excerpt" value={blogForm.excerpt} onChange={(event) => setBlogForm((prev) => ({ ...prev, excerpt: event.target.value }))} />
                <textarea className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs md:col-span-2" rows={12} placeholder="Markdown body" value={blogForm.bodyMarkdown} onChange={(event) => setBlogForm((prev) => ({ ...prev, bodyMarkdown: event.target.value }))} />
              </div>
              <button onClick={saveBlog} disabled={isLoading} className="mt-4 rounded-lg bg-purple-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                Save Blog Post
              </button>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
