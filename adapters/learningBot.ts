/**
 * Per-user Bot thread. Lives in its own module so domain/adapter tests
 * do not load react-native from adapters/chat.ts.
 */

import {
  collapseDuplicateDirectChats,
  collapseDuplicateLearningBots,
  isLearningBotConversation,
  LEARNING_BOT_DISPLAY_NAME,
  LEARNING_BOT_USER_ID,
  pickLearningBotConversation,
  type Conversation,
} from '@/domain/chat';
import { canonicalChatActorId } from '@/domain/friends';
import type { ChatRepository } from '@/ports/ports';

type MemoryChat = ChatRepository & {
  seedDemo: (viewerId: string, partnerId: string) => void;
  conversations: Conversation[];
  hydrateForUser?: (userId: string, aliases?: string[]) => Promise<void>;
  persistUser?: (userId: string) => Promise<void>;
};

const ensureInFlight = new Map<string, Promise<string>>();

function asMemoryChat(chat: ChatRepository): MemoryChat | null {
  const candidate = chat as MemoryChat;
  if (typeof candidate.seedDemo === 'function' && Array.isArray(candidate.conversations)) {
    return candidate;
  }
  return null;
}

function viewerKeys(viewerId: string, extraViewerIds: string[] = []): string[] {
  return [...new Set([viewerId, ...extraViewerIds].filter(Boolean))];
}

export async function listInboxConversations(
  chat: ChatRepository,
  viewerIds: string[]
): Promise<Conversation[]> {
  const unique = viewerKeys('', viewerIds);
  const memory = asMemoryChat(chat);
  const byId = new Map<string, Conversation>();
  for (const id of unique) {
    if (memory?.hydrateForUser) await memory.hydrateForUser(id);
    for (const conversation of await chat.listConversations(id)) {
      byId.set(conversation.id, conversation);
    }
  }
  return collapseDuplicateDirectChats(
    collapseDuplicateLearningBots([...byId.values()]),
    canonicalChatActorId
  ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Ensure this signed-in user has one Bot thread — never steal another viewer's. */
export async function ensureLearningBotChat(
  chat: ChatRepository,
  viewerId: string,
  extraViewerIds: string[] = []
): Promise<string> {
  const keys = viewerKeys(viewerId, extraViewerIds);
  const lockKey = [...keys].sort().join('|');
  const pending = ensureInFlight.get(lockKey);
  if (pending) return pending;
  const work = ensureLearningBotChatOnce(chat, keys);
  ensureInFlight.set(lockKey, work);
  try {
    return await work;
  } finally {
    ensureInFlight.delete(lockKey);
  }
}

async function ensureLearningBotChatOnce(chat: ChatRepository, viewerIds: string[]): Promise<string> {
  const existing = await listInboxConversations(chat, viewerIds);
  const bot = pickLearningBotConversation(existing);
  const memory = asMemoryChat(chat);
  const persistAs = viewerIds[0];
  if (bot) {
    if (bot.title !== LEARNING_BOT_DISPLAY_NAME) {
      bot.title = LEARNING_BOT_DISPLAY_NAME;
      if (persistAs) await memory?.persistUser?.(persistAs);
    }
    return bot.id;
  }
  if (memory && memory.conversations.length === 0 && persistAs) {
    memory.seedDemo(persistAs, LEARNING_BOT_USER_ID);
    const seeded =
      memory.conversations.find((item) => item.participantIds.includes(persistAs)) ??
      memory.conversations[0];
    if (seeded) {
      seeded.title = LEARNING_BOT_DISPLAY_NAME;
      seeded.aiEnabled = true;
      seeded.unreadCount = 0;
      seeded.lastMessagePreview = 'Ready when you are — say something in your language.';
      await memory.persistUser?.(persistAs);
      return seeded.id;
    }
  }
  if (!persistAs) throw new Error('Cannot open Bot without a signed-in user');
  const created = await chat.createConversation({
    participantIds: [persistAs, LEARNING_BOT_USER_ID],
    participants: [
      { userId: persistAs, nativeLang: 'en', learningLang: 'de' },
      { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
    ],
    aiEnabled: true,
    title: LEARNING_BOT_DISPLAY_NAME,
  });
  created.title = LEARNING_BOT_DISPLAY_NAME;
  return created.id;
}
