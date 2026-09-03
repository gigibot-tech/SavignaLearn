import type { SourceMessage } from './chat';

export type MessageDeleteScope = 'me' | 'everyone';

/** WhatsApp-style window for deleting a message for everyone. */
export const DELETE_FOR_EVERYONE_WINDOW_MS = 48 * 60 * 60 * 1000;

export function viewerOwnsMessage(authorId: string, viewerIds: readonly string[]): boolean {
  return viewerIds.includes(authorId);
}

export function isDeletedForEveryone(message: Pick<SourceMessage, 'deletedAt'>): boolean {
  return Boolean(message.deletedAt);
}

export function canDeleteForMe(message: Pick<SourceMessage, 'id'>): boolean {
  return Boolean(message.id);
}

export function canDeleteForEveryone(
  message: Pick<SourceMessage, 'authorId' | 'deletedAt' | 'createdAt'>,
  viewerIds: readonly string[],
  nowMs = Date.now()
): boolean {
  if (isDeletedForEveryone(message)) return false;
  if (!viewerOwnsMessage(message.authorId, viewerIds)) return false;
  const created = Date.parse(message.createdAt);
  if (!Number.isFinite(created)) return false;
  return nowMs - created <= DELETE_FOR_EVERYONE_WINDOW_MS;
}

export function tombstoneMessage(
  message: SourceMessage,
  deletedAt = new Date().toISOString()
): SourceMessage {
  return {
    ...message,
    deletedAt,
    sourceText: '',
    lines: [{ content: '' }],
    contentKind: 'text',
    mediaKind: undefined,
    sticker: undefined,
  };
}

export function messagesVisibleToViewer(
  messages: readonly SourceMessage[],
  hiddenIds: ReadonlySet<string>
): SourceMessage[] {
  return messages.filter((message) => !hiddenIds.has(message.id));
}

export function previewAfterDelete(
  messages: readonly SourceMessage[],
  hiddenIds: ReadonlySet<string>,
  previewFor: (message: SourceMessage) => string
): string | undefined {
  const visible = messagesVisibleToViewer(messages, hiddenIds);
  const last = visible[visible.length - 1];
  return last ? previewFor(last) : undefined;
}
