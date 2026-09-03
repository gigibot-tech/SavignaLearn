/**
 * AI Pipeline & Architecture — adapters + orchestration.
 * Primary: on-prem TranslateGemma. Fallback: cloud (OpenAI / fourSome) via circuit breaker.
 * Prompt contract: detect source language before translate; payload includes both L2s.
 */

import {
  assembleLineTranslations,
  planLineJobs,
  shouldTranslateMessage,
  splitSourceLines,
  type DisplayMode,
  type LanguageCode,
  type LineTranslation,
  type SourceMessage,
} from '@/domain/chat';
import {
  buildBirkenbihlTranslatePrompt,
  buildBilingualChatPrompt,
  buildDetectThenTranslatePrompt,
  buildTranslationPayload,
  createChatHistoryRecord,
  extractChatReplyText,
  hasBirkenbihlTranslation,
  lineTranslationsFromBilingual,
  mergeLineTranslations,
  mergeTranslationsByMode,
  parseBilingualChatJson,
  parseDetectThenTranslateJson,
  splitTranslationIntoLines,
  toDisplayMode,
  toTranslationMode,
  transitionChatHistory,
  type AsymmetricLanguageContext,
  type ChatHistoryRecord,
  type ChatHistoryStore,
  type PipelineProvider,
  type TranslationMismatchReason,
  type TranslationMode,
} from '@/domain/pipeline';
import { hasWebGpu, isWebGemmaEnabled, runWebGemmaInWorker, getWebGemmaStatus } from '@/adapters/webGemma';
import {
  historyStorageKey,
  parseHistorySnapshot,
  type ChatKv,
} from '@/adapters/chatPersistence';
import { isUsableBirkenbihlOverlay } from '@/domain/text';
import type { ChatCompletionPort, TranslationEngine } from '@/ports/ports';

/** Integration: calls engine. Operations stay in domain (IOSP). */
export async function translateMessageForViewer(input: {
  sourceText: string;
  sourceLang?: string;
  targetLang: string;
  mode: DisplayMode;
  engine: TranslationEngine;
  asymmetric?: AsymmetricLanguageContext;
}): Promise<LineTranslation[]> {
  const lines = splitSourceLines(input.sourceText);
  const detected = input.sourceLang ?? (await input.engine.detectLanguage(input.sourceText));
  const jobs = planLineJobs(input.sourceText, input.targetLang, input.mode);
  const translated: string[] = [];
  for (const job of jobs) {
    translated.push(
      await input.engine.translateLine({
        text: job.text,
        sourceLang: detected,
        targetLang: job.targetLang,
        mode: job.mode,
        asymmetric: input.asymmetric,
      })
    );
  }
  return assembleLineTranslations(
    lines,
    translated,
    input.targetLang,
    input.mode
  );
}

const COMMON: Record<string, string> = {
  hallo: 'hello',
  guten: 'good',
  morgen: 'morning',
  danke: 'thank you',
  bitte: 'please',
  welt: 'world',
  hello: 'こんにちは',
  hi: 'やあ',
  test: 'テスト',
  thanks: 'danke',
  wie: 'how',
  geht: 'goes',
  es: 'it',
  dir: 'you',
};

const TARGET_GLOSS: Record<string, Record<string, string>> = {
  ja: {
    hello: 'こんにちは',
    hi: 'やあ',
    test: 'テスト',
    thanks: 'ありがとう',
    hallo: 'こんにちは',
    guten: 'おはよう',
    morgen: 'ございます',
    wie: '元気',
    geht: '',
    es: '',
    dir: '？',
    danke: 'ありがとう',
  },
  de: {
    hello: 'hallo',
    hi: 'hi',
    test: 'Test',
    thanks: 'danke',
  },
  en: {
    hallo: 'hello',
    guten: 'good',
    morgen: 'morning',
    danke: 'thank you',
    wie: 'how',
    geht: 'are',
    es: '',
    dir: 'you',
    test: 'test',
  },
};

/** Deterministic engine for tests and offline demo. */
export class EchoTranslationEngine implements TranslationEngine {
  readonly provider: PipelineProvider = 'echo';

  constructor(private readonly defaultLang = 'en') {}

  isAvailable(): boolean {
    return true;
  }

  async detectLanguage(text: string): Promise<string> {
    if (/[äöüß]/i.test(text) || /\b(und|ich|nicht|guten)\b/i.test(text)) return 'de';
    if (/[àâçéèêëîïôùûüÿœæ]/i.test(text) || /\b(je|vous|bonjour)\b/i.test(text)) return 'fr';
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text)) return 'ja';
    return this.defaultLang;
  }

  async translateLine(input: {
    text: string;
    sourceLang: string;
    targetLang: string;
    mode: DisplayMode;
  }): Promise<string> {
    if (input.sourceLang === input.targetLang) return input.text;
    const table = TARGET_GLOSS[input.targetLang] ?? COMMON;
    const gloss = input.text
      .split(/\s+/)
      .map((word) => {
        const key = word.toLowerCase().replace(/[.,!?]/g, '');
        const mapped = table[key] ?? COMMON[key];
        return mapped === '' ? '' : (mapped ?? word);
      })
      .filter((part) => part.length > 0)
      .join(' ');
    if (input.mode === 'birkenbihl') {
      return gloss ? `${input.text} [${gloss}]` : input.text;
    }
    return gloss || input.text;
  }
}

/**
 * On-prem TranslateGemma / Ollama HTTP adapter (privacy-first primary).
 */
export class OnPremTranslateGemmaAdapter implements TranslationEngine {
  readonly provider: PipelineProvider = 'onprem';

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 8_000
  ) {}

  isAvailable(): boolean {
    return Boolean(this.baseUrl);
  }

  private async fetchJson(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`TranslateGemma ${path} failed: ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async detectLanguage(text: string): Promise<string> {
    const data = (await this.fetchJson('/detect', { text })) as { lang: string };
    return data.lang;
  }

  async translateLine(input: {
    text: string;
    sourceLang: string;
    targetLang: string;
    mode: DisplayMode;
  }): Promise<string> {
    const data = (await this.fetchJson('/translate', {
      type: 'text',
      text: input.text,
      source_lang_code: input.sourceLang,
      target_lang_code: input.targetLang,
      mode: input.mode,
      detect_source_first: true,
    })) as { text: string };
    return data.text;
  }
}

/**
 * Cloud LLM translation via ChatCompletionPort (OpenAI / fourSome).
 * Forces detect-then-translate prompt + asymmetric payload fields.
 */
export class CloudLlmTranslationEngine implements TranslationEngine {
  readonly provider: PipelineProvider = 'cloud';

  constructor(
    private readonly completion: ChatCompletionPort,
    private readonly defaultAsymmetric?: AsymmetricLanguageContext,
    private readonly timeoutMs = 15_000
  ) {}

  isAvailable(): boolean {
    return this.completion.isAvailable();
  }

  private resolveAsymmetric(
    targetLang: LanguageCode,
    sourceLang: LanguageCode,
    asymmetric?: AsymmetricLanguageContext
  ): AsymmetricLanguageContext {
    if (asymmetric) return asymmetric;
    if (this.defaultAsymmetric) {
      return { ...this.defaultAsymmetric, receiverLearningLang: targetLang };
    }
    return {
      senderUserId: 'sender',
      receiverUserId: 'receiver',
      senderLearningLang: targetLang,
      receiverLearningLang: targetLang,
      senderNativeLang: sourceLang,
      receiverNativeLang: sourceLang,
    };
  }

  async detectLanguage(text: string): Promise<string> {
    const asymmetric = this.resolveAsymmetric('en', 'en', this.defaultAsymmetric);
    const payload = buildTranslationPayload({
      text,
      mode: 'standard',
      asymmetric,
    });
    const { systemPrompt, userPrompt } = buildDetectThenTranslatePrompt(payload);
    const raw = await this.completeWithTimeout([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    return parseDetectThenTranslateJson(raw).detectedSourceLang;
  }

  async translateLine(input: {
    text: string;
    sourceLang: string;
    targetLang: string;
    mode: DisplayMode;
    asymmetric?: AsymmetricLanguageContext;
  }): Promise<string> {
    const asymmetric = this.resolveAsymmetric(
      input.targetLang,
      input.sourceLang,
      input.asymmetric
    );
    const isBirkenbihl = input.mode === 'birkenbihl';
    const payload = buildTranslationPayload({
      text: input.text,
      mode: toTranslationMode(input.mode),
      asymmetric: isBirkenbihl
        ? asymmetric
        : {
            ...asymmetric,
            receiverLearningLang: input.targetLang,
          },
      translateInto: input.targetLang,
    });
    const { systemPrompt, userPrompt } = isBirkenbihl
      ? buildBirkenbihlTranslatePrompt(payload)
      : buildDetectThenTranslatePrompt(payload);
    const raw = await this.completeWithTimeout([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${userPrompt}\nknown_source_lang_hint: ${input.sourceLang}`,
      },
    ]);
    return parseDetectThenTranslateJson(raw).translation;
  }

  private async completeWithTimeout(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    const result = await Promise.race([
      this.completion.complete(messages, { json: true, feature: 'savigna-translate' }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Cloud translation timeout')), this.timeoutMs)
      ),
    ]);
    return result;
  }
}

export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Circuit breaker: after consecutive failures/timeouts, skip primary and route to fallback
 * without surfacing disruption to the caller (next engines still succeed).
 */
export class CircuitBreakerTranslationEngine implements TranslationEngine {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'closed';

  constructor(
    private readonly primary: TranslationEngine & { provider?: PipelineProvider },
    private readonly fallback: TranslationEngine,
    private readonly options: {
      failureThreshold?: number;
      coolDownMs?: number;
      timeoutMs?: number;
    } = {}
  ) {}

  get circuitState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  get lastProvider(): PipelineProvider | undefined {
    return this._lastProvider;
  }

  private _lastProvider?: PipelineProvider;

  isAvailable(): boolean {
    return this.primary.isAvailable() || this.fallback.isAvailable();
  }

  async detectLanguage(text: string): Promise<string> {
    return this.run('detect', () => this.primary.detectLanguage(text), () =>
      this.fallback.detectLanguage(text)
    );
  }

  async translateLine(input: {
    text: string;
    sourceLang: string;
    targetLang: string;
    mode: DisplayMode;
    asymmetric?: AsymmetricLanguageContext;
  }): Promise<string> {
    return this.run(
      'translate',
      () => this.primary.translateLine(input),
      () => this.fallback.translateLine(input)
    );
  }

  private maybeHalfOpen() {
    const coolDown = this.options.coolDownMs ?? 30_000;
    if (this.state === 'open' && Date.now() - this.openedAt >= coolDown) {
      this.state = 'half_open';
    }
  }

  private async run<T>(
    _label: string,
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>
  ): Promise<T> {
    this.maybeHalfOpen();
    const threshold = this.options.failureThreshold ?? 2;
    const timeoutMs = this.options.timeoutMs ?? 8_000;
    const tryPrimary = this.state !== 'open' && this.primary.isAvailable();

    if (tryPrimary) {
      try {
        const value = await withTimeout(primaryFn(), timeoutMs);
        this.failures = 0;
        this.state = 'closed';
        this._lastProvider = this.primary.provider ?? 'onprem';
        return value;
      } catch {
        this.failures += 1;
        if (this.failures >= threshold || this.state === 'half_open') {
          this.state = 'open';
          this.openedAt = Date.now();
        }
      }
    }

    const value = await fallbackFn();
    this._lastProvider =
      (this.fallback as TranslationEngine & { provider?: PipelineProvider }).provider ?? 'cloud';
    return value;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Translation timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export class FallbackTranslationEngine implements TranslationEngine {
  constructor(private readonly engines: TranslationEngine[]) {}

  isAvailable(): boolean {
    return this.engines.some((e) => e.isAvailable());
  }

  async detectLanguage(text: string): Promise<string> {
    for (const engine of this.engines) {
      if (!engine.isAvailable()) continue;
      try {
        return await engine.detectLanguage(text);
      } catch {
        continue;
      }
    }
    return 'en';
  }

  async translateLine(input: {
    text: string;
    sourceLang: string;
    targetLang: string;
    mode: DisplayMode;
  }): Promise<string> {
    let lastError: unknown;
    for (const engine of this.engines) {
      if (!engine.isAvailable()) continue;
      try {
        return await engine.translateLine(input);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No translation engine available');
  }
}

export type { WebGemmaRequest, WebGemmaResponse } from '@/adapters/webGemma';

export class ExperimentalWebGemmaTranslationEngine implements TranslationEngine {
  readonly provider: PipelineProvider = 'onprem';

  isAvailable(): boolean {
    return isWebGemmaEnabled() && typeof window !== 'undefined' && hasWebGpu() && getWebGemmaStatus().state === 'ready';
  }

  async detectLanguage(text: string): Promise<string> {
    const result = await runWebGemmaInWorker({ type: 'detect', text });
    if (!result.ok || !result.lang) {
      throw new Error(result.ok === false ? result.error : 'Web Gemma detect failed');
    }
    return result.lang;
  }

  async translateLine(input: {
    text: string;
    sourceLang: string;
    targetLang: string;
    mode: DisplayMode;
  }): Promise<string> {
    const result = await runWebGemmaInWorker({
      type: 'translate',
      text: input.text,
      source_lang_code: input.sourceLang,
      target_lang_code: input.targetLang,
      mode: input.mode === 'birkenbihl' ? 'birkenbihl' : 'lines',
    });
    if (!result.ok || !result.text) {
      throw new Error(result.ok === false ? result.error : 'Web Gemma worker not loaded');
    }
    return result.text;
  }
}

/** In-memory chat history store for TDD / demo persistence before Supabase. */
export class InMemoryChatHistoryStore implements ChatHistoryStore {
  private readonly byId = new Map<string, ChatHistoryRecord>();
  private readonly hydratedUsers = new Set<string>();
  private userId: string | null = null;

  constructor(private readonly kv?: ChatKv) {}

  async hydrateForUser(userId: string): Promise<void> {
    if (this.userId && this.userId !== userId) {
      this.byId.clear();
      this.hydratedUsers.clear();
    }
    this.userId = userId;
    if (!this.kv || this.hydratedUsers.has(userId)) return;
    try {
      const raw = await this.kv.getItem(historyStorageKey(userId));
      const records = parseHistorySnapshot(raw) ?? [];
      for (const record of records) {
        this.byId.set(record.id, {
          ...record,
          translations: [...(record.translations ?? [])],
          message: record.message,
        });
      }
    } catch {
      // Keep whatever is already in memory.
    }
    this.hydratedUsers.add(userId);
  }

  async save(record: ChatHistoryRecord): Promise<ChatHistoryRecord> {
    const copy = { ...record, translations: [...record.translations] };
    this.byId.set(copy.id, copy);
    await this.persist();
    return copy;
  }

  async get(id: string): Promise<ChatHistoryRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async listByConversation(conversationId: string): Promise<ChatHistoryRecord[]> {
    return [...this.byId.values()].filter((r) => r.conversationId === conversationId);
  }

  private async persist(): Promise<void> {
    if (!this.kv || !this.userId) return;
    await this.kv.setItem(
      historyStorageKey(this.userId),
      JSON.stringify({ version: 1, records: [...this.byId.values()] })
    );
  }
}

export async function persistCompletedHistory(input: {
  store: ChatHistoryStore;
  message: SourceMessage;
  translations: LineTranslation[];
  mode?: TranslationMode;
  providerUsed?: PipelineProvider;
}): Promise<void> {
  let record = createChatHistoryRecord({
    message: input.message,
    translationMode: input.mode ?? 'standard',
  });
  record = transitionChatHistory(record, { type: 'start_detect' });
  record = transitionChatHistory(record, {
    type: 'start_translate',
    detectedSourceLang: input.message.sourceLang,
  });
  record = transitionChatHistory(record, {
    type: 'persist',
    translations: input.translations,
    providerUsed: input.providerUsed ?? 'cloud',
  });
  await input.store.save(record);
}

/**
 * Orchestrates detect → translate → persist for one outbound message.
 * Uses asymmetric payload (both learning langs) and circuit-breaker engine.
 */
export async function processOutgoingTranslation(input: {
  message: SourceMessage;
  asymmetric: AsymmetricLanguageContext;
  mode: TranslationMode | DisplayMode;
  engine: TranslationEngine;
  historyStore: ChatHistoryStore;
  knownSourceLang?: LanguageCode;
  /** Keep the other display mode’s rows (Birkenbihl) when refreshing Standard lines. */
  existingTranslations?: LineTranslation[];
}): Promise<{
  record: ChatHistoryRecord;
  translations: LineTranslation[];
  providerUsed: PipelineProvider;
}> {
  const mode =
    input.mode === 'standard' || input.mode === 'birkenbihl'
      ? input.mode
      : toTranslationMode(input.mode);
  if (!shouldTranslateMessage(input.message)) {
    let skipped = createChatHistoryRecord({ message: input.message, translationMode: mode });
    skipped = transitionChatHistory(skipped, { type: 'start_detect' });
    skipped = transitionChatHistory(skipped, {
      type: 'start_translate',
      detectedSourceLang: input.message.sourceLang,
    });
    skipped = transitionChatHistory(skipped, {
      type: 'persist',
      translations: [],
      providerUsed: 'echo',
    });
    await input.historyStore.save(skipped);
    return { record: skipped, translations: [], providerUsed: 'echo' };
  }
  const displayMode = toDisplayMode(mode);
  const payload = buildTranslationPayload({
    text: input.message.sourceText,
    mode,
    asymmetric: input.asymmetric,
  });

  let record = createChatHistoryRecord({ message: input.message, translationMode: mode });
  record = transitionChatHistory(record, { type: 'start_detect' });
  await input.historyStore.save(record);

  try {
    const detected =
      input.knownSourceLang ?? (await input.engine.detectLanguage(payload.text));
    record = transitionChatHistory(record, {
      type: 'start_translate',
      detectedSourceLang: detected,
    });
    await input.historyStore.save(record);

    const tryViewer = async (targetLang: LanguageCode, lineMode: DisplayMode) => {
      try {
        return await translateMessageForViewer({
          sourceText: payload.text,
          sourceLang: detected,
          targetLang,
          mode: lineMode,
          engine: input.engine,
          asymmetric: input.asymmetric,
        });
      } catch {
        return [] as LineTranslation[];
      }
    };

    const seen = new Set<string>();
    const translations: LineTranslation[] = [];
    const add = async (targetLang: LanguageCode, lineMode: DisplayMode) => {
      const key = `${targetLang}:${lineMode}`;
      if (seen.has(key)) return;
      seen.add(key);
      translations.push(...(await tryViewer(targetLang, lineMode)));
    };

    await add(payload.translateInto, 'lines');
    await add(input.asymmetric.senderNativeLang, 'lines');
    await add(input.asymmetric.senderLearningLang, 'lines');
    await add(input.asymmetric.receiverNativeLang, 'lines');
    await add(input.asymmetric.receiverLearningLang, 'lines');
    if (displayMode === 'birkenbihl') {
      await add(input.asymmetric.senderNativeLang, 'birkenbihl');
      await add(payload.translateInto, 'birkenbihl');
    }
    const providerUsed =
      (input.engine as CircuitBreakerTranslationEngine).lastProvider ??
      (input.engine as { provider?: PipelineProvider }).provider ??
      'echo';

    const persisted =
      input.existingTranslations && input.existingTranslations.length > 0
        ? mergeTranslationsByMode(input.existingTranslations, translations, 'lines')
        : translations;

    record = transitionChatHistory(record, {
      type: 'persist',
      translations: persisted,
      providerUsed,
    });
    await input.historyStore.save(record);

    return { record, translations: persisted, providerUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'translation failed';
    record = transitionChatHistory(record, { type: 'fail', error: message });
    await input.historyStore.save(record);
    throw error;
  }
}

function providerFromEngine(engine: TranslationEngine): PipelineProvider {
  return (
    (engine as CircuitBreakerTranslationEngine).lastProvider ??
    (engine as { provider?: PipelineProvider }).provider ??
    'echo'
  );
}

function seedHistoryRecord(
  message: SourceMessage,
  existing: LineTranslation[]
): ChatHistoryRecord {
  const record = createChatHistoryRecord({ message, translationMode: 'birkenbihl' });
  if (existing.length === 0) return record;
  return {
    ...record,
    translations: existing,
    pipelineState: 'persisted',
  };
}

/**
 * Refresh only `mode: 'birkenbihl'` rows via the Birkenbihl AI prompt.
 * Never rewrites sourceText. Never drops Standard/lines translations.
 * Empty / media messages are skipped.
 */
export async function recalculateBirkenbihlForMessage(input: {
  message: SourceMessage;
  existingTranslations: LineTranslation[];
  asymmetric: AsymmetricLanguageContext;
  engine: TranslationEngine;
  hintLang: LanguageCode;
  historyStore?: ChatHistoryStore;
  knownSourceLang?: LanguageCode;
}): Promise<LineTranslation[]> {
  if (!shouldTranslateMessage(input.message)) {
    return input.existingTranslations;
  }

  let record =
    (input.historyStore ? await input.historyStore.get(input.message.id) : null) ??
    seedHistoryRecord(input.message, input.existingTranslations);
  record = { ...record, translations: input.existingTranslations };

  record = transitionChatHistory(record, { type: 'recalculate_birkenbihl' });
  await input.historyStore?.save(record);

  try {
    const birken = (
      await translateMessageForViewer({
        sourceText: input.message.sourceText,
        sourceLang: input.knownSourceLang ?? input.message.sourceLang,
        targetLang: input.hintLang,
        mode: 'birkenbihl',
        engine: input.engine,
        asymmetric: input.asymmetric,
      })
    ).filter((row) => row.mode !== 'birkenbihl' || isUsableBirkenbihlOverlay(row.text));
    record = transitionChatHistory(record, {
      type: 'persist_birkenbihl',
      translations: birken,
      providerUsed: providerFromEngine(input.engine),
    });
    await input.historyStore?.save(record);
    return record.translations;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'birkenbihl recalculation failed';
    record = transitionChatHistory(record, { type: 'fail', error: message });
    await input.historyStore?.save(record);
    throw error;
  }
}

export async function recalculateBirkenbihlForThread(input: {
  messages: SourceMessage[];
  translationsByMessage: Record<string, LineTranslation[]>;
  asymmetric: AsymmetricLanguageContext | ((message: SourceMessage) => AsymmetricLanguageContext);
  engine: TranslationEngine;
  hintLang: LanguageCode;
  historyStore?: ChatHistoryStore;
  fillMissingOnly?: boolean;
}): Promise<{
  translationsByMessage: Record<string, LineTranslation[]>;
  errors: Array<{ messageId: string; error: string }>;
}> {
  const translationsByMessage = { ...input.translationsByMessage };
  const errors: Array<{ messageId: string; error: string }> = [];

  for (const message of input.messages) {
    const existing = translationsByMessage[message.id] ?? [];
    if (!shouldTranslateMessage(message)) {
      translationsByMessage[message.id] = existing;
      continue;
    }
    if (input.fillMissingOnly && hasBirkenbihlTranslation(existing)) {
      continue;
    }
    const asymmetric =
      typeof input.asymmetric === 'function' ? input.asymmetric(message) : input.asymmetric;
    try {
      translationsByMessage[message.id] = await recalculateBirkenbihlForMessage({
        message,
        existingTranslations: existing,
        asymmetric,
        engine: input.engine,
        hintLang: input.hintLang,
        historyStore: input.historyStore,
        knownSourceLang: message.sourceLang,
      });
    } catch (error) {
      translationsByMessage[message.id] = existing;
      errors.push({
        messageId: message.id,
        error: error instanceof Error ? error.message : 'birkenbihl recalculation failed',
      });
    }
  }

  return { translationsByMessage, errors };
}

/** Build LLM messages that satisfy detect-first + asymmetric AC (for completion adapters). */
export function llmMessagesForTranslation(payload: ReturnType<typeof buildTranslationPayload>) {
  const { systemPrompt, userPrompt } = buildDetectThenTranslatePrompt(payload);
  return [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];
}

/**
 * One JSON-mode completion that fills both learning + native lines for SavignasBoi.
 * The bubble still renders DE/EN tags — never the raw JSON.
 */
export async function completeBilingualBotReply(input: {
  completion: ChatCompletionPort;
  learnerText: string;
  learningLang: LanguageCode;
  nativeLang: LanguageCode;
  /** Recalc an existing bubble’s bilingual JSON pair; do not write a new reply. */
  pairExisting?: boolean;
}): Promise<{
  sourceText: string;
  sourceLang: LanguageCode;
  translations: LineTranslation[];
}> {
  const { systemPrompt, userPrompt } = buildBilingualChatPrompt({
    learningLang: input.learningLang,
    nativeLang: input.nativeLang,
    learnerText: input.learnerText,
    pairExisting: input.pairExisting,
  });
  const raw = await input.completion.complete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { json: true, feature: 'savigna-chat' }
  );
  const parsed = parseBilingualChatJson(raw, input.learningLang, input.nativeLang);
  if (parsed) {
    return {
      sourceText: parsed.learningText,
      // `detected_source_lang` comes from the model and may be wrong; we already
      // know `sourceText` is the `learning_text` we requested in `learningLang`.
      sourceLang: input.learningLang,
      translations: lineTranslationsFromBilingual({
        learningLang: input.learningLang,
        nativeLang: input.nativeLang,
        learningText: parsed.learningText,
        nativeText: parsed.nativeText,
      }),
    };
  }
  return {
    sourceText: extractChatReplyText(raw),
    sourceLang: input.learningLang,
    translations: [],
  };
}

/**
 * Per-bubble Retry: refresh Standard lines or Birkenbihl for one message.
 * Never rewrites `sourceText`. Keeps the other mode’s stored rows.
 */
export async function retryBubbleTranslations(input: {
  message: SourceMessage;
  existingTranslations: LineTranslation[];
  asymmetric: AsymmetricLanguageContext;
  mode: TranslationMode | DisplayMode;
  engine: TranslationEngine;
  historyStore: ChatHistoryStore;
  completion?: ChatCompletionPort;
  learningLang: LanguageCode;
  nativeLang: LanguageCode;
  mismatchReason?: TranslationMismatchReason | null;
}): Promise<LineTranslation[]> {
  const sourceText = input.message.sourceText;
  const display =
    input.mode === 'standard' || input.mode === 'birkenbihl'
      ? toDisplayMode(input.mode)
      : input.mode;

  const storedLineText = (
    translations: LineTranslation[],
    lineIndex: number,
    lang: LanguageCode
  ): string | undefined =>
    translations.find(
      (item) =>
        item.lineIndex === lineIndex &&
        item.targetLang.toLowerCase() === lang.toLowerCase() &&
        item.mode === 'lines'
    )?.text;

  const computeReplaceTargets = (
    reason: TranslationMismatchReason | null | undefined
  ): { replaceLearning: boolean; replaceNative: boolean } => {
    if (!reason || reason === 'empty_pair') return { replaceLearning: true, replaceNative: true };
    if (reason === 'missing_learning') return { replaceLearning: true, replaceNative: false };
    if (reason === 'missing_native') return { replaceLearning: false, replaceNative: true };
    if (reason === 'same_as_source') {
      const sourceLangLower = input.message.sourceLang.toLowerCase();
      const learningLower = input.learningLang.toLowerCase();
      const nativeLower = input.nativeLang.toLowerCase();

      const needsLearning = learningLower !== sourceLangLower;
      const needsNative = nativeLower !== sourceLangLower && nativeLower !== learningLower;

      let replaceLearning = false;
      let replaceNative = false;

      for (const [lineIndex, line] of input.message.lines.entries()) {
        const sourceLine = line.content.trim().toLowerCase();
        if (needsLearning) {
          const existing = storedLineText(input.existingTranslations, lineIndex, input.learningLang);
          if (existing?.trim().toLowerCase() === sourceLine) replaceLearning = true;
        }
        if (needsNative) {
          const existing = storedLineText(input.existingTranslations, lineIndex, input.nativeLang);
          if (existing?.trim().toLowerCase() === sourceLine) replaceNative = true;
        }
        if (replaceLearning && replaceNative) break;
      }
      // If we couldn't identify which side to refresh, default to the safe option.
      if (!replaceLearning && !replaceNative) return { replaceLearning: true, replaceNative: true };
      return { replaceLearning, replaceNative };
    }

    // missing_birkenbihl shouldn't happen in standard mode retries; keep behavior safe.
    return { replaceLearning: true, replaceNative: true };
  };

  try {
    if (display === 'birkenbihl') {
      const next = await recalculateBirkenbihlForMessage({
        message: input.message,
        existingTranslations: input.existingTranslations,
        asymmetric: input.asymmetric,
        engine: input.engine,
        hintLang: input.nativeLang,
        historyStore: input.historyStore,
        knownSourceLang: input.message.sourceLang,
      });
      return next;
    }

    let incoming: LineTranslation[] = [];
    const { replaceLearning, replaceNative } = computeReplaceTargets(input.mismatchReason);
    if (input.completion) {
      const leaked = parseBilingualChatJson(
        sourceText,
        input.learningLang,
        input.nativeLang
      );
      if (leaked) {
        incoming = lineTranslationsFromBilingual({
          learningLang: input.learningLang,
          nativeLang: input.nativeLang,
          learningText: leaked.learningText,
          nativeText: leaked.nativeText,
        });
      } else {
        try {
          const bilingual = await completeBilingualBotReply({
            completion: input.completion,
            learnerText: sourceText,
            learningLang: input.learningLang,
            nativeLang: input.nativeLang,
            pairExisting: true,
          });
          incoming = bilingual.translations;
        } catch {
          incoming = [];
        }
      }
    }

    if (incoming.length === 0) {
      if (!replaceLearning && !replaceNative) return input.existingTranslations;

      const next: LineTranslation[] = [];
      if (replaceLearning) {
        next.push(
          ...(await translateMessageForViewer({
            sourceText: input.message.sourceText,
            sourceLang: input.message.sourceLang,
            targetLang: input.learningLang,
            mode: 'lines',
            engine: input.engine,
            asymmetric: input.asymmetric,
          }))
        );
      }
      if (replaceNative) {
        next.push(
          ...(await translateMessageForViewer({
            sourceText: input.message.sourceText,
            sourceLang: input.message.sourceLang,
            targetLang: input.nativeLang,
            mode: 'lines',
            engine: input.engine,
            asymmetric: input.asymmetric,
          }))
        );
      }
      incoming = next;
    }

    const reason = input.mismatchReason ?? null;
    const sourceLineFor = (lineIndex: number): string =>
      input.message.lines[lineIndex]?.content.trim().toLowerCase() ?? '';

    const incomingFiltered = incoming.filter((row) => {
      const isLearningRow = row.targetLang === input.learningLang;
      const isNativeRow = row.targetLang === input.nativeLang;

      if (!isLearningRow && !isNativeRow) return false;
      if (isLearningRow && !replaceLearning) return false;
      if (isNativeRow && !replaceNative) return false;

      // If we don't know the mismatch reason, keep prior behavior: refresh the whole side.
      if (!reason) return true;

      const existing = storedLineText(input.existingTranslations, row.lineIndex, row.targetLang);
      const existingTrim = existing?.trim().toLowerCase() ?? '';
      const sourceLine = sourceLineFor(row.lineIndex);

      switch (reason) {
        case 'missing_learning':
          return isLearningRow && !existingTrim;
        case 'missing_native':
          return isNativeRow && !existingTrim;
        case 'empty_pair':
          return !existingTrim;
        case 'same_as_source':
          // Replace when the existing side is blank OR incorrectly matches the visible source.
          return !existingTrim || existingTrim === sourceLine;
        default:
          return true;
      }
    });
    if (incomingFiltered.length === 0) return input.existingTranslations;

    const merged = mergeLineTranslations(input.existingTranslations, incomingFiltered);
    await persistCompletedHistory({
      store: input.historyStore,
      message: input.message,
      translations: merged,
      mode: 'standard',
      providerUsed: providerFromEngine(input.engine),
    });
    return merged;
  } finally {
    if (input.message.sourceText !== sourceText) {
      input.message.sourceText = sourceText;
    }
  }
}

export function createTranslationEngine(options?: {
  completion?: ChatCompletionPort;
  asymmetric?: AsymmetricLanguageContext;
}): TranslationEngine {
  const onPremUrl = process.env.EXPO_PUBLIC_TRANSLATEGEMMA_URL;
  const echo = new EchoTranslationEngine();
  const cloud = options?.completion
    ? new CloudLlmTranslationEngine(options.completion, options.asymmetric)
    : null;

  if (onPremUrl) {
    const primary = new OnPremTranslateGemmaAdapter(onPremUrl);
    const secondary = cloud
      ? new FallbackTranslationEngine([cloud, echo])
      : echo;
    return new CircuitBreakerTranslationEngine(primary, secondary, {
      failureThreshold: 2,
      coolDownMs: 30_000,
      timeoutMs: 8_000,
    });
  }

  if (isWebGemmaEnabled()) {
    const primary = new ExperimentalWebGemmaTranslationEngine();
    const secondary = cloud
      ? new FallbackTranslationEngine([cloud, echo])
      : echo;
    return new CircuitBreakerTranslationEngine(primary, secondary, {
      failureThreshold: 1,
      coolDownMs: 15_000,
      timeoutMs: 10_000,
    });
  }

  if (cloud) {
    return new CircuitBreakerTranslationEngine(cloud, echo, {
      failureThreshold: 2,
      coolDownMs: 20_000,
      timeoutMs: 15_000,
    });
  }

  return echo;
}

export { splitTranslationIntoLines, buildTranslationPayload, buildDetectThenTranslatePrompt };
