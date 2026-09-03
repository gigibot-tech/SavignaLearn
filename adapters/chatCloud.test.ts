import { describe, expect, it } from 'vitest';
import { sourceMessageFromText } from '@/domain/chat';
import {
  InMemoryChatRouteBook,
  LocalFirstChatPolicy,
  PolicyChatRepository,
} from './chatCloud';
import { InMemoryChatRepository } from './memoryChat';
import { LEARNING_BOT_USER_ID } from '@/domain/chat';

describe('PolicyChatRepository', () => {
  it('stays local-first and does not hit cloud on inbox load', async () => {
    const cloud = new InMemoryChatRepository();
    const local = new InMemoryChatRepository();
    let cloudListCalls = 0;
    const repo = new PolicyChatRepository(
      {
        local,
        cloud: {
          ...cloud,
          async listConversations(userId) {
            cloudListCalls += 1;
            return cloud.listConversations(userId);
          },
        },
      },
      new LocalFirstChatPolicy(new InMemoryChatRouteBook())
    );
    const conv = await repo.createConversation({
      participantIds: ['u1', LEARNING_BOT_USER_ID],
      participants: [
        { userId: 'u1', nativeLang: 'en', learningLang: 'de' },
        { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      title: 'SavignasBoi',
    });
    expect((await repo.listConversations('u1')).map((c) => c.id)).toContain(conv.id);
    expect(cloudListCalls).toBe(0);
    expect(await cloud.listConversations('u1')).toEqual([]);
  });

  it('can route a conversation to cloud without changing local-first inbox policy', async () => {
    const cloud = new InMemoryChatRepository();
    const local = new InMemoryChatRepository();
    const routeBook = new InMemoryChatRouteBook();
    const repo = new PolicyChatRepository(
      { local, cloud },
      new LocalFirstChatPolicy(routeBook, {
        defaultBackend: 'cloud',
        inboxBackends: ['local'],
      })
    );
    const conv = await repo.createConversation({
      participantIds: ['u1', LEARNING_BOT_USER_ID],
      participants: [
        { userId: 'u1', nativeLang: 'en', learningLang: 'de' },
        { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      title: 'SavignasBoi',
    });
    expect((await cloud.listConversations('u1')).map((c) => c.id)).toContain(conv.id);
    expect(await local.listConversations('u1')).toEqual([]);
    expect(await routeBook.get(conv.id)).toBe('cloud');
    await repo.appendMessage(
      sourceMessageFromText({
        id: 'cloud-msg-1',
        conversationId: conv.id,
        authorId: 'u1',
        sourceLang: 'en',
        sourceText: 'hello cloud',
        receipt: 'sent',
      })
    );
    expect((await cloud.listMessages(conv.id)).map((item) => item.sourceText)).toEqual([
      'hello cloud',
    ]);
    await repo.saveTranslations('cloud-msg-1', [
      { lineIndex: 0, targetLang: 'de', text: 'hallo wolke', mode: 'lines' },
    ]);
    expect(await cloud.listTranslations('cloud-msg-1')).toEqual([
      { lineIndex: 0, targetLang: 'de', text: 'hallo wolke', mode: 'lines' },
    ]);
    expect(await repo.listConversations('u1')).toEqual([]);
  });

  it('syncs cloud participants from local on first cloud getConversation', async () => {
    const cloud = new InMemoryChatRepository();
    const local = new InMemoryChatRepository();
    const routeBook = new InMemoryChatRouteBook();
    const repo = new PolicyChatRepository(
      { local, cloud },
      new LocalFirstChatPolicy(routeBook, { defaultBackend: 'cloud', inboxBackends: ['local'] })
    );

    const conversationId = 'c-sync-1';
    const localParticipants = [
      { userId: 'u1', nativeLang: 'en', learningLang: 'fr' },
      { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
    ];
    const cloudParticipants = [
      { userId: 'u1', nativeLang: 'en', learningLang: 'de' },
      { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
    ];

    local.conversations.push({
      id: conversationId,
      participantIds: ['u1', LEARNING_BOT_USER_ID],
      participants: localParticipants,
      aiEnabled: true,
      updatedAt: new Date().toISOString(),
      unreadCount: 0,
      title: 'Test',
    });
    cloud.conversations.push({
      id: conversationId,
      participantIds: ['u1', LEARNING_BOT_USER_ID],
      participants: cloudParticipants,
      aiEnabled: true,
      updatedAt: new Date().toISOString(),
      unreadCount: 0,
      title: 'Test',
    });

    await routeBook.set(conversationId, 'cloud');

    const fetched = await repo.getConversation(conversationId);
    expect(fetched?.participants).toEqual(localParticipants);
    expect((await cloud.getConversation(conversationId))?.participants).toEqual(localParticipants);
  });

  it('mirrors updateParticipants to both local and cloud backends', async () => {
    const cloud = new InMemoryChatRepository();
    const local = new InMemoryChatRepository();
    const routeBook = new InMemoryChatRouteBook();
    const repo = new PolicyChatRepository(
      { local, cloud },
      new LocalFirstChatPolicy(routeBook, { defaultBackend: 'cloud', inboxBackends: ['local'] })
    );

    const conversationId = 'c-sync-2';
    local.conversations.push({
      id: conversationId,
      participantIds: ['u1', LEARNING_BOT_USER_ID],
      participants: [
        { userId: 'u1', nativeLang: 'en', learningLang: 'fr' },
        { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      updatedAt: new Date().toISOString(),
      unreadCount: 0,
      title: 'Test',
    });
    cloud.conversations.push({
      id: conversationId,
      participantIds: ['u1', LEARNING_BOT_USER_ID],
      participants: [
        { userId: 'u1', nativeLang: 'en', learningLang: 'de' },
        { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      updatedAt: new Date().toISOString(),
      unreadCount: 0,
      title: 'Test',
    });

    // Pretend the conversation is currently routed to local.
    await routeBook.set(conversationId, 'local');

    const nextParticipants = [
      { userId: 'u1', nativeLang: 'en', learningLang: 'it' },
      { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'it' },
    ];
    await repo.updateParticipants(conversationId, nextParticipants);

    expect((await local.getConversation(conversationId))?.participants).toEqual(nextParticipants);
    expect((await cloud.getConversation(conversationId))?.participants).toEqual(nextParticipants);
  });
});
