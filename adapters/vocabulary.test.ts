import { describe, expect, it } from 'vitest';
import {
  ChatCompletionVocabularyCardAdapter,
  FakeVocabularyCardAdapter,
  InMemoryLearningItemRepository,
  createVocabularyWordTap,
  listTippedVocabularyCards,
  openOrCreateVocabularyCard,
  parseGeneratedVocabularyCard,
  sortTippedVocabularyCards,
} from './vocabulary';
import type { ChatCompletionPort } from '@/ports/ports';
import type { LearningSource } from '@/domain/learning';

const source: LearningSource = {
  kind: 'chat',
  conversationId: 'c1',
  messageId: 'm1',
  lineIndex: 0,
};

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
});
