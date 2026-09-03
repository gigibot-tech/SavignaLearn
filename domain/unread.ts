import { LEARNING_BOT_USER_ID, type Conversation, type SourceMessage } from './chat';

export function shouldCountAsUnread(
  message: Pick<SourceMessage, 'authorId' | 'deletedAt'>,
  viewerIds: readonly string[]
): boolean {
  if (message.deletedAt) return false;
  if (viewerIds.includes(message.authorId)) return false;
  return true;
}

export function unreadRecipients(
  participantIds: readonly string[],
  authorId: string
): string[] {
  return participantIds.filter(
    (id) => id && id !== authorId && id !== LEARNING_BOT_USER_ID
  );
}

export function unreadTotal(
  conversations: readonly Pick<Conversation, 'unreadCount' | 'muted'>[]
): number {
  return conversations.reduce((sum, item) => {
    if (item.muted) return sum;
    return sum + Math.max(0, item.unreadCount ?? 0);
  }, 0);
}

export function badgeLabel(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}
