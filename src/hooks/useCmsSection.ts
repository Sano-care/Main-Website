"use client";

import { useMemo } from "react";
import { useCmsPreload } from "@/components/providers/CmsPreloadProvider";
import { resolveCmsSection } from "@/services/cms/snapshot";

export function useCmsSection<T>(pageSlug: string, sectionKey: string, fallback: T) {
  const { sections } = useCmsPreload();
  const resolved = useMemo(
    () => resolveCmsSection(sections, pageSlug, sectionKey, fallback),
    [sections, pageSlug, sectionKey, fallback],
  );

  return {
    data: resolved.data,
    source: resolved.source,
    isLoading: false,
  };
}
