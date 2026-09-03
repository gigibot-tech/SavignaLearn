# Alpha notice

SavignaLearn is in **alpha**. Every learner sees the same warning on **sign-in** and on **chats home** (empty home, inbox list, and desktop “Pick a chat”).

## Copy (SSOT)

`features/alpha/alphaCopy.ts` owns the label and body. Do not duplicate the screenshot wording in screens.

## UI

`AlphaNotice` (`features/alpha/AlphaNotice.tsx`) is the reusable banner. Pass theme `colors`; use `compact` on the inbox list.

It is not dismissible. Texts and chats may not last — screenshot what you want to keep.
