import { describe, expect, it } from 'vitest';
import { sourceMessageFromImage, sourceMessageFromText } from './chat';
import { createLearningItem } from './learning';
import { conversationProfileStats } from './profileStats';

describe('conversationProfileStats', () => {
  it('counts visible messages, photos, and vocab from this chat', () => {
    const text = sourceMessageFromText({
      id: 'm1',
      conversationId: 'c1',
      authorId: 'them',
      sourceLang: 'de',
      sourceText: 'hallo',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const photo = sourceMessageFromImage({
      id: 'm2',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'en',
      imageUrl: 'https://example.com/p.jpg',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    const deleted = {
      ...text,
      id: 'm3',
      deletedAt: '2026-01-03T00:00:00.000Z',
      sourceText: '',
    };
    const stats = conversationProfileStats({
      messages: [text, photo, deleted],
      viewerIds: ['me'],
      conversationId: 'c1',
      vocab: [
        createLearningItem({
          word: 'hallo',
          translation: 'hello',
          sentenceOrig: 'hallo',
          sentenceEng: 'hello',
          source: { kind: 'chat', conversationId: 'c1', messageId: 'm1', lineIndex: 0 },
        }),
        createLearningItem({
          word: 'other',
          translation: 'other',
          sentenceOrig: 'other',
          sentenceEng: 'other',
          source: { kind: 'chat', conversationId: 'other', messageId: 'x', lineIndex: 0 },
        }),
      ],
    });
    expect(stats).toEqual({
      messageCount: 2,
      fromThem: 1,
      fromYou: 1,
      photos: 1,
      cards: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
