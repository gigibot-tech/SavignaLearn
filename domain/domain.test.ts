import { describe, expect, it } from 'vitest';
import { translateMessageForViewer } from '@/adapters/translation';
import {
  assembleLineTranslations,
  createInterlinearFormat,
  createLearnerViewpoint,
  createLearningItem,
  findMatchingLearningItem,
  fromMediaBlock,
  hasInterlinearFormat,
  isUsableBirkenbihlOverlay,
  learningItemIdentityKey,
  learningSourceKey,
  normalizeLanguageCode,
  parseInterlinear,
  planLineJobs,
  receiptMark,
  renderViewpoint,
  sourceMessageFromImage,
  sourceMessageFromText,
  splitSourceLines,
  toGigolingoLangKey,
  toGigolingoSourceMediaId,
  tokenizeText,
  toMediaBlock,
  translationMismatch,
  translationRetryWhy,
  joinSelectionAsSentence,
  joinOriginalsFromSelection,
  splitTextWithTokens,
  tokenAtCharOffset,
} from './index';
import { EchoTranslationEngine } from '@/adapters/translation';

describe('language', () => {
  it('normalizes two-letter codes', () => {
    expect(normalizeLanguageCode('DE')).toBe('de');
    expect(toGigolingoLangKey('de')).toBe('DE');
  });
});

describe('viewpoint', () => {
  it('rejects identical native and learning languages', () => {
    expect(() =>
      createLearnerViewpoint({ native: 'de', learning: 'de', displayMode: 'lines' })
    ).toThrow();
  });
});

describe('splitSourceLines', () => {
  it('splits lyrics-style messages', () => {
    expect(splitSourceLines('Hallo\nwie gehts')).toEqual(['Hallo', 'wie gehts']);
  });
});

describe('renderViewpoint', () => {
  it('alternates learning then native lines per viewer', () => {
    const message = sourceMessageFromText({
      id: 'm1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'de',
      sourceText: 'Guten Morgen',
    });
    const view = renderViewpoint(
      message,
      [{ lineIndex: 0, targetLang: 'en', text: 'Good morning', mode: 'lines' }],
      { native: 'de', learning: 'en', displayMode: 'lines' }
    );
    expect(view[0].learningText).toBe('Good morning');
    expect(view[0].nativeText).toBe('Guten Morgen');
    expect(view[0].learningLangTag).toBe('en');
    expect(view[0].nativeLangTag).toBe('de');
  });

  it('does not tag source text as the learning language when there is no translation', () => {
    const message = sourceMessageFromText({
      id: 'm-de',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'de',
      sourceText: 'heeyy du wilder',
    });
    const view = renderViewpoint(message, [], {
      native: 'de',
      learning: 'es',
      displayMode: 'lines',
    });
    expect(view[0].learningText).toBe('heeyy du wilder');
    expect(view[0].learningLangTag).toBe('de');
  });

  it('uses a different learning language for the other viewer', () => {
    const message = sourceMessageFromText({
      id: 'm1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'de',
      sourceText: 'Guten Morgen',
    });
    const view = renderViewpoint(
      message,
      [{ lineIndex: 0, targetLang: 'fr', text: 'Bonjour', mode: 'lines' }],
      { native: 'en', learning: 'fr', displayMode: 'lines' }
    );
    expect(view[0].learningText).toBe('Bonjour');
  });

  it('does not invent Birkenbihl interlinear from lines/native text', () => {
    const message = sourceMessageFromText({
      id: 'm-es',
      conversationId: 'c1',
      authorId: 'bot',
      sourceLang: 'es',
      sourceText: '¿Por qué es así?',
    });
    const view = renderViewpoint(
      message,
      [
        { lineIndex: 0, targetLang: 'de', text: 'Warum ist es so?', mode: 'lines' },
        { lineIndex: 0, targetLang: 'en', text: 'Why is it this', mode: 'lines' },
      ],
      { native: 'en', learning: 'es', displayMode: 'birkenbihl' }
    );
    expect(view[0].sourceText).toBe('¿Por qué es así?');
    expect(view[0].birkenbihl).toBeUndefined();
    expect(view[0].birkenbihl ?? '').not.toMatch(/Warum|Why is it this/);
  });

  it('tags an own I-speak bubble as native even when a learning translation exists', () => {
    const message = sourceMessageFromText({
      id: 'm-own',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'en',
      sourceText: 'what would be some words like tarjeta?',
    });
    const view = renderViewpoint(
      message,
      [{ lineIndex: 0, targetLang: 'es', text: '¿Cuáles serían palabras como tarjeta?', mode: 'lines' }],
      { native: 'en', learning: 'es', displayMode: 'lines' },
      { own: true }
    );
    expect(view[0].learningText).toBe('what would be some words like tarjeta?');
    expect(view[0].learningLangTag).toBe('en');
    expect(view[0].nativeText).toBe('¿Cuáles serían palabras como tarjeta?');
    expect(view[0].nativeLangTag).toBe('es');
  });

  it('does not paint the same string as two semantic slots for an own bubble', () => {
    const message = sourceMessageFromText({
      id: 'm-own-dup',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'en',
      sourceText: 'Hello',
    });

    const view = renderViewpoint(
      message,
      [
        // After a settings swap, a stale or malformed translation row might contain the
        // original source string for the current learning target. That must not show up
        // as both the native and learning strings for the same bubble.
        // Intentionally use a different casing to mimic "same-language" retranslation artifacts.
        { lineIndex: 0, targetLang: 'es', text: 'hello', mode: 'lines' },
      ],
      { native: 'en', learning: 'es', displayMode: 'lines' },
      { own: true }
    );

    expect(view[0].learningText).toBe('Hello');
    expect(view[0].nativeText).toBe('');
    expect(view[0].nativeLangTag).toBe('en');
  });

  it('does not paint the same string as two languages for a bad Birkenbihl overlay', () => {
    const message = sourceMessageFromText({
      id: 'm-dup',
      conversationId: 'c1',
      authorId: 'bot',
      sourceLang: 'es',
      sourceText: 'Algunas palabras similares son billete.',
    });
    const same = 'Algunas palabras similares son billete.';
    const view = renderViewpoint(
      message,
      [
        { lineIndex: 0, targetLang: 'es', text: same, mode: 'lines' },
        { lineIndex: 0, targetLang: 'en', text: same, mode: 'lines' },
        { lineIndex: 0, targetLang: 'en', text: `${same} [${same}]`, mode: 'birkenbihl' },
      ],
      { native: 'en', learning: 'es', displayMode: 'birkenbihl' }
    );
    expect(view[0].birkenbihl).toBeUndefined();
    expect(view[0].learningText).toBe(same);
    expect(view[0].learningLangTag).toBe('es');
    expect(view[0].nativeText).toBe('');
    expect(view[0].nativeLangTag).not.toBe('en');
  });

  it('renders stored Birkenbihl translations and still keeps lines rows', () => {
    const message = sourceMessageFromText({
      id: 'm-es',
      conversationId: 'c1',
      authorId: 'bot',
      sourceLang: 'es',
      sourceText: '¿Por qué es así?',
    });
    const stored = '¿Por [Why] qué [is] es [it] así [so]?';
    const view = renderViewpoint(
      message,
      [
        { lineIndex: 0, targetLang: 'es', text: '¿Por qué es así?', mode: 'lines' },
        { lineIndex: 0, targetLang: 'en', text: 'Why is it like that?', mode: 'lines' },
        { lineIndex: 0, targetLang: 'en', text: stored, mode: 'birkenbihl' },
      ],
      { native: 'en', learning: 'es', displayMode: 'birkenbihl' }
    );
    expect(view[0].birkenbihl).toBe(stored);
    expect(view[0].nativeText).toBe('Why is it like that?');
  });
});

describe('translationMismatch', () => {
  const viewpoint = { native: 'de', learning: 'es', displayMode: 'lines' as const };

  it('flags missing learning line when the bubble is still only source German', () => {
    const message = sourceMessageFromText({
      id: 'm-out',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'de',
      sourceText: 'heeyy du wilder',
    });
    expect(translationMismatch({ message, translations: [], viewpoint })).toBe('empty_pair');
    expect(translationRetryWhy('empty_pair')).toBe('Missing translation');
  });

  it('flags missing learning when other langs exist but not the learning target', () => {
    const message = sourceMessageFromText({
      id: 'm-learn',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'de',
      sourceText: 'heeyy du wilder',
    });
    expect(
      translationMismatch({
        message,
        translations: [{ lineIndex: 0, targetLang: 'de', mode: 'lines', text: 'heeyy du wilder' }],
        viewpoint,
      })
    ).toBe('missing_learning');
  });

  it('flags a stored learning row that copies source while target langs differ', () => {
    const message = sourceMessageFromText({
      id: 'm-same',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'de',
      sourceText: 'heeyy du wilder',
    });
    expect(
      translationMismatch({
        message,
        translations: [
          { lineIndex: 0, targetLang: 'es', mode: 'lines', text: 'heeyy du wilder' },
        ],
        viewpoint,
      })
    ).toBe('same_as_source');
    expect(translationRetryWhy('same_as_source')).toBe('Language mismatch');
  });

  it('clears language mismatch once sourceLang matches the real language', () => {
    const sourceText = 'No te envío fotos de mis huevos, eso es privado.';
    const message = sourceMessageFromText({
      id: 'm-retag',
      conversationId: 'c1',
      authorId: 'them',
      sourceLang: 'es',
      sourceText,
    });
    expect(
      translationMismatch({
        message,
        translations: [
          {
            lineIndex: 0,
            targetLang: 'en',
            mode: 'lines',
            text: "I'm not sending you pictures of my eggs, that's private.",
          },
        ],
        viewpoint: { native: 'en', learning: 'es', displayMode: 'lines' },
      })
    ).toBeNull();
  });

  it('flags missing native line when native should differ from source', () => {
    const message = sourceMessageFromText({
      id: 'm-in',
      conversationId: 'c1',
      authorId: 'them',
      sourceLang: 'en',
      sourceText: 'hey you',
    });
    expect(
      translationMismatch({
        message,
        translations: [{ lineIndex: 0, targetLang: 'es', mode: 'lines', text: 'hola tú' }],
        viewpoint: { native: 'de', learning: 'es', displayMode: 'lines' },
      })
    ).toBe('missing_native');
  });

  it('flags Birkenbihl mode with no stored overlay', () => {
    const message = sourceMessageFromText({
      id: 'm-bb',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'de',
      sourceText: 'Hallo',
    });
    expect(
      translationMismatch({
        message,
        translations: [{ lineIndex: 0, targetLang: 'es', mode: 'lines', text: 'Hola' }],
        viewpoint: { native: 'de', learning: 'es', displayMode: 'birkenbihl' },
      })
    ).toBe('missing_birkenbihl');
  });

  it('does not flag a complete pair or stickers', () => {
    const message = sourceMessageFromText({
      id: 'm-ok',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'de',
      sourceText: 'Hallo',
    });
    expect(
      translationMismatch({
        message,
        translations: [
          { lineIndex: 0, targetLang: 'es', mode: 'lines', text: 'Hola' },
          { lineIndex: 0, targetLang: 'de', mode: 'lines', text: 'Hallo' },
        ],
        viewpoint,
      })
    ).toBeNull();
    const sticker = sourceMessageFromImage({
      id: 'st',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'de',
      imageUrl: 'sticker:slay',
      mediaKind: 'sticker',
    });
    expect(translationMismatch({ message: sticker, translations: [], viewpoint })).toBeNull();
  });
});

describe('birkenbihl', () => {
  it('parses word [hint] segments', () => {
    const segments = parseInterlinear('Hallo [Hello] Welt [world]');
    expect(segments).toEqual([
      { original: 'Hallo', translation: 'Hello' },
      { original: 'Welt', translation: 'world' },
    ]);
    expect(hasInterlinearFormat('Hallo [Hello]')).toBe(true);
    expect(createInterlinearFormat('Hallo Welt', 'Hello world')).toContain('[');
  });

  it('rejects same-string overlays as unusable Birkenbihl', () => {
    expect(isUsableBirkenbihlOverlay('Hola [Hi] mundo [world]')).toBe(true);
    expect(isUsableBirkenbihlOverlay('Hola [Hola] mundo [mundo]')).toBe(false);
    expect(isUsableBirkenbihlOverlay('Hola mundo')).toBe(false);
  });
});

describe('tokenizeText', () => {
  it('splits spaced languages', () => {
    expect(tokenizeText('hola mundo', 'es')).toEqual(['hola', 'mundo']);
  });

  it('does not CJK-split German when the learning picker is Japanese', () => {
    expect(tokenizeText('Guten Morgen', 'ja')).toEqual(['Guten', 'Morgen']);
  });
});

describe('chat copy helpers', () => {
  it('joins one-word-per-line clipboard text into a sentence', () => {
    expect(joinSelectionAsSentence('Y\nel\nque\ntengo\nuna\nfoto')).toBe(
      'Y el que tengo una foto'
    );
  });

  it('keeps an already-normal sentence', () => {
    expect(joinSelectionAsSentence('Y el que tengo una foto')).toBe(
      'Y el que tengo una foto'
    );
  });

  it('preserves spaces when splitting tokens back onto the source line', () => {
    const text = 'Y el que tengo una foto…';
    const tokens = tokenizeText(text, 'es');
    const pieces = splitTextWithTokens(text, tokens);
    expect(pieces.map((piece) => piece.value).join('')).toBe(text);
    expect(pieces.filter((piece) => piece.kind === 'gap').every((piece) => piece.value.includes(' '))).toBe(
      true
    );
  });

  it('maps a caret offset onto the token under that character', () => {
    const text = 'Y el que';
    const tokens = ['Y', 'el', 'que'];
    expect(tokenAtCharOffset(text, tokens, 0)).toBe('Y');
    expect(tokenAtCharOffset(text, tokens, 2)).toBe('el');
    expect(tokenAtCharOffset(text, tokens, 1)).toBe('el');
  });

  it('prefers original words when Birkenbihl columns copy stacked glosses', () => {
    expect(
      joinOriginalsFromSelection('Hallo\nHello\nWelt\nworld', ['Hallo', 'Welt'])
    ).toBe('Hallo Welt');
  });
});

describe('media line mappers', () => {
  it('round-trips a chat message into a Gigolingo-shaped block', () => {
    const message = sourceMessageFromText({
      id: 'm1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'ja',
      sourceText: 'こんにちは',
    });
    const block = toMediaBlock(message.id, message.lines, { en: ['hello'] });
    expect(block.lines[0].content).toBe('こんにちは');
    expect(block.lines[0].en).toBe('hello');
    expect(fromMediaBlock(block)[0].content).toBe('こんにちは');
  });
});

describe('learning item source', () => {
  it('keeps chat sources off sourceMediaId', () => {
    const item = createLearningItem({
      word: 'Hallo',
      translation: 'Hello',
      sentenceOrig: 'Hallo Welt',
      sentenceEng: 'Hello world',
      source: { kind: 'chat', conversationId: 'c1', messageId: 'm1', lineIndex: 0 },
    });
    expect(toGigolingoSourceMediaId(item.source)).toBeUndefined();
    expect(learningSourceKey(item.source)).toContain('chat:');
  });

  it('same word+lang+source maps to the same card identity', () => {
    const source = { kind: 'chat' as const, conversationId: 'c1', messageId: 'm1', lineIndex: 0 };
    const first = createLearningItem({
      id: 'card-1',
      word: 'Hallo',
      translation: 'Hello',
      sentenceOrig: 'Hallo Welt',
      sentenceEng: 'Hello world',
      language: 'de',
      source,
    });
    expect(learningItemIdentityKey('Hallo!!', 'DE', source)).toBe(
      learningItemIdentityKey(' hallo ', 'de', source)
    );
    expect(findMatchingLearningItem([first], { word: 'Hallo,', language: 'de', source })?.id).toBe(
      'card-1'
    );
    expect(
      findMatchingLearningItem([first], {
        word: 'Hallo',
        language: 'de',
        source: { ...source, lineIndex: 1 },
      })
    ).toBeUndefined();
    expect(findMatchingLearningItem([first], { word: 'Hallo', language: 'es', source })).toBeUndefined();
  });

  it('builds the voc card id from word, lang, and chat line source', () => {
    const source = {
      kind: 'chat' as const,
      conversationId: 'dm:826f721f-bdf4-4dbe-9136-c7264c03d8e9:93ad4a02-25a7-4787-ae01-a40c3000d637',
      messageId: 'ba95d3b3-679d-4e02-b2de-10bfec161ec6',
      lineIndex: 1,
    };
    expect(learningItemIdentityKey('m', 'en', source)).toBe(
      'm|en|chat:dm:826f721f-bdf4-4dbe-9136-c7264c03d8e9:93ad4a02-25a7-4787-ae01-a40c3000d637:ba95d3b3-679d-4e02-b2de-10bfec161ec6:1'
    );
    expect(learningSourceKey(source)).toContain('ba95d3b3-679d-4e02-b2de-10bfec161ec6:1');
  });

  it('maps media sources to sourceMediaId', () => {
    expect(
      toGigolingoSourceMediaId({ kind: 'media', mediaId: 'song-1', mediaName: 'Track' })
    ).toBe('song-1');
  });
});

describe('translation job planning', () => {
  it('plans one job per line', () => {
    const jobs = planLineJobs('a\nb', 'en', 'lines');
    expect(jobs).toHaveLength(2);
    const assembled = assembleLineTranslations(['a', 'b'], ['A', 'B'], 'en', 'lines');
    expect(assembled[1].text).toBe('B');
  });
});

describe('receipts', () => {
  it('uses shape not only color', () => {
    expect(receiptMark('sent')).toBe('single');
    expect(receiptMark('delivered')).toBe('double');
    expect(receiptMark('read')).toBe('filled');
  });
});

describe('translateMessageForViewer', () => {
  it('translates each line through the engine', async () => {
    const engine = new EchoTranslationEngine();
    const result = await translateMessageForViewer({
      sourceText: 'Hallo Welt',
      sourceLang: 'de',
      targetLang: 'en',
      mode: 'lines',
      engine,
    });
    expect(result).toHaveLength(1);
    expect(result[0].targetLang).toBe('en');
    expect(result[0].text.toLowerCase()).toContain('hello');
  });
});
