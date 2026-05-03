"use client";

import { useMemo } from "react";
import type { BlogPost } from "@/data/blog-posts";
import { useCmsPreload } from "@/components/providers/CmsPreloadProvider";
import { resolveCmsBlogPost } from "@/services/cms/snapshot";

export function useCmsBlogPost(slug: string, fallback: BlogPost | null) {
  const { blogPosts } = useCmsPreload();

  return useMemo(
    () => resolveCmsBlogPost(blogPosts, slug, fallback),
    [blogPosts, slug, fallback],
  );
}
