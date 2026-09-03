# Notifications

This app supports **browser notifications** on web (Netlify deployment) via the standard
`Notification` API and a tiny service-worker “worker”.

There is **no web-push / edge function** in this implementation. Instead, the app uses
Supabase realtime subscriptions (already present in `chat.subscribe`) and shows notifications
while the browser tab is still alive and has received updates.

## What you get

### Web (Expo web on Netlify)

1. User enables notifications in **Settings**.
2. The app requests `Notification` permission and registers `/service-worker.js`.
3. While notifications are enabled, the app listens for new messages in inbox conversations.
4. When a message arrives and the user is **not currently viewing** `/chat/[id]`, the app
   shows a browser notification.
5. Clicking the notification opens `/chat/[id]`.

Live unread counts (independent of the notification toggle):

- New messages increment unread for the other **human** (not the author, not SavignasBoi as a recipient, not delete-for-everyone tombstones).
- Opening a thread sets that chat’s unread to 0.
- Muted chats are excluded from the Chats tab / sidebar total.
- The red badge is the inbox `unreadCount` on each row, the Chats tab/sidebar total, and a best-effort OS app icon badge (`navigator.setAppBadge` on web, `expo-notifications` on native).
- Incoming friend requests badge the Friends tab / sidebar.

### Native

The toggle enables **local alerts** via `expo-notifications` (send/app-triggered notifications).

## How to enable

1. Sign in.
2. Open **Settings**.
3. Turn on **Notifications → Enabled**.
4. Accept the browser permission prompt.

## Env vars

No env vars are required for the browser notifications path.

Native uses the standard Expo `expo-notifications` setup and does not require extra configuration
from this repo.

## Local testing (Netlify-compatible)

Use:

- `http://localhost:8081`

Suggested test:

1. Enable notifications in **Settings** (accept the permission prompt).
2. Go to **Inbox** (not `/chat/[id]`).
3. Open a chat in another tab and send a message (bot reply or message from other side).
4. You should see a browser notification appear; click it to open the relevant chat route.

If you don’t see the notification, check:

- The permission is `Granted` in your browser.
- You enabled the toggle after granting permission.
- You still have the app tab open (this implementation does not push while the tab is closed).

