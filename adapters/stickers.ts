/**
 * Default sendable sticker pack. Bundled pixels live in assets/stickers/
 * so they never overwrite app icon.png or the SavignasBoi avatar.
 */

import {
  sourceMessageFromImage,
  stickerUri,
  type LanguageCode,
  type SourceMessage,
} from '@/domain/chat';

export type DefaultStickerId = 'cat' | 'hand' | 'slay';

export interface StickerPackItem {
  id: DefaultStickerId;
  label: string;
  uri: string;
}

export const DEFAULT_STICKER_PACK: readonly StickerPackItem[] = [
  { id: 'cat', label: 'Cat meme', uri: stickerUri('cat') },
  { id: 'hand', label: 'Hand fox', uri: stickerUri('hand') },
  { id: 'slay', label: 'Slay', uri: stickerUri('slay') },
];

export function stickerById(id: string): StickerPackItem | undefined {
  return DEFAULT_STICKER_PACK.find((item) => item.id === id);
}

export function stickerMessageFromPack(input: {
  stickerId: string;
  id: string;
  conversationId: string;
  authorId: string;
  sourceLang: LanguageCode;
}): SourceMessage {
  const pack = stickerById(input.stickerId);
  if (!pack) {
    throw new Error(`Unknown sticker: ${input.stickerId}`);
  }
  return sourceMessageFromImage({
    id: input.id,
    conversationId: input.conversationId,
    authorId: input.authorId,
    sourceLang: input.sourceLang,
    imageUrl: pack.uri,
    mediaKind: 'sticker',
    alt: pack.label,
  });
}
