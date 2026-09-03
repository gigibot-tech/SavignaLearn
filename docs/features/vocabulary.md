# Vocabulary (planned)

Reuse Gigolingo `Word` / card generation / tap cycle behind existing ports:

- `VocabularyCardPort.generateVocabularyCard(word, sentence, language?)`
- `WordTapPort` on `MessageLines` tokens
- Persist to `savigna_learning_items` via `LearningItemRepository`
- History source kind: add `savigna_chat` without changing bubble UI

Do not import Gigolingo screens into `features/chat`.
