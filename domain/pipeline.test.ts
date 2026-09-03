import { describe, expect, it, vi } from 'vitest';
import {
  CircuitBreakerTranslationEngine,
  EchoTranslationEngine,
  InMemoryChatHistoryStore,
  completeBilingualBotReply,
  processOutgoingTranslation,
} from '@/adapters/translation';
import { sourceMessageFromText } from './chat';
import {
  buildBirkenbihlTranslatePrompt,
  buildBilingualChatPrompt,
  buildDetectThenTranslatePrompt,
  buildTranslationPayload,
  createChatHistoryRecord,
  extractChatReplyText,
  mergeTranslationsByMode,
  parseBilingualChatJson,
  parseDetectThenTranslateJson,
  toDisplayMode,
  transitionChatHistory,
  type AsymmetricLanguageContext,
} from './pipeline';
import { recalculateBirkenbihlForMessage, recalculateBirkenbihlForThread } from '@/adapters/translation';

const asymmetric: AsymmetricLanguageContext = {
  senderUserId: 'u1',
  receiverUserId: 'u2',
  senderLearningLang: 'ja',
  receiverLearningLang: 'de',
  senderNativeLang: 'en',
  receiverNativeLang: 'fr',
};

describe('asymmetric translation payload', () => {
  it('includes both users target learning languages', () => {
    const payload = buildTranslationPayload({
      text: 'Hello world',
      mode: 'standard',
      asymmetric,
    });
    expect(payload.detectSourceFirst).toBe(true);
    expect(payload.asymmetric.senderLearningLang).toBe('ja');
    expect(payload.asymmetric.receiverLearningLang).toBe('de');
    expect(payload.translateInto).toBe('de');
  });

  it('forces detect-before-translate in the system prompt', () => {
    const payload = buildTranslationPayload({
      text: 'Guten Morgen',
      mode: 'standard',
      asymmetric,
    });
    const { systemPrompt, userPrompt } = buildDetectThenTranslatePrompt(payload);
    expect(systemPrompt).toMatch(/STEP 1.*Identify/i);
    expect(systemPrompt).toMatch(/Sender learning language: ja/);
    expect(systemPrompt).toMatch(/Receiver learning language: de/);
    expect(systemPrompt).toMatch(/Mode Standard/);
    expect(userPrompt).toContain('detect_source_first: true');
    expect(userPrompt).toContain('sender_learning_lang: ja');
    expect(userPrompt).toContain('receiver_learning_lang: de');
  });

  it('uses a dedicated Birkenbihl interlinear JSON prompt, not the lines prompt', () => {
    const payload = buildTranslationPayload({
      text: '¿Por qué es así?',
      mode: 'birkenbihl',
      asymmetric,
      translateInto: 'en',
    });
    const { systemPrompt, userPrompt } = buildBirkenbihlTranslatePrompt(payload);
    const standard = buildDetectThenTranslatePrompt(
      buildTranslationPayload({ text: '¿Por qué es así?', mode: 'standard', asymmetric })
    );
    expect(systemPrompt).toMatch(/STEP 1.*Identify/i);
    expect(systemPrompt).toMatch(/interlinear/i);
    expect(systemPrompt).toMatch(/\[.*hint/i);
    expect(systemPrompt).not.toMatch(/one translated line per input line/i);
    expect(standard.systemPrompt).toMatch(/Mode Standard/);
    expect(standard.systemPrompt).not.toEqual(systemPrompt);
    expect(userPrompt).toContain('mode: birkenbihl');
    expect(userPrompt).toContain('¿Por qué es así?');
  });

  it('parses LLM JSON with detected language first', () => {
    const parsed = parseDetectThenTranslateJson(
      'Here you go:\n{"detected_source_lang":"EN","translation":"Hallo Welt"}'
    );
    expect(parsed.detectedSourceLang).toBe('en');
    expect(parsed.translation).toBe('Hallo Welt');
  });

  it('accepts translation JSON aliases (text / source_lang)', () => {
    const parsed = parseDetectThenTranslateJson(
      '{"source_lang":"de","text":"How are you?"}'
    );
    expect(parsed.detectedSourceLang).toBe('de');
    expect(parsed.translation).toBe('How are you?');
  });

  it('maps standard mode to lines display mode', () => {
    expect(toDisplayMode('standard')).toBe('lines');
    expect(toDisplayMode('birkenbihl')).toBe('birkenbihl');
  });
});

describe('ChatHistoryRecord state machine (TDD before Supabase)', () => {
  it('transitions draft → detecting → translating → persisted', () => {
    const message = sourceMessageFromText({
      id: 'm1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      sourceText: 'Hello',
    });
    let record = createChatHistoryRecord({ message, translationMode: 'standard' });
    expect(record.pipelineState).toBe('draft');

    record = transitionChatHistory(record, { type: 'start_detect' });
    expect(record.pipelineState).toBe('detecting');

    record = transitionChatHistory(record, {
      type: 'start_translate',
      detectedSourceLang: 'en',
    });
    expect(record.pipelineState).toBe('translating');
    expect(record.detectedSourceLang).toBe('en');

    record = transitionChatHistory(record, {
      type: 'persist',
      translations: [{ lineIndex: 0, targetLang: 'de', mode: 'lines', text: 'Hallo' }],
      providerUsed: 'onprem',
    });
    expect(record.pipelineState).toBe('persisted');
    expect(record.providerUsed).toBe('onprem');
    expect(record.translations).toHaveLength(1);
  });

  it('supports Standard ↔ Birkenbihl mode switch only from idle states', () => {
    const message = sourceMessageFromText({
      id: 'm2',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      sourceText: 'Hello',
    });
    let record = createChatHistoryRecord({ message, translationMode: 'standard' });
    record = transitionChatHistory(record, { type: 'switch_mode', mode: 'birkenbihl' });
    expect(record.translationMode).toBe('birkenbihl');
    expect(record.pipelineState).toBe('draft');

    record = transitionChatHistory(record, { type: 'start_detect' });
    expect(() =>
      transitionChatHistory(record, { type: 'switch_mode', mode: 'standard' })
    ).toThrow(/Cannot switch mode/);
  });

  it('keeps standard lines translations when switching into Birkenbihl', () => {
    const message = sourceMessageFromText({
      id: 'm2b',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'es',
      sourceText: 'Hola mundo',
    });
    const lines = [
      { lineIndex: 0, targetLang: 'en', mode: 'lines' as const, text: 'Hello world' },
      { lineIndex: 0, targetLang: 'es', mode: 'lines' as const, text: 'Hola mundo' },
    ];
    let record = createChatHistoryRecord({ message, translationMode: 'standard' });
    record = transitionChatHistory(record, { type: 'start_detect' });
    record = transitionChatHistory(record, { type: 'start_translate', detectedSourceLang: 'es' });
    record = transitionChatHistory(record, {
      type: 'persist',
      translations: lines,
      providerUsed: 'cloud',
    });

    record = transitionChatHistory(record, { type: 'switch_mode', mode: 'birkenbihl' });
    expect(record.translationMode).toBe('birkenbihl');
    expect(record.pipelineState).toBe('persisted');
    expect(record.translations.filter((t) => t.mode === 'lines')).toEqual(lines);
    expect(record.message.sourceText).toBe('Hola mundo');
  });

  it('recalculates only Birkenbihl rows and leaves lines + sourceText intact', () => {
    const message = sourceMessageFromText({
      id: 'm2c',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'es',
      sourceText: 'Hola mundo',
    });
    const lines = [
      { lineIndex: 0, targetLang: 'en', mode: 'lines' as const, text: 'Hello world' },
    ];
    let record = createChatHistoryRecord({ message, translationMode: 'standard' });
    record = transitionChatHistory(record, { type: 'start_detect' });
    record = transitionChatHistory(record, { type: 'start_translate', detectedSourceLang: 'es' });
    record = transitionChatHistory(record, {
      type: 'persist',
      translations: [
        ...lines,
        { lineIndex: 0, targetLang: 'en', mode: 'birkenbihl', text: 'stale [old]' },
      ],
      providerUsed: 'echo',
    });

    record = transitionChatHistory(record, { type: 'recalculate_birkenbihl' });
    expect(record.pipelineState).toBe('translating');
    expect(record.translations.filter((t) => t.mode === 'lines')).toEqual(lines);

    record = transitionChatHistory(record, {
      type: 'persist_birkenbihl',
      translations: [
        { lineIndex: 0, targetLang: 'en', mode: 'birkenbihl', text: 'Hola [Hi] mundo [world]' },
      ],
      providerUsed: 'cloud',
    });
    expect(record.pipelineState).toBe('persisted');
    expect(record.message.sourceText).toBe('Hola mundo');
    expect(record.translations.filter((t) => t.mode === 'lines')).toEqual(lines);
    expect(record.translations.filter((t) => t.mode === 'birkenbihl')).toEqual([
      { lineIndex: 0, targetLang: 'en', mode: 'birkenbihl', text: 'Hola [Hi] mundo [world]' },
    ]);
  });

  it('merges by mode without dropping the other overlay', () => {
    const merged = mergeTranslationsByMode(
      [
        { lineIndex: 0, targetLang: 'en', mode: 'lines', text: 'Hello' },
        { lineIndex: 0, targetLang: 'en', mode: 'birkenbihl', text: 'old' },
      ],
      [{ lineIndex: 0, targetLang: 'en', mode: 'birkenbihl', text: 'Hola [Hi]' }],
      'birkenbihl'
    );
    expect(merged.find((t) => t.mode === 'lines')?.text).toBe('Hello');
    expect(merged.find((t) => t.mode === 'birkenbihl')?.text).toBe('Hola [Hi]');
  });

  it('persists history via mockable store before any Supabase client', async () => {
    const store = new InMemoryChatHistoryStore();
    const message = sourceMessageFromText({
      id: 'm3',
      conversationId: 'c9',
      authorId: 'u1',
      sourceLang: 'en',
      sourceText: 'Hello',
      receipt: 'sent',
    });

    const result = await processOutgoingTranslation({
      message,
      asymmetric,
      mode: 'standard',
      engine: new EchoTranslationEngine(),
      historyStore: store,
      knownSourceLang: 'en',
    });

    expect(result.record.pipelineState).toBe('persisted');
    expect(result.translations.some((t) => t.targetLang === 'de')).toBe(true);
    expect(result.translations.some((t) => t.targetLang === 'ja')).toBe(true);
    const loaded = await store.get('m3');
    expect(loaded?.pipelineState).toBe('persisted');
    expect(loaded?.translationMode).toBe('standard');
    const listed = await store.listByConversation('c9');
    expect(listed).toHaveLength(1);
  });

  it('records failed pipeline state without requiring cloud', async () => {
    const store = new InMemoryChatHistoryStore();
    const failing = {
      isAvailable: () => true,
      detectLanguage: async () => {
        throw new Error('boom');
      },
      translateLine: async () => 'x',
    };
    const message = sourceMessageFromText({
      id: 'm4',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      sourceText: 'Hi',
    });
    await expect(
      processOutgoingTranslation({
        message,
        asymmetric,
        mode: 'birkenbihl',
        engine: failing,
        historyStore: store,
      })
    ).rejects.toThrow('boom');
    const loaded = await store.get('m4');
    expect(loaded?.pipelineState).toBe('failed');
    expect(loaded?.lastError).toBe('boom');
  });
});

describe('circuit breaker on-prem → cloud', () => {
  it('reroutes to fallback after primary timeouts without throwing to caller', async () => {
    vi.useFakeTimers();
    const primary = {
      provider: 'onprem' as const,
      isAvailable: () => true,
      detectLanguage: () => new Promise<string>(() => undefined),
      translateLine: () => new Promise<string>(() => undefined),
    };
    const fallback = new EchoTranslationEngine();
    const breaker = new CircuitBreakerTranslationEngine(primary, fallback, {
      failureThreshold: 1,
      timeoutMs: 50,
      coolDownMs: 60_000,
    });

    const pending = breaker.translateLine({
      text: 'Hallo',
      sourceLang: 'de',
      targetLang: 'en',
      mode: 'lines',
    });
    await vi.advanceTimersByTimeAsync(60);
    const text = await pending;
    expect(text.toLowerCase()).toContain('hello');
    expect(breaker.circuitState).toBe('open');
    expect(breaker.lastProvider).toBe('echo');
    vi.useRealTimers();
  });
});

describe('Birkenbihl recalc adapter', () => {
  it('recalculates Birkenbihl via the engine without wiping lines or sourceText', async () => {
    const store = new InMemoryChatHistoryStore();
    const message = sourceMessageFromText({
      id: 'm-bb',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'es',
      sourceText: 'Hola mundo',
    });
    const existing = [
      { lineIndex: 0, targetLang: 'en', mode: 'lines' as const, text: 'Hello world' },
      { lineIndex: 0, targetLang: 'es', mode: 'lines' as const, text: 'Hola mundo' },
    ];
    const engine = {
      isAvailable: () => true,
      detectLanguage: async () => 'es',
      translateLine: async (input: { mode: string }) =>
        input.mode === 'birkenbihl' ? 'Hola [Hi] mundo [world]' : 'Hello world',
    };

    const next = await recalculateBirkenbihlForMessage({
      message,
      existingTranslations: existing,
      asymmetric,
      engine,
      hintLang: 'en',
      historyStore: store,
      knownSourceLang: 'es',
    });

    expect(message.sourceText).toBe('Hola mundo');
    expect(next.filter((t) => t.mode === 'lines')).toEqual(existing);
    expect(next.some((t) => t.mode === 'birkenbihl' && t.text.includes('Hola [Hi]'))).toBe(true);
    const loaded = await store.get('m-bb');
    expect(loaded?.pipelineState).toBe('persisted');
    expect(loaded?.translations.filter((t) => t.mode === 'lines')).toEqual(existing);
  });

  it('skips empty source and continues the thread when one message fails', async () => {
    const good = sourceMessageFromText({
      id: 'good',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'es',
      sourceText: 'Hola',
    });
    const empty = sourceMessageFromText({
      id: 'empty',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'es',
      sourceText: '   ',
    });
    const bad = sourceMessageFromText({
      id: 'bad',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'es',
      sourceText: 'Adiós',
    });
    const lines = [{ lineIndex: 0, targetLang: 'en', mode: 'lines' as const, text: 'Hi' }];
    const engine = {
      isAvailable: () => true,
      detectLanguage: async () => 'es',
      translateLine: async (input: { text: string; mode: string }) => {
        if (input.text.includes('Adiós')) throw new Error('nope');
        return input.mode === 'birkenbihl' ? 'Hola [Hi]' : 'Hi';
      },
    };

    const result = await recalculateBirkenbihlForThread({
      messages: [good, empty, bad],
      translationsByMessage: {
        good: lines,
        empty: lines,
        bad: lines,
      },
      asymmetric,
      engine,
      hintLang: 'en',
    });

    expect(result.translationsByMessage.empty).toEqual(lines);
    expect(result.translationsByMessage.good.some((t) => t.mode === 'birkenbihl')).toBe(true);
    expect(result.translationsByMessage.bad).toEqual(lines);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.messageId).toBe('bad');
  });
});

describe('bilingual chat JSON (SavignasBoi)', () => {
  it('forces JSON keys for learning + native lines', () => {
    const { systemPrompt, userPrompt } = buildBilingualChatPrompt({
      learningLang: 'de',
      nativeLang: 'en',
      learnerText: 'heeyy',
    });
    expect(systemPrompt).toMatch(/learning_text/);
    expect(systemPrompt).toMatch(/native_text/);
    expect(systemPrompt).toMatch(/JSON only/);
    expect(userPrompt).toContain('learning_lang: de');
    expect(userPrompt).toContain('heeyy');
  });

  it('parses bilingual JSON and language-code keys', () => {
    const parsed = parseBilingualChatJson(
      '```json\n{"learning_text":"Hallo! Wie geht\'s dir?","native_text":"Hi! How are you?","detected_source_lang":"de"}\n```',
      'de',
      'en'
    );
    expect(parsed?.learningText).toBe("Hallo! Wie geht's dir?");
    expect(parsed?.nativeText).toBe('Hi! How are you?');
    expect(parsed?.detectedSourceLang).toBe('de');

    const byCode = parseBilingualChatJson('{"de":"Guten Morgen","en":"Good morning"}', 'de', 'en');
    expect(byCode?.learningText).toBe('Guten Morgen');
    expect(byCode?.nativeText).toBe('Good morning');
  });

  it('does not leak raw JSON into the bubble when the shape is incomplete', () => {
    expect(extractChatReplyText('{"reply":"Hallo!"}')).toBe('Hallo!');
    expect(parseBilingualChatJson('{"reply":"Hallo!"}', 'de', 'en')).toBeNull();
  });

  it('maps JSON-mode completion onto learning + native line translations', async () => {
    const completion = {
      isAvailable: () => true,
      complete: async () =>
        JSON.stringify({
          learning_text: 'Lass uns üben — du schriebst „heeyy“.',
          native_text: 'Let’s practice — you wrote “heeyy”.',
          detected_source_lang: 'de',
        }),
    };
    const result = await completeBilingualBotReply({
      completion,
      learnerText: 'heeyy',
      learningLang: 'de',
      nativeLang: 'en',
    });
    expect(result.sourceText).toMatch(/Lass uns üben/);
    expect(result.translations.some((row) => row.targetLang === 'de')).toBe(true);
    expect(result.translations.some((row) => row.targetLang === 'en')).toBe(true);
    const native = result.translations.find((row) => row.targetLang === 'en')?.text ?? '';
    expect(native.toLowerCase()).toContain('practice');
  });
});
