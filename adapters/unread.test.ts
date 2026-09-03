import { describe, expect, it } from 'vitest';
import { LEARNING_BOT_USER_ID, sourceMessageFromText } from '@/domain/chat';
import { InMemoryChatRepository } from './memoryChat';
import { MemoryChatKv, chatStorageKey, parseChatSnapshot } from './chatPersistence';

describe('unread counts', () => {
  it('bumps the other human, skips the bot, and clears on mark read', async () => {
    const chat = new InMemoryChatRepository();
    const conv = await chat.createConversation({
      participantIds: ['learn', 'ice'],
      participants: [
        { userId: 'learn', nativeLang: 'en', learningLang: 'de' },
        { userId: 'ice', nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
    });
    await chat.appendMessage(
      sourceMessageFromText({
        id: 'from-learn',
        conversationId: conv.id,
        authorId: 'learn',
        sourceLang: 'en',
        sourceText: 'hi ice',
        receipt: 'sent',
      })
    );
    expect((await chat.listConversations('ice'))[0]?.unreadCount).toBe(1);
    expect((await chat.listConversations('learn'))[0]?.unreadCount).toBe(0);

    await chat.appendMessage(
      sourceMessageFromText({
        id: 'from-ice',
        conversationId: conv.id,
        authorId: 'ice',
        sourceLang: 'en',
        sourceText: 'hi learn',
        receipt: 'sent',
      })
    );
    expect((await chat.listConversations('learn'))[0]?.unreadCount).toBe(1);

    await chat.markConversationRead(conv.id, ['learn']);
    expect((await chat.listConversations('learn'))[0]?.unreadCount).toBe(0);
    expect((await chat.listConversations('ice'))[0]?.unreadCount).toBe(1);
  });

  it('does not treat the bot as an unread recipient', async () => {
    const chat = new InMemoryChatRepository();
    const conv = await chat.createConversation({
      participantIds: ['learn', LEARNING_BOT_USER_ID],
      participants: [
        { userId: 'learn', nativeLang: 'en', learningLang: 'de' },
        { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
    });
    await chat.appendMessage(
      sourceMessageFromText({
        id: 'human',
        conversationId: conv.id,
        authorId: 'learn',
        sourceLang: 'en',
        sourceText: 'hallo',
        receipt: 'sent',
      })
    );
    await chat.appendMessage(
      sourceMessageFromText({
        id: 'bot',
        conversationId: conv.id,
        authorId: LEARNING_BOT_USER_ID,
        sourceLang: 'de',
        sourceText: 'Hallo!',
        kind: 'ai',
        receipt: 'sent',
      })
    );
    expect((await chat.listConversations('learn'))[0]?.unreadCount).toBe(1);
  });

  it('persists unreadCounts in the local snapshot', async () => {
    const kv = new MemoryChatKv();
    const writer = new InMemoryChatRepository(kv);
    const conv = await writer.createConversation({
      participantIds: ['learn', 'ice'],
      participants: [
        { userId: 'learn', nativeLang: 'en', learningLang: 'de' },
        { userId: 'ice', nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
    });
    await writer.appendMessage(
      sourceMessageFromText({
        id: 'n1',
        conversationId: conv.id,
        authorId: 'ice',
        sourceLang: 'en',
        sourceText: 'ping',
        receipt: 'sent',
      })
    );
    await writer.flush();
    const stored = parseChatSnapshot(await kv.getItem(chatStorageKey('learn')));
    expect(stored?.unreadCounts?.[conv.id]).toBe(1);

    const reader = new InMemoryChatRepository(kv);
    await reader.hydrateForUser('learn');
    expect((await reader.listConversations('learn'))[0]?.unreadCount).toBe(1);
  });
});
