/**
 * Per-user SavignasBoi thread. Lives in its own module so domain/adapter tests
 * do not load react-native from adapters/chat.ts.
 */

import {
  isLearningBotConversation,
  LEARNING_BOT_DISPLAY_NAME,
  LEARNING_BOT_USER_ID,
  type Conversation,
} from '@/domain/chat';
import type { ChatRepository } from '@/ports/ports';

type MemoryChat = ChatRepository & {
  seedDemo: (viewerId: string, partnerId: string) => void;
  conversations: Conversation[];
};

function asMemoryChat(chat: ChatRepository): MemoryChat | null {
  const candidate = chat as MemoryChat;
  if (typeof candidate.seedDemo === 'function' && Array.isArray(candidate.conversations)) {
    return candidate;
  }
  return null;
}

/** Ensure this signed-in user has their own SavignasBoi thread — never steal another viewer's. */
export async function ensureLearningBotChat(
  chat: ChatRepository,
  viewerId: string
): Promise<string> {
  const existing = await chat.listConversations(viewerId);
  const bot = existing.find(
    (c) =>
      c.participantIds.includes(viewerId) &&
      (c.participantIds.includes(LEARNING_BOT_USER_ID) || isLearningBotConversation(c))
  );
  if (bot) {
    if (!bot.title || /savigna\s*bot/i.test(bot.title)) {
      bot.title = LEARNING_BOT_DISPLAY_NAME;
    }
    return bot.id;
  }
  const memory = asMemoryChat(chat);
  if (memory && memory.conversations.length === 0) {
    memory.seedDemo(viewerId, LEARNING_BOT_USER_ID);
    const seeded = memory.conversations[0];
    if (seeded) {
      seeded.title = LEARNING_BOT_DISPLAY_NAME;
      seeded.aiEnabled = true;
      seeded.unreadCount = 0;
      seeded.lastMessagePreview = 'Ready when you are — say something in your language.';
      return seeded.id;
    }
  }
  const created = await chat.createConversation({
    participantIds: [viewerId, LEARNING_BOT_USER_ID],
    participants: [
      { userId: viewerId, nativeLang: 'en', learningLang: 'de' },
      { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
    ],
    aiEnabled: true,
    title: LEARNING_BOT_DISPLAY_NAME,
  });
  created.title = LEARNING_BOT_DISPLAY_NAME;
  return created.id;
}
