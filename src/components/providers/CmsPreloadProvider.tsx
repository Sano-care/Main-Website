"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { CmsPreloadSnapshot } from "@/services/cms/snapshot";

const EMPTY_SNAPSHOT: CmsPreloadSnapshot = {
  sections: {},
  blogPosts: {},
  siteGlobals: null,
  mediaAssets: [],
};

const CmsPreloadContext = createContext<CmsPreloadSnapshot>(EMPTY_SNAPSHOT);

interface CmsPreloadProviderProps {
  snapshot: CmsPreloadSnapshot;
  children: ReactNode;
}

export function CmsPreloadProvider({ snapshot, children }: CmsPreloadProviderProps) {
  return (
    <CmsPreloadContext.Provider value={snapshot}>
      {children}
    </CmsPreloadContext.Provider>
  );
}

export function useCmsPreload() {
  return useContext(CmsPreloadContext);
}
