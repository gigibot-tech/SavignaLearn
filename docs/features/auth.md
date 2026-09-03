# Auth

SavignaLearn is gated by a real session. Demo “Continue as demo learner” is only shown when **neither** fourSome nor iDO Auth is configured.

Local demo (always accepted on the email form):

- Email: `learner@savigna.local`
- Password: `demo`

After sign-in the app opens **SavignasBoi** (not Settings, and not the invite empty-home). Sign-out resets the URL to chats home so the next login does not restore a stale tab.

## Keep me logged in

Checked by default. Unchecked stores the session in the tab only (gone when the tab closes).

## Sign out

Settings tab (**Sign out**), chats home (log-out icon, top left), and the inbox header.

## Mix of fourSome + iDO

One email/password form tries **both** Supabase Auth projects:

- fourSome: `EXPO_PUBLIC_FOURSOME_SUPABASE_*` (same project as the fourSome app)
- iDO: `EXPO_PUBLIC_IDO_SUPABASE_*` (ido-core)

Either session is enough to enter the app. Chat stays in-memory unless `EXPO_PUBLIC_SUPABASE_URL` points at SavignaLearn `savigna_*` tables — do not point that at fourSome/iDO databases.

| Provider | Unlocks |
| --- | --- |
| fourSome session | fourSome AI chip (plus on-prem/OpenAI still have to be up) and GiGi WebSocket user id |
| iDO session | iDO AI chip (`ai-assist`) |

Settings can link the provider the home form did not match. Sign-out of the last provider returns to the login screen.

An iDO UUID is never sent to GiGi. GiGi only uses `user.fourSomeUserId`.
