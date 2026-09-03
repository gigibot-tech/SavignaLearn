/**
 * Chat image / sticker send (not Gigolingo MediaCatalogPort).
 * Bundled stickers persist as sticker:// ids so they do not depend on Metro hashes.
 */

import {
  sourceMessageFromText,
  type LanguageCode,
  type MessageKind,
  type ReceiptStatus,
  type SourceMessage,
} from './chat';

export const STICKER_URI_PREFIX = 'sticker://';

export interface StickerPackItem {
  id: string;
  alt: string;
  /** Tighter bubble than a picked photo. */
  sticker: boolean;
}

/** Default tray: copies in assets/stickers/, never the app icon or bot avatar files. */
export const DEFAULT_STICKER_PACK: readonly StickerPackItem[] = [
  { id: 'savignas-boi', alt: 'SavignasBoi', sticker: true },
  { id: 'hand-fox', alt: 'Hand fox', sticker: true },
  { id: 'slay', alt: 'Slay', sticker: true },
] as const;

export type ComposerSendBody =
  | { type: 'text'; text: string }
  | { type: 'image'; uri: string; sticker?: boolean; alt?: string };

export function stickerUri(id: string): string {
  return `${STICKER_URI_PREFIX}${id}`;
}

export function parseStickerId(uri: string): string | undefined {
  if (!uri.startsWith(STICKER_URI_PREFIX)) return undefined;
  const id = uri.slice(STICKER_URI_PREFIX.length).trim();
  return id.length > 0 ? id : undefined;
}

export function defaultStickerById(id: string): StickerPackItem | undefined {
  return DEFAULT_STICKER_PACK.find((item) => item.id === id);
}

export function messageImageUri(message: SourceMessage): string | undefined {
  for (const line of message.lines) {
    const uri = line.imageUrls?.[0];
    if (uri) return uri;
  }
  return undefined;
}

export function isImageMessage(message: SourceMessage): boolean {
  if (message.contentKind === 'image') return true;
  return message.lines.some((line) => (line.imageUrls?.length ?? 0) > 0);
}

export function isStickerMessage(message: SourceMessage): boolean {
  if (message.sticker) return true;
  return message.lines.some((line) => line.mediaKind === 'sticker');
}

/** Stickers and photos skip detect/translate/Birkenbihl. */
export function shouldTranslateMessage(message: SourceMessage): boolean {
  if (isImageMessage(message)) return false;
  return message.sourceText.trim().length > 0;
}

export function messagePreview(message: SourceMessage): string {
  if (isStickerMessage(message)) {
    return message.sourceText.trim() || 'Sticker';
  }
  if (isImageMessage(message)) {
    return message.sourceText.trim() || 'Photo';
  }
  return message.sourceText.split('\n')[0] ?? '';
}

export function sourceMessageFromImage(input: {
  id: string;
  conversationId: string;
  authorId: string;
  sourceLang: LanguageCode;
  imageUri: string;
  sticker?: boolean;
  alt?: string;
  kind?: MessageKind;
  receipt?: ReceiptStatus;
  createdAt?: string;
  replyToId?: string;
}): SourceMessage {
  const alt = (input.alt ?? '').trim();
  const sticker = Boolean(input.sticker);
  return {
    id: input.id,
    conversationId: input.conversationId,
    authorId: input.authorId,
    sourceLang: input.sourceLang,
    sourceText: alt,
    lines: [
      {
        content: alt,
        imageUrls: [input.imageUri],
        mediaKind: sticker ? 'sticker' : 'image',
      },
    ],
    kind: input.kind ?? 'user',
    contentKind: 'image',
    sticker,
    receipt: input.receipt ?? 'pending',
    createdAt: input.createdAt ?? new Date().toISOString(),
    replyToId: input.replyToId,
  };
}

/** One composer → SourceMessage factory (text and images share append/receipt). */
export function sourceMessageFromComposer(input: {
  id: string;
  conversationId: string;
  authorId: string;
  sourceLang: LanguageCode;
  body: ComposerSendBody;
  kind?: MessageKind;
  receipt?: ReceiptStatus;
  createdAt?: string;
  replyToId?: string;
}): SourceMessage {
  if (input.body.type === 'image') {
    return sourceMessageFromImage({
      id: input.id,
      conversationId: input.conversationId,
      authorId: input.authorId,
      sourceLang: input.sourceLang,
      imageUri: input.body.uri,
      sticker: input.body.sticker,
      alt: input.body.alt,
      kind: input.kind,
      receipt: input.receipt,
      createdAt: input.createdAt,
      replyToId: input.replyToId,
    });
  }
  return sourceMessageFromText({
    id: input.id,
    conversationId: input.conversationId,
    authorId: input.authorId,
    sourceLang: input.sourceLang,
    sourceText: input.body.text,
    kind: input.kind,
    receipt: input.receipt,
    createdAt: input.createdAt,
    replyToId: input.replyToId,
  });
}
