/**
 * AI Pipeline & Architecture — adapters + orchestration.
 * Primary: on-prem TranslateGemma. Fallback: cloud (OpenAI / fourSome) via circuit breaker.
 * Prompt contract: detect source language before translate; payload includes both L2s.
 */

import {
  assembleLineTranslations,
  planLineJobs,
  splitSourceLines,
  type DisplayMode,
  type LanguageCode,
  type LineTranslation,
  type SourceMessage,
} from '@/domain/chat';
import {
  buildBilingualChatPrompt,
  buildDetectThenTranslatePrompt,
  buildTranslationPayload,
  createChatHistoryRecord,
  extractChatReplyText,
  lineTranslationsFromBilingual,
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
  type TranslationMode,
} from '@/domain/pipeline';
import { createInterlinearFormat } from '@/domain/text';
import { hasWebGpu, isWebGemmaEnabled, runWebGemmaInWorker, getWebGemmaStatus } from '@/adapters/webGemma';
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
    input.mode,
    createInterlinearFormat
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
    if (input.mode === 'birkenbihl') return createInterlinearFormat(input.text, gloss);
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
    const payload = buildTranslationPayload({
      text: input.text,
      mode: toTranslationMode(input.mode),
      asymmetric: {
        ...asymmetric,
        receiverLearningLang: input.targetLang,
      },
    });
    const { systemPrompt, userPrompt } = buildDetectThenTranslatePrompt(payload);
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
    if (input.mode === 'birkenbihl') return createInterlinearFormat(input.text, result.text);
    return result.text;
  }
}

/** In-memory chat history store for TDD / demo persistence before Supabase. */
export class InMemoryChatHistoryStore implements ChatHistoryStore {
  private readonly byId = new Map<string, ChatHistoryRecord>();

  async save(record: ChatHistoryRecord): Promise<ChatHistoryRecord> {
    const copy = { ...record, translations: [...record.translations] };
    this.byId.set(copy.id, copy);
    return copy;
  }

  async get(id: string): Promise<ChatHistoryRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async listByConversation(conversationId: string): Promise<ChatHistoryRecord[]> {
    return [...this.byId.values()].filter((r) => r.conversationId === conversationId);
  }
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
}): Promise<{
  record: ChatHistoryRecord;
  translations: LineTranslation[];
  providerUsed: PipelineProvider;
}> {
  const mode =
    input.mode === 'standard' || input.mode === 'birkenbihl'
      ? input.mode
      : toTranslationMode(input.mode);
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

    await add(payload.translateInto, displayMode);
    await add(input.asymmetric.senderNativeLang, 'lines');
    await add(input.asymmetric.senderLearningLang, displayMode);
    await add(input.asymmetric.receiverNativeLang, 'lines');
    await add(input.asymmetric.receiverLearningLang, displayMode);
    const providerUsed =
      (input.engine as CircuitBreakerTranslationEngine).lastProvider ??
      (input.engine as { provider?: PipelineProvider }).provider ??
      'echo';

    record = transitionChatHistory(record, {
      type: 'persist',
      translations,
      providerUsed,
    });
    await input.historyStore.save(record);

    return { record, translations, providerUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'translation failed';
    record = transitionChatHistory(record, { type: 'fail', error: message });
    await input.historyStore.save(record);
    throw error;
  }
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
}): Promise<{
  sourceText: string;
  sourceLang: LanguageCode;
  translations: LineTranslation[];
}> {
  const { systemPrompt, userPrompt } = buildBilingualChatPrompt({
    learningLang: input.learningLang,
    nativeLang: input.nativeLang,
    learnerText: input.learnerText,
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
      sourceLang: parsed.detectedSourceLang ?? input.learningLang,
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
