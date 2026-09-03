# Gigolingo seams (do not import `features/media` into chat)

SavignaLearn inverts Gigolingo’s foundation leak: **learning types live in `domain/`**. Chat and future media both depend inward.

## Port map

| Port | MVP | Later Gigolingo |
|------|-----|-----------------|
| `TokenizerPort` | `defaultTokenizer` in `adapters/chat.ts` | ShieldLine tokenization rules |
| `WordTapPort` | `createVocabularyWordTap` + create-card modal over the thread | pending_orange / confirmed_green colors |
| `VocabularyCardPort` | `ChatCompletionVocabularyCardAdapter` (`getVocabularyCardPrompt`) | Llama / on-device |
| `LearningItemRepository` | in-memory, identity upsert + `findById` refetch | `savigna_learning_items` + SRS |
| `MediaCatalogPort` | `emptyMediaCatalog` | library / shield media |
| `VocabularyDisplayPort` | (unused) | clicked / learned / colors |
| `TranslationEngine` | echo or on-prem Gemma | same for media lines |
| `ChatCompletionPort` | scripted / HTTP | fourSome UnifiedAI / OpenAI edge |

## Field compatibility

- `LearningItem` mirrors Gigolingo `Word` field names; use `source: LearningSource`, never put `sourceMediaId` on chat messages.
- `toMediaBlock` / `fromMediaBlock` in `domain/learning.ts` map chat lines ↔ Gigolingo `Block`/`Line`.

## Gate question

After each subtask: can vocab / media / tap / card gen attach by adding an adapter or feature folder **without editing this chat UI file**?
