/**
 * Local chat snapshot (messages + translations) keyed by user id.
 * Used when savigna_* tables are not configured — survives browser refresh.
 */

import {
  LEARNING_BOT_USER_ID,
  mergeMessageTimelines,
  type Conversation,
  type LineTranslation,
  type SourceMessage,
} from '@/domain/chat';
import { messagesVisibleToViewer } from '@/domain/messageDelete';
import {
  mergeLineTranslations,
  type ChatHistoryRecord,
  type ChatHistoryStore,
} from '@/domain/pipeline';
import type { ChatRepository } from '@/ports/ports';

export const CHAT_STORAGE_PREFIX = 'savigna.chat.v1.';
export const HISTORY_STORAGE_PREFIX = 'savigna.history.v1.';

export function chatStorageKey(userId: string): string {
  return `${CHAT_STORAGE_PREFIX}${userId}`;
}

export function historyStorageKey(userId: string): string {
  return `${HISTORY_STORAGE_PREFIX}${userId}`;
}

export type ChatKv = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type ChatSnapshot = {
  version: 1;
  conversations: Conversation[];
  messages: Record<string, SourceMessage[]>;
  translations: Record<string, LineTranslation[]>;
  hiddenMessageIds?: string[];
  unreadCounts?: Record<string, number>;
};

export class MemoryChatKv implements ChatKv {
  constructor(readonly store = new Map<string, string>()) {}

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

export function snapshotForUser(
  conversations: Conversation[],
  messages: Map<string, SourceMessage[]>,
  translations: Map<string, LineTranslation[]>,
  userId: string,
  hiddenMessageIds: string[] = [],
  unreadCounts: Record<string, number> = {}
): ChatSnapshot {
  const mine = conversations.filter((item) => item.participantIds.includes(userId));
  const messageRecord: Record<string, SourceMessage[]> = {};
  const translationRecord: Record<string, LineTranslation[]> = {};
  for (const conversation of mine) {
    const list = messages.get(conversation.id) ?? [];
    messageRecord[conversation.id] = list;
    for (const message of list) {
      const lines = translations.get(message.id);
      if (lines && lines.length > 0) translationRecord[message.id] = lines;
    }
  }
  return {
    version: 1,
    conversations: mine.map((item) => ({
      ...item,
      unreadCount: unreadCounts[item.id] ?? 0,
    })),
    messages: messageRecord,
    translations: translationRecord,
    hiddenMessageIds,
    unreadCounts,
  };
}

export function parseChatSnapshot(raw: string | null): ChatSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatSnapshot;
    if (parsed?.version !== 1 || !Array.isArray(parsed.conversations)) return null;
    if (!parsed.messages || typeof parsed.messages !== 'object') return null;
    if (!parsed.translations || typeof parsed.translations !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function applySnapshot(
  conversations: Conversation[],
  messages: Map<string, SourceMessage[]>,
  translations: Map<string, LineTranslation[]>,
  snapshot: ChatSnapshot
): Conversation[] {
  const byId = new Map(conversations.map((item) => [item.id, item]));
  for (const conversation of snapshot.conversations) {
    byId.set(conversation.id, conversation);
  }
  for (const [id, list] of Object.entries(snapshot.messages)) {
    messages.set(id, list);
  }
  for (const [id, list] of Object.entries(snapshot.translations)) {
    translations.set(id, list);
  }
  return [...byId.values()];
}

export function humanParticipantIds(conversation: Conversation | undefined): string[] {
  if (!conversation) return [];
  return conversation.participantIds.filter((id) => id !== LEARNING_BOT_USER_ID);
}

/** Rewrite stub ids (e.g. friend-icestormfroste) onto the live signed-in id. */
export function remapChatActorId(input: {
  conversations: Conversation[];
  messages: Map<string, SourceMessage[]>;
  fromId: string;
  toId: string;
}): void {
  if (!input.fromId || !input.toId || input.fromId === input.toId) return;
  for (const conversation of input.conversations) {
    conversation.participantIds = conversation.participantIds.map((id) =>
      id === input.fromId ? input.toId : id
    );
    conversation.participants = conversation.participants.map((participant) =>
      participant.userId === input.fromId ? { ...participant, userId: input.toId } : participant
    );
  }
  for (const list of input.messages.values()) {
    for (const message of list) {
      if (message.authorId === input.fromId) message.authorId = input.toId;
    }
  }
}

export function parseHistorySnapshot(raw: string | null): ChatHistoryRecord[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number; records?: ChatHistoryRecord[] } | ChatHistoryRecord[];
    if (Array.isArray(parsed)) return parsed;
    if (!Array.isArray(parsed?.records)) return null;
    return parsed.records;
  } catch {
    return null;
  }
}

export { mergeLineTranslations };

type Hydrating = { hydrateForUser?: (userId: string) => Promise<void> };

export async function ensureChatHydrated(chat: ChatRepository, userId?: string): Promise<void> {
  if (!userId) return;
  const hydrator = chat as ChatRepository & Hydrating;
  if (typeof hydrator.hydrateForUser === 'function') {
    await hydrator.hydrateForUser(userId);
    return;
  }
  await chat.listConversations(userId);
}

/** Load every stored message for a thread, merging chat repo + history store. */
export async function loadConversationThread(input: {
  chat: ChatRepository;
  historyStore: ChatHistoryStore;
  conversationId: string;
  userId?: string;
}): Promise<{ messages: SourceMessage[]; translations: Record<string, LineTranslation[]> }> {
  await ensureChatHydrated(input.chat, input.userId);
  const historyHydrator = input.historyStore as ChatHistoryStore & Hydrating;
  if (input.userId && typeof historyHydrator.hydrateForUser === 'function') {
    await historyHydrator.hydrateForUser(input.userId);
  }

  const fromRepo = await input.chat.listMessages(input.conversationId);
  const fromHistory = await input.historyStore.listByConversation(input.conversationId);
  const merged = mergeMessageTimelines(
    fromRepo,
    fromHistory.map((record) => record.message)
  );
  const hiddenIds = input.userId
    ? await input.chat.listHiddenMessageIds(input.userId).catch(() => [])
    : [];
  const messages = messagesVisibleToViewer(merged, new Set(hiddenIds));

  const translations: Record<string, LineTranslation[]> = {};
  for (const message of messages) {
    const repoRows = await input.chat.listTranslations(message.id);
    const historyRows = fromHistory.find((record) => record.id === message.id)?.translations ?? [];
    translations[message.id] = mergeLineTranslations(repoRows, historyRows);
  }
  return { messages, translations };
}
