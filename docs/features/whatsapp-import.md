# WhatsApp import

Paste a copied WhatsApp chat (not an `.txt` export file — the copy you get from selecting messages).

Format:

```
[16:05, 3.9.2026] Andrea: hello
[16:06, 3.9.2026] Savi(g)na 🔥: hi
```

## Flow

1. **Import WhatsApp** at the bottom of the chat list (phone inbox and desktop pane) or on Friends.
2. Paste the transcript and tap **Read names**.
3. Pick **I am** / **They are** — the two names before `:`.
4. Guess uses substring / similar match against your email, username, and display name (so `Andrea` matches `andrearachetta@…`, `Savi(g)na` matches `Savigna`). If the scores are close or weak, you choose.
5. **Save as** an existing friend when the other name matches, or a new local chat titled with the WhatsApp name.
6. Quoted reply prefixes (the previous bubble WhatsApp includes when you copy) are stripped so only the new line is imported.

Imported history is local-first like other chats. Re-pasting the same lines is skipped.
