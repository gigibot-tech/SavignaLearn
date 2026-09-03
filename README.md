# SavignaLearn

Bilingual learning chat: send in your language, read line-by-line (or Birkenbihl) in theirs.

## Stack

- Expo Router (iOS / Android / web PWA)
- Domain-first Clean Code (Vitest)
- ido-core Supabase Auth + `savigna_*` tables
- Translation: on-prem TranslateGemma first, then cloud sendable
- Ports ready for Gigolingo vocabulary / media / word-tap later

## Setup

```bash
cp .env.example .env
# fill EXPO_PUBLIC_SUPABASE_* from ido-core
npm install
npm test
npm run web
```

## Layout

| Path | Role |
|------|------|
| `domain/` | Pure chat + learning models (no React) |
| `ports/` | ISP ports |
| `adapters/` | Supabase, translation, chat repo, AI |
| `features/chat/` | Inbox, thread, composer UI |
| `docs/architecture/gigolingo-seams.md` | How Gigolingo plugs in |
| `.cursor/skills/` | Clean-code gate after each subtask |

Theme: ember / peach dawn gradients (`constants/Colors.ts`) — fourSome warm reds + Gigolingo full-bleed shell.
