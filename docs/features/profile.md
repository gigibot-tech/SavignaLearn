# Profile

Tap a friend’s **name** (or the thread header avatar / title) to open `/u/<userId>`. Inbox rows still open the **chat**. Your own photo and about are set in **Settings → Profile** and show on that same profile screen.

## What’s on the profile

- Photo (letter fallback; SavignasBoi keeps the bundled cat), display name, handle, email
- **Last seen / online** — WhatsApp-style: `online` if they heartbeated in the last three minutes, otherwise `last seen today at …` / `yesterday` / a date. Hidden when they turn off **Last seen & online** in Settings
- **About** — short bio (139 characters)
- Chat stats: messages, from them (or bot replies), your messages, photos, vocab cards from this thread, friends-since / first practice
- **Message** — opens the DM (or SavignasBoi)
- **Delete friend** — accepted friends only; confirm sheet. Unfriends both sides. The chat stays on this device until you hide it
- **Your** profile: **Edit photo & about** goes to Settings (no delete-friend)

SavignasBoi has a profile (practice stats, always **online**) but no delete-friend action.

The same photo and last-seen state appear on the inbox green dot, thread header subtitle, friends list, and desktop sidebar. Tapping the sidebar name/photo opens Settings.

Deep link: `/u/<userId>` or `/u/<userId>?chat=<conversationId>`. After login, a `/u/…` URL is kept (not bounced to the bot thread).

## Persistence

- This device: `savigna.profileCards.v1` in auth storage (photo, about, last seen)
- Cloud (iDO): `savigna_profiles.bio`, `photo_url`, `last_seen_at`, `presence_opt_in`. Any signed-in user can **read** a card; only `auth.uid()` can write. Heartbeat while the app tab is visible. No storage bucket — photos are compressed JPEGs (same idea as chat `data:image` send)
