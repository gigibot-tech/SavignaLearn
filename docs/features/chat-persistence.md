# Chat persistence

**Default is this device.** Inbox and threads load from local KV (`savigna.chat.v1.<userId>` via `authStorage` / localStorage). An iDO JWT does **not** switch the inbox to `savigna_*`.

Cloud (`savigna_*` on iDO! Ai Trial) is opt-in per chat later. Schema is applied; the app must not query those tables on first paint.

`ChatContentCipher` is ready for a future AES adapter (`enc_version` / `enc_alg`, v0 = plaintext).

Actor ids: hydrate and list **both** `user.id` and `user.idoUserId` so an older local snapshot is not abandoned after mixed auth. One **Bot** thread is shown even if ensure ran in parallel.

## Pattern

Chat persistence now uses **Repository + Routing Policy**:

- `InMemoryChatRepository` is the explicit **local** storage adapter for KV snapshots.
- `SupabaseChatRepository` is the explicit **cloud** storage adapter for `savigna_*`.
- `PolicyChatRepository` is the single app-facing repository. It delegates to one backend per conversation.
- `LocalFirstChatPolicy` decides the route. Today it keeps inbox/thread startup on local only and remembers which backend owns a conversation.

That split keeps storage I/O inside adapters and keeps the selection rule separate, so a later per-chat "store this one in cloud" option can change policy/route state without rewriting the repositories.
