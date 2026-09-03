import { describe, expect, it } from 'vitest';
import {
  ChatCompletionVocabularyCardAdapter,
  FakeVocabularyCardAdapter,
  InMemoryLearningItemRepository,
  createVocabularyWordTap,
  listTippedVocabularyCards,
  openOrCreateVocabularyCard,
  parseGeneratedVocabularyCard,
  resolveVocabCardLanguage,
  sortTippedVocabularyCards,
} from './vocabulary';
import type { ChatCompletionPort } from '@/ports/ports';
import type { LearningItem, LearningSource } from '@/domain/learning';
import { learningItemIdentityKey } from '@/domain/learning';
import { inferVocabLanguageFromWord } from '@/gigolingo-shared/languages';

const source: LearningSource = {
  kind: 'chat',
  conversationId: 'c1',
  messageId: 'm1',
  lineIndex: 0,
};

describe('inferVocabLanguageFromWord', () => {
  it('treats kana as Japanese even when the bubble is English', () => {
    expect(inferVocabLanguageFromWord('通ではありません', 'en')).toBe('ja');
    expect(resolveVocabCardLanguage('通ではありません', 'en')).toBe('ja');
  });

  it('keeps Latin tokens on the bubble language', () => {
    expect(inferVocabLanguageFromWord('normal', 'en')).toBe('en');
    expect(inferVocabLanguageFromWord('aber', 'de')).toBe('de');
  });

  it('treats hangul as Korean', () => {
    expect(inferVocabLanguageFromWord('안녕하세요', 'en')).toBe('ko');
  });

  it('keeps hanzi-only on a Chinese bubble and defaults other CJK to Japanese', () => {
    expect(inferVocabLanguageFromWord('通', 'zh')).toBe('zh');
    expect(inferVocabLanguageFromWord('通', 'en')).toBe('ja');
  });
});

function completionReturning(body: string): ChatCompletionPort {
  return {
    isAvailable: () => true,
    complete: async () => body,
  };
}

describe('parseGeneratedVocabularyCard', () => {
  it('reads Gigolingo JSON fields and drops reading for Latin scripts', () => {
    const parsed = parseGeneratedVocabularyCard(
      '```json\n{"word":"Hallo","translation":"Hello","sentenceOrig":"Hallo Welt","sentenceEng":"Hello world","reading":"hah-lo","languageLevel":"A1","frequency":"high"}\n```',
      { word: 'Hallo', sentence: 'Hallo Welt', language: 'de' }
    );
    expect(parsed?.translation).toBe('Hello');
    expect(parsed?.languageLevel).toBe('A1');
    expect(parsed?.reading).toBe('');
  });

  it('keeps hiragana reading for Japanese even when the bubble language is English', () => {
    const parsed = parseGeneratedVocabularyCard(
      JSON.stringify({
        word: '通ではありません',
        reading: 'とおりではありません',
        translation: 'not normal',
        sentenceOrig: 'Ja aber ich bin nicht normal',
        sentenceEng: 'Yes, but I am not normal',
        sentenceReading: 'や あべる いち びん にひと のーまる',
        languageLevel: 'A2',
        frequency: 'medium',
      }),
      { word: '通ではありません', sentence: 'Ja aber ich bin nicht normal', language: 'en' }
    );
    expect(parsed?.language).toBe('ja');
    expect(parsed?.reading).toBe('とおりではありません');
    expect(parsed?.sentenceReading).toBeUndefined();
  });

  it('falls back to the word as reading when Japanese reading is omitted', () => {
    const parsed = parseGeneratedVocabularyCard(
      JSON.stringify({
        word: 'こんにちは',
        translation: 'hello',
        sentenceOrig: 'こんにちは',
        sentenceEng: 'Hello',
      }),
      { word: 'こんにちは', sentence: 'こんにちは', language: 'ja' }
    );
    expect(parsed?.reading).toBe('こんにちは');
  });
});

describe('openOrCreateVocabularyCard', () => {
  it('same word+lang+source refetches the same id instead of inserting a second row', async () => {
    const items = new InMemoryLearningItemRepository();
    const cards = new FakeVocabularyCardAdapter();
    const input = {
      userId: 'u1',
      word: 'Hallo!!',
      sentence: 'Hallo Welt',
      language: 'de',
      source,
    };
    const first = await openOrCreateVocabularyCard({ cards, items }, input);
    const second = await openOrCreateVocabularyCard(
      { cards, items },
      { ...input, word: ' hallo ', sentence: 'Hallo Welt — again' }
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.sentenceOrig).toBe(first.item.sentenceOrig);
    const listed = await items.listForUser('u1');
    expect(listed).toHaveLength(1);
  });

  it('different source or language creates a distinct card', async () => {
    const items = new InMemoryLearningItemRepository();
    const cards = new FakeVocabularyCardAdapter();
    const first = await openOrCreateVocabularyCard(
      { cards, items },
      { userId: 'u1', word: 'Hallo', sentence: 'Hallo Welt', language: 'de', source }
    );
    const otherLine = await openOrCreateVocabularyCard(
      { cards, items },
      {
        userId: 'u1',
        word: 'Hallo',
        sentence: 'Hallo dort',
        language: 'de',
        source: { ...source, lineIndex: 1 },
      }
    );
    const otherLang = await openOrCreateVocabularyCard(
      { cards, items },
      { userId: 'u1', word: 'Hallo', sentence: 'Hallo Welt', language: 'en', source }
    );
    expect(otherLine.created).toBe(true);
    expect(otherLang.created).toBe(true);
    expect(otherLine.item.id).not.toBe(first.item.id);
    expect(otherLang.item.id).not.toBe(first.item.id);
    expect(await items.listForUser('u1')).toHaveLength(3);
  });

  it('stores the voc card id as vocab:word|lang|chat:conversation:message:line', async () => {
    const items = new InMemoryLearningItemRepository();
    const cards = new FakeVocabularyCardAdapter();
    const chatSource: LearningSource = {
      kind: 'chat',
      conversationId: 'dm:826f721f-bdf4-4dbe-9136-c7264c03d8e9:93ad4a02-25a7-4787-ae01-a40c3000d637',
      messageId: 'ba95d3b3-679d-4e02-b2de-10bfec161ec6',
      lineIndex: 1,
    };
    const result = await openOrCreateVocabularyCard(
      { cards, items },
      { userId: 'u1', word: 'm', sentence: 'm', language: 'en', source: chatSource }
    );
    expect(result.created).toBe(true);
    expect(result.item.id).toBe(`vocab:${learningItemIdentityKey('m', 'en', chatSource)}`);
    expect(result.item.id).toBe(
      'vocab:m|en|chat:dm:826f721f-bdf4-4dbe-9136-c7264c03d8e9:93ad4a02-25a7-4787-ae01-a40c3000d637:ba95d3b3-679d-4e02-b2de-10bfec161ec6:1'
    );
    const again = await openOrCreateVocabularyCard(
      { cards, items },
      { userId: 'u1', word: 'm', sentence: 'm', language: 'en', source: chatSource }
    );
    expect(again.created).toBe(false);
    expect(again.item.id).toBe(result.item.id);
  });

  it('uses Gigolingo getVocabularyCardPrompt via the chat-completion adapter', async () => {
    const items = new InMemoryLearningItemRepository();
    const cards = new ChatCompletionVocabularyCardAdapter(
      completionReturning(
        JSON.stringify({
          word: 'mundo',
          translation: 'world',
          sentenceOrig: 'hola mundo',
          sentenceEng: 'hello world',
          languageLevel: 'A1',
          frequency: 'high',
        })
      )
    );
    const result = await openOrCreateVocabularyCard(
      { cards, items },
      {
        userId: 'u1',
        word: 'mundo',
        sentence: 'hola mundo',
        language: 'es',
        source,
      }
    );
    expect(result.item.translation).toBe('world');
    expect(result.item.languageLevel).toBe('A1');
  });

  it('saves Japanese tipped on an EN line as JA with hiragana from the Gigolingo prompt', async () => {
    const items = new InMemoryLearningItemRepository();
    let captured = '';
    const cards = new ChatCompletionVocabularyCardAdapter({
      isAvailable: () => true,
      complete: async (messages) => {
        captured = messages.map((message) => message.content).join('\n');
        return JSON.stringify({
          word: '通ではありません',
          reading: 'とおりではありません',
          translation: 'not normal',
          sentenceOrig: 'Ja aber ich bin nicht normal',
          sentenceEng: 'Yes, but I am not normal',
          languageLevel: 'A2',
          frequency: 'medium',
        });
      },
    });
    const result = await openOrCreateVocabularyCard(
      { cards, items },
      {
        userId: 'u1',
        word: '通ではありません',
        sentence: 'Ja aber ich bin nicht normal',
        language: 'en',
        source,
      }
    );
    expect(result.created).toBe(true);
    expect(result.item.language).toBe('ja');
    expect(result.item.reading).toBe('とおりではありません');
    expect(result.item.translation).toBe('not normal');
    expect(captured).toContain('expert Japanese language teacher');
    expect(captured).toContain('Must be in hiragana for kanji words');
    expect(result.item.id).toBe(`vocab:${learningItemIdentityKey('通ではありません', 'ja', source)}`);

    const again = await openOrCreateVocabularyCard(
      { cards, items },
      {
        userId: 'u1',
        word: '通ではありません',
        sentence: 'Ja aber ich bin nicht normal',
        language: 'en',
        source,
      }
    );
    expect(again.created).toBe(false);
    expect(again.item.id).toBe(result.item.id);
  });
});

describe('tipped vocabulary list', () => {
  it('sorts newest tipped cards first for the home rail', async () => {
    const older = {
      word: 'alt',
      translation: 'old',
      sentenceOrig: 'alt',
      sentenceEng: 'old',
      reading: '',
      userId: 'u1',
      dateAdded: new Date('2026-01-01T00:00:00Z'),
      source,
    };
    const newer = {
      word: 'neu',
      translation: 'new',
      sentenceOrig: 'neu',
      sentenceEng: 'new',
      reading: '',
      userId: 'u1',
      dateAdded: new Date('2026-09-01T00:00:00Z'),
      source: { ...source, messageId: 'm2' },
    };
    expect(sortTippedVocabularyCards([older, newer]).map((item) => item.word)).toEqual(['neu', 'alt']);
    const items = new InMemoryLearningItemRepository();
    await items.save(older);
    await items.save(newer);
    expect((await listTippedVocabularyCards(items, 'u1')).map((item) => item.word)).toEqual(['neu', 'alt']);
  });

  it('word tap opens the same card id on a second press', async () => {
    const items = new InMemoryLearningItemRepository();
    const cards = new FakeVocabularyCardAdapter();
    const opened: string[] = [];
    const wordTap = createVocabularyWordTap({
      userId: () => 'u1',
      cards,
      items,
      onOpen: (result) => {
        if (result.item.id) opened.push(result.item.id);
      },
    });
    await wordTap.onPress({ token: 'Hallo', sentence: 'Hallo Welt', language: 'de', source });
    await wordTap.onPress({ token: 'Hallo', sentence: 'Hallo Welt', language: 'de', source });
    expect(opened).toHaveLength(2);
    expect(opened[0]).toBe(opened[1]);
    expect(await items.listForUser('u1')).toHaveLength(1);
  });

  it('word tap of Japanese on an EN bubble saves JA with a reading', async () => {
    const items = new InMemoryLearningItemRepository();
    const cards = new FakeVocabularyCardAdapter();
    const opened: LearningItem[] = [];
    const wordTap = createVocabularyWordTap({
      userId: () => 'u1',
      cards,
      items,
      onOpen: (result) => {
        opened.push(result.item);
      },
    });
    await wordTap.onPress({
      token: '通ではありません',
      sentence: 'Ja aber ich bin nicht normal',
      language: 'en',
      source,
    });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.language).toBe('ja');
    expect(opened[0]?.reading).toBe('通ではありません');
  });
});
