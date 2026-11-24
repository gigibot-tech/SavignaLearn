# Features

| Feature | Status | Notes |
|---------|--------|-------|
| Chat (inbox + thread) | MVP | Line + Birkenbihl. Compact: header sliders → chat sheet. ≥1024: this-chat chips in the thread header. **Chats / Friends / Settings tabs stay on screen during a thread** (and on profile). Sidebar/tab **Settings** is app-wide. |
| Chat persistence | MVP | See `chat-persistence.md` (human DMs share one `dm:` id on savigna_*; Bot stays local) |
| Message delete | MVP | WhatsApp-like delete for me / delete for everyone. See `message-delete.md` |
| Friends | MVP | See `friends.md` (email required; dual-directory existence; inconsistent + delete; demo mutual learner ↔ icestormfroste) |
| Profile | MVP | Photo, about, WhatsApp-style last seen / online. Settings edits your card; tap a name for `/u/<userId>`. See `profile.md` |
| Auth | MVP | See `auth.md` (fourSome + iDO sign-in; demo only if neither is configured) |
| Appearance | MVP | **Rosa** default; **Orange** (ember) in Settings. Saved on device. See `appearance.md` |
| Alpha notice | Alpha | Screenshot warning on login + Settings. See `alpha.md` |
| Translation / AI pipeline | MVP | See `ai-pipeline.md` (detect-first, circuit breaker, switchable backends) |
| AI participant | MVP | Distinct bubble, opt-out |
| Vocabulary | MVP | Tap a chat word → create-card modal. Same word+lang+source refetches the same id. Tipped cards also scroll on chats home / Pick a chat. See `vocabulary.md` |
| Media / stickers | MVP chat send | Default pack + image bubbles. Gigolingo catalog/shield still planned — see `media.md` |
| Notifications | MVP (web toggle) | Browser notifications (with optional service worker) on Netlify while app tab is open. Native uses `expo-notifications` for local alerts. Live unread badges on Chats / Friends tabs and the desktop rail. |
| WhatsApp import | MVP | Paste a copied WhatsApp chat, map the two names before `:` to you vs them (guessed from email/username), import as a DM. See `whatsapp-import.md` |
| Web deploy (Netlify) | MVP config | See `docs/setup/netlify.md`. Expo **server** output + adapter — not fourSome’s static SPA. |
