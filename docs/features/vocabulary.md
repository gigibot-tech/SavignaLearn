# Vocabulary

Tap a chat token to open a **create voc card** modal over the thread (not a Gigolingo media screen). Chat still only calls `WordTapPort`; card generation and storage stay in adapters.

## Gigolingo seam (`gigolingo-shared/`)

There is no installable Gigolingo package in this monorepo, so the I/O-free modules are copied (not rewritten) from GigolingoConcept:

| SavignaLearn module | Gigolingo source | What we import |
|---|---|---|
| `gigolingo-shared/vocabularyTapState.ts` | `features/media/media-detail/state/vocabularyTapState.ts` | `normalizeVocabularyTapKey`, tap-state helpers |
| `gigolingo-shared/vocabularyPrompts.ts` | `services/ai/prompts/vocabularyPrompts.ts` | `getVocabularyCardPrompt`, `buildPromptString` |
| `gigolingo-shared/languages.ts` | `config/languages.ts` | `getLanguageName`, `needsReadingAttribute`, `inferVocabLanguageFromWord` (media detectors omitted) |

`adapters/chat.ts` `vocabularyCardPrompt` delegates to `getVocabularyCardPrompt`. `ChatCompletionVocabularyCardAdapter` sends that prompt and parses the JSON the same way Gigolingo’s `OpenAIService.parseVocabularyCardResponse` does (`extractJsonObject` + drop `reading` for Latin scripts).

Card **language follows the tapped token script**, not only the bubble lang tag. Hiragana/katakana (and kanji on a Latin-tagged line) resolve to `ja` so Gigolingo’s prompt asks for **hiragana/katakana `reading`**. If the model omits reading, save the word as reading (same fallback as Gigolingo `VocabularyStorageService`). Mixed sentences (Japanese word in a German/English line) keep `sentenceOrig` as context and do not store a fake `sentenceReading` of the non-Japanese sentence.

Do not import Gigolingo `features/media` screens into `features/chat`.

## Flow

1. Tokenizer on the bubble (`Pressable` tokens) → `wordTap.onPress({ token, sentence, language, source })`.
2. `features/vocabulary/CreateVocabCardModal` opens over the thread with Gigolingo card fields: **word, sentence, language, source** (chat conversation / message / line), plus translation, sentence EN, reading, CEFR, frequency, **card id**.
3. `createVocabularyWordTap` → `openOrCreateVocabularyCard`:
   - Resolve language from the **token script** (`inferVocabLanguageFromWord`) so Japanese tipped on an EN/DE line is still `ja`.
   - Lookup `LearningItemRepository.findByIdentity(userId, word, language, source)` using domain `learningItemIdentityKey` (Gigolingo `normalizeVocabularyTapKey` + lang + `learningSourceKey`).
   - If a row exists, **refetch** it with `findById` (same id, no second insert).
   - Else `VocabularyCardPort.generateVocabularyCard` with Gigolingo’s JA prompt (hiragana `reading`) then `save`.
4. Persist target remains `savigna_learning_items` via `LearningItemRepository` (in-memory for this session). History source kind stays `chat` on `LearningSource` (bubble UI unchanged).

Same word + language + chat line → same card. Different line or language → a new card.

## Chats home (tipped cards)

Desktop **Pick a chat**, mobile **ChatsEmptyHome**, and the **inbox list** (chats home when you already have threads) all render `TippedVocabHome`:

- Horizontal carousel of tipped/created cards (`TippedVocabRail`), newest first — same compact chip idea as Gigolingo `VocabularyBox`.
- Empty: a short **Tip a word in chat** line; it does not replace the Slay gif / SavignasBoi block.
- Tap a chip → `useVocabCardFromTap.openSavedCard` → **same** `CreateVocabCardModal` as a chat word tap, refetching via `findById` (no duplicate row).

Do not import Gigolingo screens into `features/chat`. The home rail lives in `features/vocabulary/vocabularyUi.tsx`; `ChatsEmptyHome` only takes an optional `vocabRail` slot.

## Ports

- `VocabularyCardPort.generateVocabularyCard(word, sentence, language?)` — `ChatCompletionVocabularyCardAdapter` (Gigolingo prompt) with `FakeVocabularyCardAdapter` fallback.
- `WordTapPort` on `MessageLines` tokens — wired in `ThreadScreen` via `useVocabCardFromTap`.
- `LearningItemRepository.findByIdentity` / `findById` — idempotent refetch.
