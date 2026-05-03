"use client";

import { useMemo } from "react";
import { useCmsPreload } from "@/components/providers/CmsPreloadProvider";
import { resolveCmsMediaAssets } from "@/services/cms/snapshot";

export function useCmsMedia(pageSlug: string, sectionKey?: string, itemKey?: string) {
  const { mediaAssets } = useCmsPreload();

  const data = useMemo(
    () => resolveCmsMediaAssets(mediaAssets, pageSlug, sectionKey, itemKey),
    [mediaAssets, pageSlug, sectionKey, itemKey],
  );

  return {
    data,
    isLoading: false,
  };
}