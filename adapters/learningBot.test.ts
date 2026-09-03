import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/domain/chat';
import { LEARNING_BOT_DISPLAY_NAME, LEARNING_BOT_USER_ID } from '@/domain/chat';
import type { ChatRepository } from '@/ports/ports';
import { ensureLearningBotChat } from './learningBot';

function fakeChat(): ChatRepository & { conversations: Conversation[] } {
  const conversations: Conversation[] = [];
  return {
    conversations,
    async listConversations(userId: string) {
      return conversations.filter((item) => item.participantIds.includes(userId));
    },
    async getConversation(id) {
      return conversations.find((item) => item.id === id) ?? null;
    },
    async createConversation(input) {
      const conversation: Conversation = {
        id: `c-${conversations.length}`,
        participantIds: input.participantIds,
        participants: input.participants,
        aiEnabled: input.aiEnabled,
        title: input.title,
        updatedAt: new Date().toISOString(),
        unreadCount: 0,
      };
      conversations.unshift(conversation);
      return conversation;
    },
    async listMessages() {
      return [];
    },
    async appendMessage(message) {
      return message;
    },
    async updateReceipt() {},
    async saveTranslations() {},
    async listTranslations() {
      return [];
    },
    async updateParticipants() {},
    subscribe() {
      return () => {};
    },
  };
}

describe('ensureLearningBotChat', () => {
  it('creates a SavignasBoi thread for every signed-in user', async () => {
    const chat = fakeChat();
    const first = await ensureLearningBotChat(chat, 'demo-user');
    const second = await ensureLearningBotChat(chat, 'ido-icestorm');
    expect(first).not.toBe(second);

    const forDemo = await chat.listConversations('demo-user');
    const forIce = await chat.listConversations('ido-icestorm');
    expect(forDemo.some((c) => c.participantIds.includes(LEARNING_BOT_USER_ID))).toBe(true);
    expect(forIce.some((c) => c.participantIds.includes(LEARNING_BOT_USER_ID))).toBe(true);
    expect(forDemo.every((c) => c.participantIds.includes('demo-user'))).toBe(true);
    expect(forIce.every((c) => c.participantIds.includes('ido-icestorm'))).toBe(true);
    expect(forDemo[0]?.title).toBe(LEARNING_BOT_DISPLAY_NAME);
  });

  it('does not wipe the first user when a second user signs in', async () => {
    const chat = fakeChat();
    const first = await ensureLearningBotChat(chat, 'user-a');
    await ensureLearningBotChat(chat, 'user-b');
    const still = await chat.getConversation(first);
    expect(still?.participantIds).toContain('user-a');
    expect(still?.participantIds).not.toContain('user-b');
  });
});
