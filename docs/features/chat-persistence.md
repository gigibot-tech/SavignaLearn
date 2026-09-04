# Chat persistence

**Human DMs are shared.** When iDO Auth is configured, a **non-Bot** thread (This chat · Cloud) is saved to `savigna_*`. Opening it uploads any leftover local history. Bot stays **This device** only.

Inbox therefore lists **local + cloud**, then collapses extra rows for the same pair (stub `friend-icestormfroste` and icestorm’s live iDO id count as one person).

A DM written only to the stub id is still migrated onto icestorm’s live id on hydrate (same browser). After a reload, both people should open the same `dm:` thread from cloud.

`ChatContentCipher` is ready for a future AES adapter (`enc_version` / `enc_alg`, v0 = plaintext).

Actor ids: hydrate and list **both** `user.id` and `user.idoUserId` so an older local snapshot is not abandoned after mixed auth. One **Bot** thread is shown even if ensure ran in parallel.

Opening a thread shows pulsing **text-line skeletons** until local hydrate + cloud `listMessages` finish (`ThreadMessageSkeleton`). Inbox / auth boot uses the same text-bar `InboxSkeleton`. Inbox, friends, and thread **reads** go through TanStack Query (`features/query`) so the sidebar and chats home share one cache and switching back to a thread can reuse the last snapshot. Send / translation retries stay local mutations.

## Pattern

Chat persistence now uses **Repository + Routing Policy**:

- `InMemoryChatRepository` is the explicit **local** storage adapter for KV snapshots.
- `SupabaseChatRepository` is the explicit **cloud** storage adapter for `savigna_*`.
- `PolicyChatRepository` is the single app-facing repository. It delegates to one backend per conversation.
- `LocalFirstChatPolicy` decides the route. Today it keeps inbox/thread startup on local only and remembers which backend owns a conversation.

That split keeps storage I/O inside adapters and keeps the selection rule separate, so a later per-chat "store this one in cloud" option can change policy/route state without rewriting the repositories.

Delete-for-everyone tombstones `savigna_messages` (clears text). Delete-for-me is per user (`savigna_message_hides` + local snapshot). See `message-delete.md`.

Per-user unread lives in the local snapshot (`unreadCounts`) and, for shared human DMs, `savigna_participants.unread_count`. Opening a thread calls `markConversationRead`.
