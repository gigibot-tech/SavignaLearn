# AI Pipeline & Architecture

Acceptance criteria for the translation epic.

## Detect → translate (asymmetric)

- `buildDetectThenTranslatePrompt` forces **STEP 1: identify source language** before translation.
- `TranslationLlmPayload` / `AsymmetricLanguageContext` always include **both** users’ learning languages; primary `translateInto` is the **receiver’s** learning language.
- Outbound send uses `processOutgoingTranslation` (see `ChatScreens` thread send).
- SavignasBoi replies use **JSON mode**: `{"learning_text","native_text","detected_source_lang"}` via `completeBilingualBotReply` (`json: true`, iDO feature `savigna-chat`). The bubble never shows that JSON — `MessageBubble` renders learning + native lines from `LineTranslation`s.
- Learner outgoing `sourceLang` is always **I speak** (`nativeLang`). Do not detect-then-retag a user send as the learning language, even if the sentence contains an L2 word. Own-bubble primary tag is I speak; primary text is `sourceText`.
- `parseBilingualChatJson` fails closed when `learning_text` equals `native_text` and the langs differ. `load` / subscribe merge via `mergeLineTranslations` so a later incomplete snapshot cannot drop a stored `mode: 'lines'` native row.
- Cloud translation (`CloudLlmTranslationEngine`) also requests JSON (`savigna-translate` / OpenAI `response_format: json_object`). iDO `generic` stays prose; `body.json: true` or the Savigna features enable `json_object` on `ai-assist`.

## On-prem primary + cloud circuit breaker

- Primary: `OnPremTranslateGemmaAdapter` when `EXPO_PUBLIC_TRANSLATEGEMMA_URL` is set.
- Fallback: `CloudLlmTranslationEngine` (OpenAI / fourSome / iDO `ChatCompletionPort`) then echo demo.
- `CircuitBreakerTranslationEngine` times out the primary and reroutes without failing the UX when a secondary engine succeeds.

## Switchable chat backends

Pick **fourSome / On-prem / OpenAI / iDO / Demo** in **this chat** (header sliders on compact screens; inline chips at **≥1024px**) or the app **Settings** tab (`EXPO_PUBLIC_AI_BACKEND`, persisted as `savigna.aiBackend.v2`). Each backend is one selectable tile with its live status; Server and WebGPU stay in a compact strip, not a second list. The Settings tab remains the full page (account, connection panel, sign-out). The thread header only shows the chat-scoped subset.

| Backend | What it is |
| --- | --- |
| **fourSome** | Same cascade as fourSome `gigi_engine`: **on-prem (vLLM / OpenAI-compatible) first**, then **OpenAI**. Requires a **fourSome sign-in** (not a pasted UUID). Optional GiGi WebSocket uses that session’s user id. |
| **On-prem** | Local OpenAI-compatible server only (`EXPO_PUBLIC_ONPREM_CHAT_URL`, e.g. `http://127.0.0.1:8000/v1` or Ollama `http://127.0.0.1:11434/v1`). |
| **OpenAI** | Cloud GPT via Expo `/api/openai/chat`. Needs a valid **server** key. On Netlify that route is the Expo **server function**, not a static file — see `docs/setup/netlify.md`. |
| **iDO** | ido-core Edge Function `ai-assist`. Requires an **iDO sign-in**. |
| **Demo** | Scripted replies. |

Dead backends are disabled. After connection tests, the app **auto-selects the first working non-demo backend** (On-prem → OpenAI → iDO → fourSome) and only stays on Demo when nothing else is up. iDO is probed against `ai-assist` (not just Auth health). OpenAI is probed with `GET /v1/models` (not `/api/openai/chat`). Zotero `runtime.lastError` is a browser extension, not these probes.

## WebGPU Gemma

`EXPO_PUBLIC_ENABLE_WEB_GEMMA=true` loads `onnx-community/gemma-3-270m-it-ONNX` in the browser (WebGPU, q4/fp16/fp32). It preloads after sign-in and never blocks send: if the model is not ready, translation falls through the circuit breaker and chat stays on the next backend. Once ready it counts as **On-prem** for the connection chips. Requires a desktop browser with WebGPU (Chrome/Edge; Safari if WebGPU is on).

## Chat history + modes (TDD)

- `ChatHistoryRecord` encapsulates message, Standard vs Birkenbihl mode, pipeline state, provider used.
- State machine: `draft → detecting → translating → persisted` (or `failed`); mode switch only from idle states.
- **Mode switch persistence:** `switch_mode` changes `translationMode` but **does not clear** stored translations. Standard `mode: 'lines'` rows stay when you leave and return. Source `sourceText` is never rewritten.
- **Birkenbihl is a different prompt** (`buildBirkenbihlTranslatePrompt`): interlinear `original [hint]` per phrase in JSON. Do not reuse Standard bilingual lines as if they were Birkenbihl. Do not synthesize overlays with `createInterlinear` / word-split heuristics.
- **Render:** `renderViewpoint` shows a Birkenbihl overlay only when a stored `mode: 'birkenbihl'` `LineTranslation` is real interlinear (`isUsableBirkenbihlOverlay`). Same-string / same-lang pairs are a parse failure (Retry), not two painted languages. If none, the bubble shows the original line only (no fake under-words). Empty overlay is OK; heuristic pairing / `createInterlinear` is not.
- **Recalc:** `recalculate_birkenbihl` → `persist_birkenbihl` refreshes only Birkenbihl rows. `recalculateBirkenbihlForMessage` / `recalculateBirkenbihlForThread` call the engine with mode `birkenbihl`. Skip empty/media source. Per-message errors must not fail the thread. UI: **Recalculate Birkenbihl** plus auto-fill for messages that still have no Birkenbihl row.
- `InMemoryChatHistoryStore` is the mockable persistence seam — unit tests cover transitions **before** Supabase wiring.
- Durable chat rows: iDO `savigna_*` via `ChatContentCipher` (plaintext v0). See `chat-persistence.md`.
- Tests: `domain/pipeline.test.ts`, `domain/domain.test.ts`, `adapters/aiBackend.test.ts`.

## Bubble Retry (mismatch / empty pair)

`translationMismatch` compares stored JSON/`lines` rows to the viewer’s **I speak** + **Learning** settings. It does **not** guess language from the text.

Retry is shown **on the bubble** (own and theirs; never stickers/images) when:

| Reason | What you see |
| --- | --- |
| `empty_pair` / `missing_learning` | Tag would be ES but only source (e.g. German) is stored |
| `missing_native` | Native line is missing and native ≠ source |
| `same_as_source` | Stored learning/native row copies `sourceText` while target langs differ |
| `missing_birkenbihl` | Birkenbihl mode with no stored `mode: 'birkenbihl'` row (empty under-line + Retry) |

Tapping **Retry** runs `retryBubbleTranslations` for **that message only**:

- Standard user/partner: `processOutgoingTranslation` (bilingual JSON / detect-then-translate). Merges `lines` rows; leaves Birkenbihl rows and **does not rewrite `sourceText`**.
- SavignasBoi: `completeBilingualBotReply({ pairExisting: true })` (JSON `learning_text` + `native_text` of the existing bubble, not a new reply). Fallback: `processOutgoingTranslation`.
- Birkenbihl mode: `recalculateBirkenbihlForMessage` (dedicated interlinear prompt).

Then `saveTranslations` + the bubble refreshes. If the pair is still empty or copies source, Retry stays. Source stays visible. Missing learning translation uses the **source lang tag** (DE), never a fake ES label over German.
