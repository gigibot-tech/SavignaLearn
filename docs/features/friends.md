# Friends

Chat + friends only (no meetups). Desktop uses a **collapsible** side column: collapsed icon rail by default; **top-left menu** expands Chats / Friends / Settings + lists. Picking a **chat**, **friend name → profile**, **Chat**, or **Settings** collapses the panel again. Mobile uses the same three tabs. Chat connection, languages, and bot replies live in the **thread header** (sliders sheet below 1024px; inline chips at L/XL).

## Add a friend

Paste **email**, a **copy-pastable user id**, or a **friend link**. Demo usernames **alex**, **mira**, **jordan** still work — each has a real email (`alex@savigna.local`, etc.).

Share format (canonical):

```
https://<origin>/friends?add=<userId>
```

Friends and Settings both have **Copy my friend link** and **Copy my user id**. Opening that URL prefills the Add field and sends the request.

**Never insert a ghost.** The identifier must resolve in **SavignaLearn’s user store** and, when iDO Auth is configured, in **iDO** (`profiles` / demo overlay). If either side is missing, or the profile has no email, show the error modal and **do not** create a friendship or stub profile.

| Action | Result |
|--------|--------|
| Unknown email or user id | Modal: not in SavignaLearn or iDO — nothing is added |
| Username matches more than one person | Modal: use their email — nothing is added |
| In iDO but not SavignaLearn | Modal: they need a SavignaLearn account too |
| In SavignaLearn but not iDO (when iDO is configured) | Modal: they need an iDO account too |
| Profile has no email | Modal: can’t add without an email |
| Malformed link | Modal: use `/friends?add=<user-id>` |
| Add yourself | Modal: “That’s you” |
| Add someone who already requested you | Auto-accept (only if they still exist in both directories) |
| Accept | They appear under Friends; tap the **name** to open their profile (stats + delete friend). **Chat** still opens the DM |
| Remove / Cancel / Decline | Deletes the pair both ways; seed will not recreate it |

Resolution order: friend link (`?add=`) → email (lowercase) → UUID user id → username. Handles come from the email (known accounts keep `@savina` / `@learn` / `@learner`; otherwise the local-part). If two people share a username, **do not guess** — adding by `@handle` shows “use their email”, and lists/inbox/thread titles show the email instead of `@handle`. Every `PublicProfile` / friend row **requires** an email; unique handles still show as `@handle · email`.

## Inconsistent accounts

On Friends load (and when opening Add friend), each existing row is re-checked against both directories. If the person was deleted, missing in one DB, or lost their email, the row is flagged **Inconsistent** with a **Delete** button — we do not pretend they still exist. Deleting an inconsistent row does not bring them back on the next seed.

## Demo seed

- Demo login (`learner@savigna.local` / `demo`, or iDO `learn@savigna.local` / `learn`) seeds Mira (accepted) and a request from Alex.
- **learner@ / learn@savigna.local / learn@savina.special** and **icestormfroste@gmail.com** (`@icestormfroste`) are **mutual accepted friends** when both exist.
- Do not friend SavignasBoi.

## SavignasBoi for every user

`ensureLearningBotChat` creates a **per-user** bot thread after sign-in (demo learner, iDO, fourSome). It does not reuse or steal another viewer’s `demo-1` conversation.

Persistence is in-memory until `savigna_friendships` is wired on Supabase.
