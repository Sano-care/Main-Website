export type CmsSource = "cms" | "fallback";

export interface CmsResolved<T> {
  data: T;
  source: CmsSource;
}

export interface CmsSectionRow {
  content_json: Record<string, unknown> | null;
}
