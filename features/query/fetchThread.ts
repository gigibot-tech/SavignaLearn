import { ensureHumanDmCloudSaved, ensureLearningBotChat } from '@/adapters/chat';
import { loadConversationThread } from '@/adapters/chatPersistence';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { isLearningBotConversation, type Conversation, type LineTranslation, type SourceMessage } from '@/domain';
import type { AuthUser, ChatHistoryStore, ChatRepository } from '@/ports/ports';

export type ThreadSnapshot = {
  activeId: string;
  conversation: Conversation | null;
  messages: SourceMessage[];
  translations: Record<string, LineTranslation[]>;
  hiddenIds: string[];
  redirectTo?: string;
  hadUnread: boolean;
};

export async function fetchThreadSnapshot(input: {
  chat: ChatRepository;
  historyStore: ChatHistoryStore;
  conversationId: string;
  user: AuthUser | null;
}): Promise<ThreadSnapshot> {
  const { chat, historyStore, conversationId, user } = input;
  const chatUserId = user ? chatPersistenceUserId(user) : undefined;
  const selfIds = user ? chatActorIds(user) : [];

  if (user && chatUserId) await ensureLearningBotChat(chat, chatUserId, selfIds);

  let conv = await chat.getConversation(conversationId);
  let activeId = conversationId;
  if (!conv && user && chatUserId) {
    const botId = await ensureLearningBotChat(chat, chatUserId, selfIds);
    if (botId !== conversationId) {
      return emptySnapshot(conversationId, { redirectTo: botId });
    }
    conv = await chat.getConversation(botId);
    activeId = botId;
  }

  const hadUnread = Boolean(conv && conv.unreadCount > 0);
  if (chatUserId) {
    await chat.markConversationRead(activeId, selfIds.length > 0 ? selfIds : [chatUserId]);
  }

  if (conv && !isLearningBotConversation(conv)) {
    const cloudId = await ensureHumanDmCloudSaved(chat, conv.id);
    if (cloudId && cloudId !== activeId) {
      return emptySnapshot(activeId, { redirectTo: cloudId, conversation: conv, hadUnread });
    }
  }

  const thread = await loadConversationThread({
    chat,
    historyStore,
    conversationId: activeId,
    userId: chatUserId ?? user?.id,
  });
  const hiddenIds = chatUserId ? await chat.listHiddenMessageIds(chatUserId).catch(() => []) : [];

  return {
    activeId,
    conversation: conv ? { ...conv, unreadCount: 0 } : conv,
    messages: thread.messages,
    translations: thread.translations,
    hiddenIds,
    hadUnread,
  };
}

function emptySnapshot(
  activeId: string,
  extra: Partial<ThreadSnapshot>
): ThreadSnapshot {
  return {
    activeId,
    conversation: extra.conversation ?? null,
    messages: [],
    translations: {},
    hiddenIds: [],
    hadUnread: extra.hadUnread ?? false,
    redirectTo: extra.redirectTo,
  };
}
