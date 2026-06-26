import type { Metadata } from "next";
import { notFound } from "next/navigation";

import RecordsDetail from "../RecordsDetail";
import { CATEGORY_CONFIG, isRecordTileKey } from "../categories";

// R1 — deep-linkable per-category detail screen (/pulse/records/[category]).
// Routes (not client tab state) so home-screen shortcuts can land here in a
// later slice. The (authed) layout is the auth gate + chrome + viewing-member
// provider; this server page just validates the slug and hands off to the
// client detail, which loads the same /api/pulse/records payload.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const label = isRecordTileKey(category) ? CATEGORY_CONFIG[category].label : "Records";
  return { title: `${label} · Sanocare Pulse` };
}

export default async function RecordsCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!isRecordTileKey(category)) notFound();
  return <RecordsDetail category={category} />;
}
