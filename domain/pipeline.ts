/**
 * AI translation pipeline domain (operations only — no I/O).
 * Stories: detect-first prompts, asymmetric learner langs, history + mode TDD.
 */

import type { DisplayMode, LanguageCode, LineTranslation, SourceMessage } from './chat';
import { LEARNING_BOT_DISPLAY_NAME, splitSourceLines } from './chat';
import { isUsableBirkenbihlOverlay } from './text';

export type { TranslationMismatchReason } from './chat';

/** Story alias: Standard = lines mode. */
export type TranslationMode = 'standard' | 'birkenbihl';

export function toDisplayMode(mode: TranslationMode): DisplayMode {
  return mode === 'birkenbihl' ? 'birkenbihl' : 'lines';
}

export function toTranslationMode(mode: DisplayMode): TranslationMode {
  return mode === 'birkenbihl' ? 'birkenbihl' : 'standard';
}

/** Both users' learning targets — asymmetric language learning payload. */
export interface AsymmetricLanguageContext {
  senderUserId: string;
  receiverUserId: string;
  senderLearningLang: LanguageCode;
  receiverLearningLang: LanguageCode;
  senderNativeLang: LanguageCode;
  receiverNativeLang: LanguageCode;
}

/**
 * Payload forced into every LLM translation call.
 * Acceptance: includes both users' target (learning) languages.
 */
export interface TranslationLlmPayload {
  text: string;
  mode: TranslationMode;
  /** Must be identified by the model before translating (prompt contract). */
  detectSourceFirst: true;
  asymmetric: AsymmetricLanguageContext;
  /** Primary target for this request = receiver's learning language. */
  translateInto: LanguageCode;
}

export function buildTranslationPayload(input: {
  text: string;
  mode: TranslationMode | DisplayMode;
  asymmetric: AsymmetricLanguageContext;
  /** Override primary target (Birkenbihl hints use native, not L2). */
  translateInto?: LanguageCode;
}): TranslationLlmPayload {
  const mode: TranslationMode =
    input.mode === 'birkenbihl' || input.mode === 'standard'
      ? input.mode
      : toTranslationMode(input.mode);
  return {
    text: input.text,
    mode,
    detectSourceFirst: true,
    asymmetric: input.asymmetric,
    translateInto: input.translateInto ?? input.asymmetric.receiverLearningLang,
  };
}

/**
 * Dedicated Birkenbihl prompt: interlinear original [hint] per phrase.
 * Do not reuse Standard/lines output or a local word-split heuristic.
 */
export function buildBirkenbihlTranslatePrompt(payload: TranslationLlmPayload): {
  systemPrompt: string;
  userPrompt: string;
} {
  const { asymmetric, translateInto, text } = payload;
  const learningLang = asymmetric.receiverLearningLang;
  const systemPrompt = [
    'You are SavignaLearn’s Birkenbihl decoding engine.',
    'STEP 1 (mandatory): Identify the ISO 639-1 source language of the user text. Never skip detection.',
    'STEP 2: Produce an interlinear decoding — not a prose translation, not a bilingual lines pair.',
    `Learner target (learning) language: ${learningLang}. Original tokens MUST be in ${learningLang}.`,
    `Hint language: ${translateInto}. Each original token is followed by a short [hint] in ${translateInto} (square brackets).`,
    `Sender learning language: ${asymmetric.senderLearningLang}. Receiver learning language: ${asymmetric.receiverLearningLang}.`,
    `Sender native: ${asymmetric.senderNativeLang}. Receiver native: ${asymmetric.receiverNativeLang}.`,
    'Mode Birkenbihl: one output line per input line. Example: "Hola [Hi] mundo [world]".',
    'If the source is already in the learning language, gloss it. If not, first express it in the learning language, then gloss.',
    'Do not invent alignment by splitting an existing bilingual pair word-by-word. Do not return a separate prose translation.',
    'Return JSON only: {"detected_source_lang":"xx","translation":"<interlinear lines>"}',
  ].join(' ');

  const userPrompt = [
    `translate_into: ${translateInto}`,
    `hint_lang: ${translateInto}`,
    `learning_lang: ${learningLang}`,
    `mode: birkenbihl`,
    `detect_source_first: true`,
    `sender_learning_lang: ${asymmetric.senderLearningLang}`,
    `receiver_learning_lang: ${asymmetric.receiverLearningLang}`,
    'text:',
    text,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

/**
 * Prompt architecture: identify source language BEFORE generating translation.
 * Few-shot includes asymmetric targets so the model never assumes one shared L2.
 */
export function buildDetectThenTranslatePrompt(payload: TranslationLlmPayload): {
  systemPrompt: string;
  userPrompt: string;
} {
  if (payload.mode === 'birkenbihl') {
    return buildBirkenbihlTranslatePrompt(payload);
  }
  const { asymmetric, translateInto, text } = payload;
  const systemPrompt = [
    'You are SavignaLearn’s translation engine.',
    'STEP 1 (mandatory): Identify the ISO 639-1 source language of the user text. Never skip detection.',
    'STEP 2: Translate into the receiver’s learning language only after detection.',
    `Sender learning language: ${asymmetric.senderLearningLang}.`,
    `Receiver learning language: ${asymmetric.receiverLearningLang} (PRIMARY translate-into target).`,
    `Sender native: ${asymmetric.senderNativeLang}. Receiver native: ${asymmetric.receiverNativeLang}.`,
    'Mode Standard (lines): output one translated line per input line. Preserve line breaks. No commentary.',
    'Return JSON only: {"detected_source_lang":"xx","translation":"..."}',
  ].join(' ');

  const userPrompt = [
    `translate_into: ${translateInto}`,
    `mode: standard`,
    `detect_source_first: true`,
    `sender_learning_lang: ${asymmetric.senderLearningLang}`,
    `receiver_learning_lang: ${asymmetric.receiverLearningLang}`,
    'text:',
    text,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asNonEmptyString(obj[key]);
    if (value) return value;
  }
  return undefined;
}

/** Pull the first JSON object out of a model reply (prose fences allowed). */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseDetectThenTranslateJson(raw: string): {
  detectedSourceLang: LanguageCode;
  translation: string;
} {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    throw new Error('LLM response missing JSON object');
  }
  const detected = pickString(parsed, [
    'detected_source_lang',
    'source_lang',
    'detected_lang',
    'lang',
  ]);
  const translation = pickString(parsed, [
    'translation',
    'text',
    'translated',
    'translated_text',
  ]);
  if (!detected || !translation) {
    throw new Error('LLM JSON missing detected_source_lang or translation');
  }
  return {
    detectedSourceLang: detected.toLowerCase(),
    translation,
  };
}

export type BilingualChatReply = {
  learningText: string;
  nativeText: string;
  detectedSourceLang?: LanguageCode;
};

/**
 * SavignasBoi chat contract: one JSON object with both learner-facing lines.
 * The UI never renders this JSON — `MessageBubble` shows DE/EN from LineTranslations.
 */
export function buildBilingualChatPrompt(input: {
  learningLang: LanguageCode;
  nativeLang: LanguageCode;
  learnerText: string;
  /** Fill a bilingual pair for an existing bubble instead of writing a new reply. */
  pairExisting?: boolean;
}): { systemPrompt: string; userPrompt: string } {
  if (input.pairExisting) {
    const systemPrompt = [
      'You are SavignaLearn’s bilingual pair engine.',
      `Express this EXISTING chat message in ${input.learningLang} (learning_text) and ${input.nativeLang} (native_text).`,
      'Do not write a new conversational reply. Do not change the meaning. Do not invent extra lines.',
      'Return JSON only, no markdown:',
      '{"learning_text":"...","native_text":"...","detected_source_lang":"xx"}',
      `learning_text MUST be in ${input.learningLang} and MUST differ from native_text when the languages differ.`,
      `native_text MUST be in ${input.nativeLang} and must not copy learning_text unless the languages are the same.`,
      'detected_source_lang is the ISO 639-1 code of the original message.',
    ].join(' ');
    const userPrompt = [
      `learning_lang: ${input.learningLang}`,
      `native_lang: ${input.nativeLang}`,
      'existing_message:',
      input.learnerText,
    ].join('\n');
    return { systemPrompt, userPrompt };
  }

  const systemPrompt = [
    `You are ${LEARNING_BOT_DISPLAY_NAME}, a friendly language learning partner.`,
    `Write a short 1-3 line reply in ${input.learningLang} (the learner’s target language).`,
    `Also provide the same meaning in ${input.nativeLang} (the learner’s native language).`,
    'Return JSON only, no markdown:',
    '{"learning_text":"...","native_text":"...","detected_source_lang":"xx"}',
    `learning_text MUST be in ${input.learningLang}.`,
    `native_text MUST be in ${input.nativeLang} and must not copy learning_text unless the languages are the same.`,
    'detected_source_lang is the ISO 639-1 code of learning_text.',
  ].join(' ');

  const userPrompt = [
    `learning_lang: ${input.learningLang}`,
    `native_lang: ${input.nativeLang}`,
    'learner_message:',
    input.learnerText,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

export function parseBilingualChatJson(
  raw: string,
  learningLang: LanguageCode,
  nativeLang: LanguageCode
): BilingualChatReply | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;
  const learning = pickString(parsed, [
    'learning_text',
    'learningText',
    'learning',
    learningLang,
    learningLang.toUpperCase(),
  ]);
  const native = pickString(parsed, [
    'native_text',
    'nativeText',
    'native',
    nativeLang,
    nativeLang.toUpperCase(),
  ]);
  if (!learning || !native) return null;
  if (
    learningLang.toLowerCase() !== nativeLang.toLowerCase() &&
    learning.trim().toLowerCase() === native.trim().toLowerCase()
  ) {
    return null;
  }
  const detected = pickString(parsed, [
    'detected_source_lang',
    'detectedSourceLang',
    'source_lang',
    'sourceLang',
  ]);
  return {
    learningText: learning,
    nativeText: native,
    detectedSourceLang: detected?.toLowerCase(),
  };
}

/** If JSON mode leaked into the bubble, prefer a string field over the raw object. */
export function extractChatReplyText(raw: string): string {
  const parsed = extractJsonObject(raw);
  if (!parsed) return raw.trim();
  return (
    pickString(parsed, [
      'learning_text',
      'learningText',
      'translation',
      'content',
      'reply',
      'message',
      'text',
      'native_text',
      'nativeText',
    ]) ?? raw.trim()
  );
}

export function lineTranslationsFromBilingual(input: {
  learningLang: LanguageCode;
  nativeLang: LanguageCode;
  learningText: string;
  nativeText: string;
}): LineTranslation[] {
  const learningLines = splitSourceLines(input.learningText);
  const nativeLines = splitTranslationIntoLines(input.learningText, input.nativeText);
  return [
    ...learningLines.map((text, lineIndex) => ({
      lineIndex,
      targetLang: input.learningLang,
      mode: 'lines' as const,
      text,
    })),
    ...nativeLines.map((text, lineIndex) => ({
      lineIndex,
      targetLang: input.nativeLang,
      mode: 'lines' as const,
      text,
    })),
  ];
}

export type PipelineProvider = 'onprem' | 'cloud' | 'echo';

export type ChatHistoryPipelineState =
  | 'draft'
  | 'detecting'
  | 'translating'
  | 'persisted'
  | 'failed';

export type ChatHistoryPipelineEvent =
  | { type: 'start_detect' }
  | { type: 'start_translate'; detectedSourceLang: LanguageCode }
  | { type: 'persist'; translations: LineTranslation[]; providerUsed: PipelineProvider }
  | { type: 'fail'; error: string }
  | { type: 'switch_mode'; mode: TranslationMode }
  | { type: 'recalculate_birkenbihl' }
  | { type: 'persist_birkenbihl'; translations: LineTranslation[]; providerUsed: PipelineProvider };

/** Replace one display mode’s rows; leave the other mode’s translations untouched. */
export function mergeTranslationsByMode(
  existing: LineTranslation[],
  incoming: LineTranslation[],
  replaceMode: DisplayMode
): LineTranslation[] {
  return [
    ...existing.filter((row) => row.mode !== replaceMode),
    ...incoming.filter((row) => row.mode === replaceMode),
  ];
}

function translationRowKey(row: LineTranslation): string {
  return `${row.lineIndex}:${row.targetLang.toLowerCase()}:${row.mode}`;
}

/**
 * Union by line/lang/mode. Incoming nonempty rows update; empty incoming never
 * wipes a stored nonempty native/`lines` row; keys only in `existing` stay.
 */
export function mergeLineTranslations(
  existing: LineTranslation[],
  incoming: LineTranslation[]
): LineTranslation[] {
  const byKey = new Map(existing.map((row) => [translationRowKey(row), row] as const));
  for (const row of incoming) {
    const key = translationRowKey(row);
    const current = byKey.get(key);
    if (!current || row.text.trim().length > 0) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

/** Drop Standard rows that just copy source into the source language (false L2 “translations”). */
export function dropIdentityLineTranslations(
  translations: readonly LineTranslation[],
  sourceText: string,
  sourceLang: LanguageCode
): LineTranslation[] {
  const src = sourceText.trim();
  const lang = sourceLang.toLowerCase();
  if (!src || !lang) return [...translations];
  return translations.filter((row) => {
    if (row.mode !== 'lines') return true;
    if (row.targetLang.toLowerCase() !== lang) return true;
    return row.text.trim() !== src;
  });
}

export function mergeTranslationMaps(
  existing: Record<string, LineTranslation[]>,
  incoming: Record<string, LineTranslation[]>
): Record<string, LineTranslation[]> {
  const out: Record<string, LineTranslation[]> = { ...existing };
  for (const [id, rows] of Object.entries(incoming)) {
    out[id] = mergeLineTranslations(existing[id] ?? [], rows);
  }
  return out;
}

export function hasBirkenbihlTranslation(translations: LineTranslation[]): boolean {
  return translations.some((row) => row.mode === 'birkenbihl' && isUsableBirkenbihlOverlay(row.text));
}

/**
 * Testable chat-history object: message + translation mode + pipeline state.
 * Mockable before any Supabase integration.
 */
export interface ChatHistoryRecord {
  id: string;
  conversationId: string;
  message: SourceMessage;
  translationMode: TranslationMode;
  detectedSourceLang?: LanguageCode;
  translations: LineTranslation[];
  pipelineState: ChatHistoryPipelineState;
  providerUsed?: PipelineProvider;
  lastError?: string;
  updatedAt: string;
}

export function createChatHistoryRecord(input: {
  message: SourceMessage;
  translationMode: TranslationMode;
}): ChatHistoryRecord {
  return {
    id: input.message.id,
    conversationId: input.message.conversationId,
    message: input.message,
    translationMode: input.translationMode,
    translations: [],
    pipelineState: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

export function transitionChatHistory(
  record: ChatHistoryRecord,
  event: ChatHistoryPipelineEvent
): ChatHistoryRecord {
  const updatedAt = new Date().toISOString();

  if (event.type === 'switch_mode') {
    if (record.pipelineState === 'detecting' || record.pipelineState === 'translating') {
      throw new Error(`Cannot switch mode while ${record.pipelineState}`);
    }
    return {
      ...record,
      translationMode: event.mode,
      lastError: undefined,
      updatedAt,
    };
  }

  if (event.type === 'recalculate_birkenbihl') {
    if (record.pipelineState === 'detecting' || record.pipelineState === 'translating') {
      throw new Error(`Cannot recalculate Birkenbihl while ${record.pipelineState}`);
    }
    return {
      ...record,
      translationMode: 'birkenbihl',
      pipelineState: 'translating',
      lastError: undefined,
      updatedAt,
    };
  }

  /** Bubble Retry: re-enter detect from persisted/failed (and restart an in-flight run). */
  if (event.type === 'start_detect') {
    return { ...record, pipelineState: 'detecting', lastError: undefined, updatedAt };
  }

  switch (record.pipelineState) {
    case 'detecting':
      if (event.type === 'start_translate') {
        return {
          ...record,
          pipelineState: 'translating',
          detectedSourceLang: event.detectedSourceLang,
          updatedAt,
        };
      }
      if (event.type === 'fail') {
        return { ...record, pipelineState: 'failed', lastError: event.error, updatedAt };
      }
      break;
    case 'translating':
      if (event.type === 'persist') {
        return {
          ...record,
          pipelineState: 'persisted',
          translations: event.translations,
          providerUsed: event.providerUsed,
          updatedAt,
          lastError: undefined,
        };
      }
      if (event.type === 'persist_birkenbihl') {
        return {
          ...record,
          pipelineState: 'persisted',
          translationMode: 'birkenbihl',
          translations: mergeTranslationsByMode(record.translations, event.translations, 'birkenbihl'),
          providerUsed: event.providerUsed,
          updatedAt,
          lastError: undefined,
        };
      }
      if (event.type === 'fail') {
        return { ...record, pipelineState: 'failed', lastError: event.error, updatedAt };
      }
      break;
  }

  throw new Error(`Invalid transition ${record.pipelineState} + ${event.type}`);
}

export function splitTranslationIntoLines(
  sourceText: string,
  translationBlock: string
): string[] {
  const sourceLines = splitSourceLines(sourceText);
  const translatedLines = splitSourceLines(translationBlock);
  if (translatedLines.length === sourceLines.length) return translatedLines;
  if (sourceLines.length === 1) return [translationBlock.trim()];
  // Pad / truncate to keep line indices stable for viewers.
  return sourceLines.map((_, i) => translatedLines[i] ?? translatedLines.join(' ') ?? '');
}

export interface ChatHistoryStore {
  save(record: ChatHistoryRecord): Promise<ChatHistoryRecord>;
  get(id: string): Promise<ChatHistoryRecord | null>;
  listByConversation(conversationId: string): Promise<ChatHistoryRecord[]>;
}
