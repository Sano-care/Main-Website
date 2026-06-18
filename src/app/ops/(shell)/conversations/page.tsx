import type { Metadata } from "next";

import { ConversationsShell } from "./ConversationsShell";
import { getConversationMeta, getThread, listConversations } from "./data";

export const metadata: Metadata = {
  title: "Ops · Conversations",
  robots: { index: false, follow: false },
};

// Re-fetch on every navigation so ops always sees fresh state. Auth is enforced
// by the (shell) layout's getCurrentOpsUser() — any authenticated ops user can
// view all conversations (v1; RBAC is v2).
export const dynamic = "force-dynamic";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const conversations = await listConversations();

  const requestedId = id ?? null;
  const [thread, meta] = requestedId
    ? await Promise.all([getThread(requestedId), getConversationMeta(requestedId)])
    : [null, null];

  // A stale / unknown ?id (meta === null) falls back to the list view.
  const selectedId = meta ? requestedId : null;

  return (
    <ConversationsShell
      conversations={conversations}
      thread={selectedId ? thread : null}
      meta={selectedId ? meta : null}
      selectedId={selectedId}
    />
  );
}
