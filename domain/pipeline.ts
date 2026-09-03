/**
 * AI translation pipeline domain (operations only — no I/O).
 * Stories: detect-first prompts, asymmetric learner langs, history + mode TDD.
 */

import type { DisplayMode, LanguageCode, LineTranslation, SourceMessage } from './chat';
import { LEARNING_BOT_DISPLAY_NAME, splitSourceLines } from './chat';

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
    translateInto: input.asymmetric.receiverLearningLang,
  };
}

/**
 * Prompt architecture: identify source language BEFORE generating translation.
 * Few-shot includes asymmetric targets so the model never assumes one shared L2.
 */
export function buildDetectThenTranslatePrompt(payload: TranslationLlmPayload): {
  systemPrompt: string;
  userPrompt: string;
} {
  const { asymmetric, mode, translateInto, text } = payload;
  const systemPrompt = [
    'You are SavignaLearn’s translation engine.',
    'STEP 1 (mandatory): Identify the ISO 639-1 source language of the user text. Never skip detection.',
    'STEP 2: Translate into the receiver’s learning language only after detection.',
    `Sender learning language: ${asymmetric.senderLearningLang}.`,
    `Receiver learning language: ${asymmetric.receiverLearningLang} (PRIMARY translate-into target).`,
    `Sender native: ${asymmetric.senderNativeLang}. Receiver native: ${asymmetric.receiverNativeLang}.`,
    mode === 'birkenbihl'
      ? 'Mode Birkenbihl: output interlinear "original [short hint in translate-into language]" per phrase. Preserve line breaks.'
      : 'Mode Standard (lines): output one translated line per input line. Preserve line breaks. No commentary.',
    'Return JSON only: {"detected_source_lang":"xx","translation":"..."}',
  ].join(' ');

  const userPrompt = [
    `translate_into: ${translateInto}`,
    `mode: ${mode}`,
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
}): { systemPrompt: string; userPrompt: string } {
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
    'learning',
    learningLang,
    learningLang.toUpperCase(),
  ]);
  const native = pickString(parsed, [
    'native_text',
    'native',
    nativeLang,
    nativeLang.toUpperCase(),
  ]);
  if (!learning || !native) return null;
  const detected = pickString(parsed, ['detected_source_lang', 'source_lang']);
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
      'translation',
      'content',
      'reply',
      'message',
      'text',
      'native_text',
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
  | { type: 'switch_mode'; mode: TranslationMode };

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
      translations: [],
      detectedSourceLang: undefined,
      providerUsed: undefined,
      lastError: undefined,
      pipelineState: 'draft',
      updatedAt,
    };
  }

  switch (record.pipelineState) {
    case 'draft':
      if (event.type === 'start_detect') {
        return { ...record, pipelineState: 'detecting', updatedAt, lastError: undefined };
      }
      break;
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
      if (event.type === 'fail') {
        return { ...record, pipelineState: 'failed', lastError: event.error, updatedAt };
      }
      break;
    case 'failed':
      if (event.type === 'start_detect') {
        return {
          ...record,
          pipelineState: 'detecting',
          lastError: undefined,
          updatedAt,
        };
      }
      break;
    case 'persisted':
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
