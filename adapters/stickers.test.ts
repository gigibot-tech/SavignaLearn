import { describe, expect, it } from 'vitest';
import {
  EchoTranslationEngine,
  InMemoryChatHistoryStore,
  processOutgoingTranslation,
} from '@/adapters/translation';
import { DEFAULT_STICKER_PACK, stickerMessageFromPack } from '@/adapters/stickers';
import { InMemoryChatRepository } from '@/adapters/memoryChat';
import {
  conversationPreviewFor,
  shouldTranslateMessage,
  sourceMessageFromImage,
  toMediaBlock,
} from '@/domain';

const asymmetric = {
  senderUserId: 'u1',
  receiverUserId: 'u2',
  senderLearningLang: 'de',
  receiverLearningLang: 'en',
  senderNativeLang: 'en',
  receiverNativeLang: 'de',
};

describe('default sticker pack', () => {
  it('ships cat meme, hand fox, and slay gif as sticker: URIs', () => {
    expect(DEFAULT_STICKER_PACK.map((item) => item.id)).toEqual(['cat', 'hand', 'slay']);
    expect(DEFAULT_STICKER_PACK.map((item) => item.uri)).toEqual([
      'sticker:cat',
      'sticker:hand',
      'sticker:slay',
    ]);
  });
});

describe('sticker / image send', () => {
  it('creates an image message (not text) when sending a pack sticker', () => {
    const message = stickerMessageFromPack({
      stickerId: 'cat',
      id: 'sticker-1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
    });
    expect(message.sticker).toBe(true);
    expect(message.contentKind).toBe('image');
    expect(message.kind).toBe('user');
    expect(message.lines[0].mediaKind).toBe('sticker');
    expect(message.lines[0].imageUrls).toEqual(['sticker:cat']);
    expect(shouldTranslateMessage(message)).toBe(false);
    expect(conversationPreviewFor(message)).toBe('Sticker');
  });

  it('creates an image message from a picked photo data URL', () => {
    const message = sourceMessageFromImage({
      id: 'img-1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      imageUrl: 'data:image/png;base64,aaa',
      mediaKind: 'image',
    });
    expect(message.contentKind).toBe('image');
    expect(message.sticker).toBe(false);
    expect(message.lines[0].mediaKind).toBe('image');
    expect(message.lines[0].imageUrls?.[0]).toMatch(/^data:image\//);
    expect(shouldTranslateMessage(message)).toBe(false);
    expect(conversationPreviewFor(message)).toBe('Photo');
  });

  it('persists the image URI in the in-memory chat repo', async () => {
    const chat = new InMemoryChatRepository();
    const conversation = await chat.createConversation({
      participantIds: ['u1', 'u2'],
      participants: [
        { userId: 'u1', nativeLang: 'en', learningLang: 'de' },
        { userId: 'u2', nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: false,
      title: 'DM',
    });
    const message = stickerMessageFromPack({
      stickerId: 'hand',
      id: 'sticker-2',
      conversationId: conversation.id,
      authorId: 'u1',
      sourceLang: 'en',
    });
    await chat.appendMessage({ ...message, receipt: 'sent' });
    const stored = await chat.listMessages(conversation.id);
    expect(stored[0].lines[0].imageUrls).toEqual(['sticker:hand']);
    const listed = await chat.listConversations('u1');
    expect(listed[0].lastMessagePreview).toBe('Sticker');
  });

  it('skips the translation engine for sticker sends and does not rewrite sourceText', async () => {
    const store = new InMemoryChatHistoryStore();
    const engine = {
      isAvailable: () => true,
      detectLanguage: async () => {
        throw new Error('should not detect sticker');
      },
      translateLine: async () => {
        throw new Error('should not translate sticker');
      },
    };
    const message = stickerMessageFromPack({
      stickerId: 'slay',
      id: 'sticker-3',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
    });
    const sourceBefore = message.sourceText;
    const result = await processOutgoingTranslation({
      message,
      asymmetric,
      mode: 'standard',
      engine,
      historyStore: store,
    });
    expect(result.translations).toEqual([]);
    expect(result.record.message.sourceText).toBe(sourceBefore);
    expect(result.record.pipelineState).toBe('persisted');
  });

  it('keeps imageUrls when mapping a chat line into a media block', () => {
    const message = stickerMessageFromPack({
      stickerId: 'cat',
      id: 'sticker-4',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
    });
    const block = toMediaBlock(message.id, message.lines, {});
    expect(block.lines[0].imageUrls).toEqual(['sticker:cat']);
  });

  it('still translates ordinary text', async () => {
    const result = await processOutgoingTranslation({
      message: {
        id: 't1',
        conversationId: 'c1',
        authorId: 'u1',
        sourceLang: 'en',
        sourceText: 'Hello',
        lines: [{ content: 'Hello' }],
        kind: 'user',
        receipt: 'sent',
        createdAt: new Date().toISOString(),
      },
      asymmetric,
      mode: 'standard',
      engine: new EchoTranslationEngine(),
      historyStore: new InMemoryChatHistoryStore(),
      knownSourceLang: 'en',
    });
    expect(result.translations.length).toBeGreaterThan(0);
  });
});
