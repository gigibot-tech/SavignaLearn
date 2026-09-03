import { describe, expect, it, vi } from 'vitest';
import {
  CircuitBreakerTranslationEngine,
  EchoTranslationEngine,
  InMemoryChatHistoryStore,
  completeBilingualBotReply,
  processOutgoingTranslation,
  recalculateBirkenbihlForMessage,
  recalculateBirkenbihlForThread,
  retryBubbleTranslations,
} from '@/adapters/translation';
import { sourceMessageFromText } from './chat';
import {
  buildBirkenbihlTranslatePrompt,
  buildBilingualChatPrompt,
  buildDetectThenTranslatePrompt,
  buildTranslationPayload,
  createChatHistoryRecord,
  dropIdentityLineTranslations,
  extractChatReplyText,
  mergeLineTranslations,
  mergeTranslationMaps,
  mergeTranslationsByMode,
  parseBilingualChatJson,
  parseDetectThenTranslateJson,
  toDisplayMode,
  transitionChatHistory,
  type AsymmetricLanguageContext,
} from './pipeline';

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
    expect(systemPrompt).toMatch(/square brackets/i);
    expect(systemPrompt).toContain('Hola [Hi] mundo [world]');
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

    record = transitionChatHistory(record, { type: 'start_detect' });
    expect(record.pipelineState).toBe('detecting');
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

  it('parses bilingual JSON with camelCase keys', () => {
    const parsed = parseBilingualChatJson(
      '{"learningText":"Hallo! Wie geht\\u0027s dir?","nativeText":"Hi! How are you?","detectedSourceLang":"de"}',
      'de',
      'en'
    );
    expect(parsed?.learningText).toBe("Hallo! Wie geht's dir?");
    expect(parsed?.nativeText).toBe('Hi! How are you?');
    expect(parsed?.detectedSourceLang).toBe('de');
  });

  it('does not leak raw JSON into the bubble when the shape is incomplete', () => {
    expect(extractChatReplyText('{"reply":"Hallo!"}')).toBe('Hallo!');
    expect(parseBilingualChatJson('{"reply":"Hallo!"}', 'de', 'en')).toBeNull();
    expect(
      parseBilingualChatJson(
        '{"learning_text":"Algunas palabras similares son billete.","native_text":"Algunas palabras similares son billete.","detected_source_lang":"es"}',
        'es',
        'en'
      )
    ).toBeNull();
    expect(parseBilingualChatJson('{"es":"Hola","en":"Hola"}', 'es', 'en')).toBeNull();
  });

  it('does not drop a stored native lines row when a later snapshot is incomplete', () => {
    const stored = [
      { lineIndex: 0, targetLang: 'es', mode: 'lines' as const, text: 'Algunas palabras similares son billete.' },
      { lineIndex: 0, targetLang: 'en', mode: 'lines' as const, text: 'Some similar words are ticket.' },
    ];
    const incompleteReload = [
      { lineIndex: 0, targetLang: 'es', mode: 'lines' as const, text: 'Algunas palabras similares son billete.' },
    ];
    const merged = mergeLineTranslations(stored, incompleteReload);
    expect(merged.find((row) => row.targetLang === 'en')?.text).toBe('Some similar words are ticket.');
    expect(merged.find((row) => row.targetLang === 'es')?.text).toMatch(/Algunas/);

    const maps = mergeTranslationMaps(
      { bot: stored },
      { bot: incompleteReload, other: [{ lineIndex: 0, targetLang: 'de', mode: 'lines', text: 'Hallo' }] }
    );
    expect(maps.bot?.find((row) => row.targetLang === 'en')?.text).toBe('Some similar words are ticket.');
    expect(maps.other?.[0]?.text).toBe('Hallo');
  });

  it('maps JSON-mode completion onto learning + native line translations', async () => {
    const completion = {
      isAvailable: () => true,
      complete: async () =>
        JSON.stringify({
          learning_text: 'Lass uns üben — du schriebst „heeyy“.',
          native_text: 'Let’s practice — you wrote “heeyy”.',
          // Model detection may be wrong; we still trust `learningLang`.
          detected_source_lang: 'en',
        }),
    };
    const result = await completeBilingualBotReply({
      completion,
      learnerText: 'heeyy',
      learningLang: 'de',
      nativeLang: 'en',
    });
    expect(result.sourceText).toMatch(/Lass uns üben/);
    expect(result.sourceLang).toBe('de');
    expect(result.translations.some((row) => row.targetLang === 'de')).toBe(true);
    expect(result.translations.some((row) => row.targetLang === 'en')).toBe(true);
    const native = result.translations.find((row) => row.targetLang === 'en')?.text ?? '';
    expect(native.toLowerCase()).toContain('practice');
  });

  it('keeps Retry — same-string bilingual JSON does not become two line translations', async () => {
    const completion = {
      isAvailable: () => true,
      complete: async () =>
        JSON.stringify({
          learning_text: 'Algunas palabras similares son billete.',
          native_text: 'Algunas palabras similares son billete.',
          detected_source_lang: 'es',
        }),
    };
    const result = await completeBilingualBotReply({
      completion,
      learnerText: 'what would be some words like tarjeta?',
      learningLang: 'es',
      nativeLang: 'en',
    });
    expect(result.translations).toEqual([]);
  });

  it('uses a pair-existing prompt that does not write a new reply', () => {
    const { systemPrompt, userPrompt } = buildBilingualChatPrompt({
      learningLang: 'es',
      nativeLang: 'de',
      learnerText: 'heeyy du wilder',
      pairExisting: true,
    });
    expect(systemPrompt).toMatch(/EXISTING chat message/);
    expect(systemPrompt).not.toMatch(/Write a short 1-3 line reply/);
    expect(userPrompt).toContain('existing_message:');
    expect(userPrompt).toContain('heeyy du wilder');
  });
});

describe('retryBubbleTranslations', () => {
  it('does not wipe sourceText when recalculating Standard lines', async () => {
    const store = new InMemoryChatHistoryStore();
    const message = sourceMessageFromText({
      id: 'm-retry',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'de',
      sourceText: 'heeyy du wilder',
      kind: 'user',
    });
    const birken = {
      lineIndex: 0,
      targetLang: 'de',
      mode: 'birkenbihl' as const,
      text: 'heeyy [hey] du [you] wilder [wild]',
    };
    const next = await retryBubbleTranslations({
      message,
      existingTranslations: [birken],
      asymmetric: {
        senderUserId: 'u1',
        receiverUserId: 'u2',
        senderLearningLang: 'es',
        receiverLearningLang: 'en',
        senderNativeLang: 'de',
        receiverNativeLang: 'en',
      },
      mode: 'standard',
      engine: new EchoTranslationEngine(),
      historyStore: store,
      learningLang: 'es',
      nativeLang: 'de',
    });
    expect(message.sourceText).toBe('heeyy du wilder');
    expect(next.some((row) => row.mode === 'birkenbihl' && row.text === birken.text)).toBe(true);
    expect(next.some((row) => row.mode === 'lines')).toBe(true);
  });

  it('keeps sourceText when a bot JSON pair recalc runs', async () => {
    const store = new InMemoryChatHistoryStore();
    const message = sourceMessageFromText({
      id: 'm-ai',
      conversationId: 'c1',
      authorId: 'savigna-ai',
      sourceLang: 'es',
      sourceText: '¿Qué tal?',
      kind: 'ai',
    });
    const completion = {
      isAvailable: () => true,
      complete: async () =>
        JSON.stringify({
          learning_text: '¿Qué tal?',
          native_text: 'Wie geht’s?',
          detected_source_lang: 'es',
        }),
    };
    const next = await retryBubbleTranslations({
      message,
      existingTranslations: [],
      asymmetric,
      mode: 'standard',
      engine: new EchoTranslationEngine(),
      historyStore: store,
      completion,
      learningLang: 'es',
      nativeLang: 'de',
    });
    expect(message.sourceText).toBe('¿Qué tal?');
    expect(next.some((row) => row.targetLang === 'de' && row.text.includes('Wie'))).toBe(true);
  });

  it('updates only missing native lines (preserves learning + other native lines)', async () => {
    const store = new InMemoryChatHistoryStore();
    const message = sourceMessageFromText({
      id: 'm-ai-missing-native',
      conversationId: 'c1',
      authorId: 'savigna-ai',
      sourceLang: 'de',
      sourceText: 'a0\na1',
      kind: 'ai',
    });

    const existingTranslations = [
      // Learning lines already correct — must stay unchanged.
      { lineIndex: 0, targetLang: 'de', mode: 'lines' as const, text: 'LEARN0' },
      { lineIndex: 1, targetLang: 'de', mode: 'lines' as const, text: 'LEARN1' },
      // Native: line 0 missing, line 1 present — must preserve line 1.
      { lineIndex: 0, targetLang: 'en', mode: 'lines' as const, text: '' },
      { lineIndex: 1, targetLang: 'en', mode: 'lines' as const, text: 'NATIVE1_OK' },
    ];

    const completion = {
      isAvailable: () => true,
      complete: async () =>
        JSON.stringify({
          learning_text: 'LEARN0_REGEN\nLEARN1_REGEN',
          native_text: 'NATIVE0_NEW\nNATIVE1_WRONG',
          detected_source_lang: 'en',
        }),
    };

    const next = await retryBubbleTranslations({
      message,
      existingTranslations,
      asymmetric,
      mode: 'standard',
      engine: new EchoTranslationEngine(),
      historyStore: store,
      completion,
      learningLang: 'de',
      nativeLang: 'en',
      mismatchReason: 'missing_native',
    });

    const learning0 = next.find((r) => r.targetLang === 'de' && r.lineIndex === 0)?.text;
    const learning1 = next.find((r) => r.targetLang === 'de' && r.lineIndex === 1)?.text;
    expect(learning0).toBe('LEARN0');
    expect(learning1).toBe('LEARN1');

    const native0 = next.find((r) => r.targetLang === 'en' && r.lineIndex === 0)?.text;
    const native1 = next.find((r) => r.targetLang === 'en' && r.lineIndex === 1)?.text;
    expect(native0).toBe('NATIVE0_NEW');
    expect(native1).toBe('NATIVE1_OK');
  });

  it('re-detects Spanish tagged as EN, drops the identity ES row, and keeps a real EN gloss', async () => {
    const store = new InMemoryChatHistoryStore();
    const sourceText = 'No te envío fotos de mis huevos, eso es privado.';
    const message = sourceMessageFromText({
      id: 'm-es-as-en',
      conversationId: 'c1',
      authorId: 'them',
      sourceLang: 'en',
      sourceText,
      kind: 'user',
    });
    const next = await retryBubbleTranslations({
      message,
      existingTranslations: [
        { lineIndex: 0, targetLang: 'es', mode: 'lines', text: sourceText },
        {
          lineIndex: 0,
          targetLang: 'en',
          mode: 'lines',
          text: "I'm not sending you pictures of my eggs, that's private.",
        },
      ],
      asymmetric,
      mode: 'standard',
      engine: new EchoTranslationEngine(),
      historyStore: store,
      learningLang: 'es',
      nativeLang: 'en',
      mismatchReason: 'same_as_source',
    });
    expect(message.sourceLang).toBe('es');
    expect(message.sourceText).toBe(sourceText);
    expect(next.some((row) => row.targetLang === 'es' && row.text === sourceText)).toBe(false);
    expect(next.find((row) => row.targetLang === 'en' && row.mode === 'lines')?.text).toBe(
      "I'm not sending you pictures of my eggs, that's private."
    );
  });
});

describe('dropIdentityLineTranslations', () => {
  it('removes a Standard row that copies source into the source language', () => {
    const source = 'No te envío fotos.';
    expect(
      dropIdentityLineTranslations(
        [
          { lineIndex: 0, targetLang: 'es', mode: 'lines', text: source },
          { lineIndex: 0, targetLang: 'en', mode: 'lines', text: 'I am not sending photos.' },
        ],
        source,
        'es'
      )
    ).toEqual([{ lineIndex: 0, targetLang: 'en', mode: 'lines', text: 'I am not sending photos.' }]);
  });
});
