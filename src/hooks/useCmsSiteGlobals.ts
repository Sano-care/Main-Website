"use client";

import { useMemo } from "react";
import { useCmsPreload } from "@/components/providers/CmsPreloadProvider";

export function useCmsSiteGlobals() {
  const { siteGlobals } = useCmsPreload();

  return useMemo(() => siteGlobals, [siteGlobals]);
}
