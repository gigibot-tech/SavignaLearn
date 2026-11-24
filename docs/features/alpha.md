# Alpha notice

SavignaLearn is in **alpha**. Every learner sees the same warning on **sign-in** and in **Settings**. It is deliberately *not* on chats home, so the first screen is all conversations.

## Copy (SSOT)

`features/alpha/alphaCopy.ts` owns the label and body. Do not duplicate the screenshot wording in screens.

## UI

`AlphaNotice` (`features/alpha/AlphaNotice.tsx`) is the reusable banner. Pass theme `colors`; `compact` is available for tight spaces.

It is not dismissible. Texts and chats may not last — screenshot what you want to keep.
