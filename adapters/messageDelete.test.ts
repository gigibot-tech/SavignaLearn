import { describe, expect, it } from 'vitest';
import { conversationPreviewFor, sourceMessageFromText } from '@/domain/chat';
import { InMemoryChatRepository } from './memoryChat';
import { MemoryChatKv, parseChatSnapshot, chatStorageKey } from './chatPersistence';
import { InMemoryChatRouteBook, LocalFirstChatPolicy, PolicyChatRepository } from './chatCloud';

describe('WhatsApp-like message delete', () => {
  it('hides a message only for that viewer and tombstones it for everyone', async () => {
    const chat = new InMemoryChatRepository();
    const conv = await chat.createConversation({
      participantIds: ['learn', 'ice'],
      participants: [
        { userId: 'learn', nativeLang: 'en', learningLang: 'de' },
        { userId: 'ice', nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      title: 'Ice',
    });
    const mine = await chat.appendMessage(
      sourceMessageFromText({
        id: 'm-mine',
        conversationId: conv.id,
        authorId: 'learn',
        sourceLang: 'en',
        sourceText: 'hello ice',
        receipt: 'sent',
      })
    );
    await chat.appendMessage(
      sourceMessageFromText({
        id: 'm-theirs',
        conversationId: conv.id,
        authorId: 'ice',
        sourceLang: 'en',
        sourceText: 'hi learn',
        receipt: 'sent',
      })
    );

    await chat.deleteMessage({
      messageId: mine.id,
      conversationId: conv.id,
      actorId: 'ice',
      scope: 'me',
    });
    expect(await chat.listHiddenMessageIds('ice')).toEqual(['m-mine']);
    expect(await chat.listHiddenMessageIds('learn')).toEqual([]);
    expect((await chat.listConversations('ice'))[0]?.lastMessagePreview).toBe('hi learn');
    expect((await chat.listConversations('learn'))[0]?.lastMessagePreview).toBe('hi learn');

    const gone = await chat.deleteMessage({
      messageId: 'm-theirs',
      conversationId: conv.id,
      actorId: 'ice',
      scope: 'everyone',
      viewerIds: ['ice'],
    });
    expect(gone?.deletedAt).toBeTruthy();
    expect(gone?.sourceText).toBe('');
    expect((await chat.listMessages(conv.id)).find((item) => item.id === 'm-theirs')?.deletedAt).toBeTruthy();
    expect((await chat.listConversations('learn'))[0]?.lastMessagePreview).toBe(
      conversationPreviewFor(gone!)
    );
  });

  it('persists delete-for-me hides in the local snapshot', async () => {
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
        id: 'hide-me',
        conversationId: conv.id,
        authorId: 'ice',
        sourceLang: 'en',
        sourceText: 'gone for learn only',
        receipt: 'sent',
      })
    );
    await writer.deleteMessage({
      messageId: 'hide-me',
      conversationId: conv.id,
      actorId: 'learn',
      scope: 'me',
    });
    const snapshot = parseChatSnapshot(await kv.getItem(chatStorageKey('learn')));
    expect(snapshot?.hiddenMessageIds).toEqual(['hide-me']);

    const reader = new InMemoryChatRepository(kv);
    expect(await reader.listHiddenMessageIds('learn')).toEqual(['hide-me']);
  });

  it('dual-writes delete for everyone on a shared human DM', async () => {
    const local = new InMemoryChatRepository();
    const cloud = new InMemoryChatRepository();
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
    });
    await repo.appendMessage(
      sourceMessageFromText({
        id: 'shared-1',
        conversationId: conv.id,
        authorId: 'learn',
        sourceLang: 'en',
        sourceText: 'please unsend',
        receipt: 'sent',
      })
    );
    await repo.hydrateForUser('learn');
    await repo.deleteMessage({
      messageId: 'shared-1',
      conversationId: conv.id,
      actorId: 'learn',
      scope: 'everyone',
      viewerIds: ['learn'],
    });
    expect((await local.listMessages(conv.id))[0]?.deletedAt).toBeTruthy();
    expect((await cloud.listMessages(conv.id))[0]?.deletedAt).toBeTruthy();
    expect((await repo.listMessages(conv.id))[0]?.sourceText).toBe('');
  });
});
