import { describe, expect, it } from 'vitest';
import { sourceMessageFromText } from '@/domain/chat';
import {
  InMemoryChatRouteBook,
  LocalFirstChatPolicy,
  PolicyChatRepository,
} from './chatCloud';
import { InMemoryChatRepository } from './memoryChat';
import { LEARNING_BOT_USER_ID } from '@/domain/chat';

/** A cloud stand-in that counts inbox reads. (Spreading an instance would drop its prototype methods.) */
class CountingCloud extends InMemoryChatRepository {
  listCalls = 0;

  override async listConversations(userId: string) {
    this.listCalls += 1;
    return super.listConversations(userId);
  }
}

describe('PolicyChatRepository', () => {
  it('stays local-first and does not hit cloud on inbox load', async () => {
    const cloud = new CountingCloud();
    const local = new InMemoryChatRepository();
    const repo = new PolicyChatRepository(
      { local, cloud },
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
    expect(cloud.listCalls).toBe(0);
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

  it('shares a human DM to cloud and merges duplicate timestamps', async () => {
    const cloud = new InMemoryChatRepository();
    const local = new InMemoryChatRepository();
    const repo = new PolicyChatRepository(
      { local, cloud },
      new LocalFirstChatPolicy(new InMemoryChatRouteBook(), {
        shareHumanDms: true,
        inboxBackends: ['local', 'cloud'],
      })
    );
    const conv = await repo.createConversation({
      participantIds: ['learn', 'ice'],
      participants: [
        { userId: 'learn', nativeLang: 'en', learningLang: 'de' },
        { userId: 'ice', nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      title: 'Ice',
    });
    expect(conv.id).toBe('dm:ice:learn');
    expect((await cloud.listConversations('learn')).map((item) => item.id)).toContain(conv.id);
    expect((await local.listConversations('learn')).map((item) => item.id)).toContain(conv.id);

    await repo.appendMessage(
      sourceMessageFromText({
        id: 'm-local',
        conversationId: conv.id,
        authorId: 'learn',
        sourceLang: 'en',
        sourceText: 'same line',
        createdAt: '2026-09-03T12:00:00.000Z',
        receipt: 'sent',
      })
    );
    await cloud.appendMessage(
      sourceMessageFromText({
        id: 'm-cloud-copy',
        conversationId: conv.id,
        authorId: 'learn',
        sourceLang: 'en',
        sourceText: 'same line',
        createdAt: '2026-09-03T12:00:00.800Z',
        receipt: 'sent',
      })
    );
    const timeline = await repo.listMessages(conv.id);
    expect(timeline.filter((item) => item.sourceText === 'same line')).toHaveLength(1);
    expect((await repo.listConversations('ice')).map((item) => item.id)).toContain(conv.id);
  });

  it('uploads an existing local human DM to cloud when the thread is opened', async () => {
    const cloud = new InMemoryChatRepository();
    const local = new InMemoryChatRepository();
    const localOnly = new PolicyChatRepository(
      { local, cloud },
      new LocalFirstChatPolicy(new InMemoryChatRouteBook())
    );
    const conv = await localOnly.createConversation({
      participantIds: ['learn', 'ice'],
      participants: [
        { userId: 'learn', nativeLang: 'en', learningLang: 'de' },
        { userId: 'ice', nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      title: 'Ice',
    });
    await localOnly.appendMessage(
      sourceMessageFromText({
        id: 'old-local',
        conversationId: conv.id,
        authorId: 'learn',
        sourceLang: 'en',
        sourceText: 'from this device',
        createdAt: '2026-09-03T12:00:00.000Z',
        receipt: 'sent',
      })
    );
    expect(await cloud.listConversations('learn')).toEqual([]);

    const shared = new PolicyChatRepository(
      { local, cloud },
      new LocalFirstChatPolicy(new InMemoryChatRouteBook(), {
        shareHumanDms: true,
        inboxBackends: ['local', 'cloud'],
      })
    );
    const cloudId = await shared.ensureHumanDmCloud(conv.id);
    expect(cloudId).toBe('dm:ice:learn');
    expect((await cloud.listMessages(cloudId!)).map((item) => item.sourceText)).toEqual([
      'from this device',
    ]);
  });
});
