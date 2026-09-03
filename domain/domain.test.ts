import { describe, expect, it } from 'vitest';
import { translateMessageForViewer } from '@/adapters/translation';
import {
  assembleLineTranslations,
  createInterlinearFormat,
  createLearnerViewpoint,
  createLearningItem,
  fromMediaBlock,
  hasInterlinearFormat,
  learningSourceKey,
  normalizeLanguageCode,
  parseInterlinear,
  planLineJobs,
  receiptMark,
  renderViewpoint,
  sourceMessageFromText,
  splitSourceLines,
  toGigolingoLangKey,
  toGigolingoSourceMediaId,
  tokenizeText,
  toMediaBlock,
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
});

describe('tokenizeText', () => {
  it('splits spaced languages', () => {
    expect(tokenizeText('hola mundo', 'es')).toEqual(['hola', 'mundo']);
  });

  it('does not CJK-split German when the learning picker is Japanese', () => {
    expect(tokenizeText('Guten Morgen', 'ja')).toEqual(['Guten', 'Morgen']);
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
