import { isMediaMessage, type SourceMessage } from './chat';
import type { LearningItem } from './learning';

export type ConversationProfileStats = {
  messageCount: number;
  fromThem: number;
  fromYou: number;
  photos: number;
  cards: number;
  startedAt?: string;
};

export function conversationProfileStats(input: {
  messages: readonly SourceMessage[];
  viewerIds: readonly string[];
  conversationId: string;
  vocab: readonly LearningItem[];
}): ConversationProfileStats {
  const visible = input.messages.filter((item) => !item.deletedAt);
  const viewer = new Set(input.viewerIds);
  const fromYou = visible.filter((item) => viewer.has(item.authorId)).length;
  const fromThem = visible.filter((item) => !viewer.has(item.authorId)).length;
  const photos = visible.filter((item) => isMediaMessage(item)).length;
  const cards = input.vocab.filter(
    (item) => item.source.kind === 'chat' && item.source.conversationId === input.conversationId
  ).length;
  const first = visible[0];
  return {
    messageCount: visible.length,
    fromThem,
    fromYou,
    photos,
    cards,
    startedAt: first?.createdAt,
  };
}
