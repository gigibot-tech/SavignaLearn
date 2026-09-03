# Message delete

WhatsApp-style actions on a chat bubble: **Delete for me** and **Delete for everyone**.

Long-press a message (right-click on web) to open the sheet.

## Delete for me

Hides the bubble for **this account only**. The other person still sees it.

Stored per user in the local chat snapshot (`hiddenMessageIds`) and, when iDO is configured, in `savigna_message_hides` so another device on the same login can hide it too.

Inbox preview skips hidden messages for that viewer.

## Delete for everyone

Only the **author**, and only within **48 hours**. The row stays in the thread as *This message was deleted* for both people. Text, media, and translations are cleared. Human DMs dual-write the tombstone to `savigna_messages.deleted_at`.

Merging local + cloud copies prefers the tombstone so a leftover full copy cannot restore the text.

Bot messages and the other person’s messages only offer **Delete for me**.
