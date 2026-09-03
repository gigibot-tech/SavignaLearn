/**
 * Default sendable sticker pack. Bundled pixels live in assets/stickers/
 * so they never overwrite app icon.png or the SavignasBoi avatar.
 */

import {
  sourceMessageFromImage,
  type LanguageCode,
  type SourceMessage,
} from '@/domain/chat';

export type DefaultStickerId = 'cat' | 'hand' | 'slay';

export interface StickerPackItem {
  id: DefaultStickerId;
  label: string;
  uri: string;
}

/** Literal `sticker:` URIs — do not call `stickerUri()` at module init (Metro cycle). */
export const DEFAULT_STICKER_PACK: readonly StickerPackItem[] = [
  { id: 'cat', label: 'Cat meme', uri: 'sticker:cat' },
  { id: 'hand', label: 'Hand fox', uri: 'sticker:hand' },
  { id: 'slay', label: 'Slay', uri: 'sticker:slay' },
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
  });
}
