# Friends

Chat + friends only (no meetups). Desktop copies fourSome’s web **280px side column**: Chats, Friends, **Settings** (app-wide: account, AI connection panel, sign out). Mobile uses the same three tabs. Chat connection, languages, and bot replies live in the **thread header** (sliders sheet below 1024px; inline chips at L/XL).

## Add a friend

Paste **email**, a **copy-pastable user id**, or a **friend link**. Demo usernames **alex**, **mira**, **jordan** still work.

Share format (canonical):

```
https://<origin>/friends?add=<userId>
```

Friends and Settings both have **Copy my friend link** and **Copy my user id**. Opening that URL prefills the Add field and sends the request.

| Action | Result |
|--------|--------|
| Unknown email or user id | Modal: not in SavignaLearn or iDO |
| In iDO but not SavignaLearn | Modal: they need a SavignaLearn account too |
| In SavignaLearn but not iDO (when iDO is configured) | Modal: they need an iDO account too |
| Malformed link | Modal: use `/friends?add=<user-id>` |
| Add yourself | Modal: “That’s you” |
| Add someone who already requested you | Auto-accept |
| Accept | They appear under Friends; tap to open a DM |

Resolution order: friend link (`?add=`) → email (lowercase) → UUID user id → username. Handles come from the email local-part (`usernameFromUser`).

When iDO Auth is configured, the person must exist in **both** directories (SavignaLearn identity store and iDO `profiles` / demo overlay). If iDO isn’t configured, only the in-memory/demo directory is required; unknown identifiers still show the modal.

`findOrCreateDirectChat` reuses an existing 1:1 thread and never opens SavignasBoi (`savigna-ai`).

## Demo seed

- Demo login (`learner@savigna.local` / `demo`) seeds Mira (accepted) and a request from Alex.
- **learner@** and **icestormfroste@gmail.com** (`@icestormfroste`) are **mutual accepted friends**. Signing in as either side sees the other (same `friendshipPairKey`; if iDO gives icestormfroste a real UUID, the seeded profile rebinds to it).
- Do not friend SavignasBoi.

## SavignasBoi for every user

`ensureLearningBotChat` creates a **per-user** bot thread after sign-in (demo learner, iDO, fourSome). It does not reuse or steal another viewer’s `demo-1` conversation.

Persistence is in-memory until `savigna_friendships` is wired on Supabase.
