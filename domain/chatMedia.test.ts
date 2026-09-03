import { describe, expect, it } from 'vitest';
import { sourceMessageFromText } from './chat';
import {
  DEFAULT_STICKER_PACK,
  isImageMessage,
  isStickerMessage,
  messageImageUri,
  messagePreview,
  parseStickerId,
  shouldTranslateMessage,
  sourceMessageFromComposer,
  sourceMessageFromImage,
  stickerUri,
} from './chatMedia';

describe('default sticker pack', () => {
  it('ships cat, hand fox, and slay as sendable ids', () => {
    expect(DEFAULT_STICKER_PACK.map((item) => item.id)).toEqual([
      'savignas-boi',
      'hand-fox',
      'slay',
    ]);
    expect(DEFAULT_STICKER_PACK.every((item) => item.sticker)).toBe(true);
  });
});

describe('sticker send creates image message', () => {
  it('builds an image/sticker SourceMessage, not a text kind', () => {
    const message = sourceMessageFromComposer({
      id: 'm-sticker',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      body: {
        type: 'image',
        uri: stickerUri('savignas-boi'),
        sticker: true,
        alt: 'SavignasBoi',
      },
    });

    expect(message.kind).toBe('user');
    expect(message.contentKind).toBe('image');
    expect(isImageMessage(message)).toBe(true);
    expect(isStickerMessage(message)).toBe(true);
    expect(messageImageUri(message)).toBe('sticker://savignas-boi');
    expect(message.lines[0].mediaKind).toBe('sticker');
    expect(message.lines[0].imageUrls).toEqual(['sticker://savignas-boi']);
    expect(parseStickerId(messageImageUri(message)!)).toBe('savignas-boi');
  });

  it('treats a picked photo as the same image content kind without sticker sizing', () => {
    const message = sourceMessageFromImage({
      id: 'm-photo',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      imageUri: 'data:image/png;base64,abc',
      sticker: false,
      alt: '',
    });
    expect(isImageMessage(message)).toBe(true);
    expect(isStickerMessage(message)).toBe(false);
    expect(message.lines[0].mediaKind).toBe('image');
    expect(messagePreview(message)).toBe('Photo');
  });

  it('keeps text sends on the same factory without media fields', () => {
    const message = sourceMessageFromComposer({
      id: 'm-text',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'de',
      body: { type: 'text', text: 'Hallo' },
    });
    expect(isImageMessage(message)).toBe(false);
    expect(message.sourceText).toBe('Hallo');
    expect(messagePreview(message)).toBe('Hallo');
  });
});

describe('skip translation for media messages', () => {
  it('does not translate stickers or photos, including short alts', () => {
    const sticker = sourceMessageFromImage({
      id: 's1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      imageUri: stickerUri('slay'),
      sticker: true,
      alt: 'Slay',
    });
    const photo = sourceMessageFromImage({
      id: 'p1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      imageUri: 'https://example.test/pic.png',
    });
    const text = sourceMessageFromText({
      id: 't1',
      conversationId: 'c1',
      authorId: 'u1',
      sourceLang: 'en',
      sourceText: 'Hello',
    });
    expect(shouldTranslateMessage(sticker)).toBe(false);
    expect(shouldTranslateMessage(photo)).toBe(false);
    expect(shouldTranslateMessage(text)).toBe(true);
    expect(messagePreview(sticker)).toBe('Slay');
  });
});
