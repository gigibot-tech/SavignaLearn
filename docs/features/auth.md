# Auth

SavignaLearn is gated by a real session. Demo “Continue as demo learner” is only shown when **neither** fourSome nor iDO Auth is configured.

Login and chats home always show the reusable **alpha** screenshot warning (`AlphaNotice` — see `alpha.md`). It is not dismissible.

Local demo (always accepted on the email form, and now also a real **iDO** user):

- Email: `learner@savigna.local`
- Password: `demo`

Sign in with that pair to use the iDO AI chip (not the offline Demo backend). Re-login if you were already on the local `@learner` session.

Other iDO accounts:

- Email: `learn@savigna.local` · Password: `learn` · username `@learn`
- Email: `learn@savina.special` · Password: `learn` · username `@savina` (not `@learn` — that handle is already taken). If a username is shared, the app shows **email** instead.

After sign-in the app opens **Bot** (not Settings, and not the invite empty-home). Sign-out resets the URL to chats home so the next login does not restore a stale tab.

## Keep me logged in

Checked by default. Unchecked stores the session in the tab only (gone when the tab closes).

## Sign out

Settings tab (**Sign out**), chats home (log-out icon, top left), and the inbox header.

## Mix of fourSome + iDO

One email/password form tries **both** Supabase Auth projects:

- fourSome: `EXPO_PUBLIC_FOURSOME_SUPABASE_*` (same project as the fourSome app)
- iDO: `EXPO_PUBLIC_IDO_SUPABASE_*` (ido-core)

Either session is enough to enter the app. Chat is stored on the **iDO** project in namespaced `savigna_*` tables when an iDO JWT is present (see `chat-persistence.md`). Do **not** point `EXPO_PUBLIC_SUPABASE_URL` at fourSome. Leave it empty unless you spin up a dedicated SavignaLearn project; the iDO client (`EXPO_PUBLIC_IDO_SUPABASE_*`) is the chat backend.

| Provider | Unlocks |
| --- | --- |
| fourSome session | fourSome AI chip (plus on-prem/OpenAI still have to be up) and GiGi WebSocket user id |
| iDO session | iDO AI chip (`ai-assist`) and durable `savigna_*` chat |

Settings can link the provider the home form did not match. Sign-out of the last provider returns to the login screen.

An iDO UUID is never sent to GiGi. GiGi only uses `user.fourSomeUserId`.
