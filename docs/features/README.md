# Features

| Feature | Status | Notes |
|---------|--------|-------|
| Chat (inbox + thread) | MVP | Line + Birkenbihl. Compact: header sliders → chat sheet. ≥1024: this-chat chips in the thread header. Sidebar/tab **Settings** is app-wide. |
| Chat persistence | MVP | See `chat-persistence.md` (local KV first; cloud opt-in per chat) |
| Friends | MVP | See `friends.md` (email required; dual-directory existence; inconsistent + delete; demo mutual learner ↔ icestormfroste) |
| Auth | MVP | See `auth.md` (fourSome + iDO sign-in; demo only if neither is configured) |
| Alpha notice | Alpha | Screenshot warning on login + chats home. See `alpha.md` |
| Translation / AI pipeline | MVP | See `ai-pipeline.md` (detect-first, circuit breaker, switchable backends) |
| AI participant | MVP | Distinct bubble, opt-out |
| Vocabulary | MVP | Tap a chat word → create-card modal. Same word+lang+source refetches the same id. Tipped cards also scroll on chats home / Pick a chat. See `vocabulary.md` |
| Media / stickers | MVP chat send | Default pack + image bubbles. Gigolingo catalog/shield still planned — see `media.md` |
| Notifications | MVP (web toggle) | Browser notifications (with optional service worker) on Netlify while app tab is open. Native uses `expo-notifications` for local alerts. |
| Web deploy (Netlify) | MVP config | See `docs/setup/netlify.md`. Expo **server** output + adapter — not fourSome’s static SPA. |
