import { describe, expect, it } from 'vitest';
import { LEARNING_BOT_USER_ID, sourceMessageFromText } from '@/domain/chat';
import { ICESTORM_PROFILE_ID } from '@/domain/friends';
import { ensureLearningBotChat } from './learningBot';
import { InMemoryChatRepository } from './memoryChat';
import { MemoryChatKv, chatStorageKey, loadConversationThread, parseChatSnapshot } from './chatPersistence';
import { InMemoryChatHistoryStore, persistCompletedHistory } from './translation';

const langs = {
  participantIds: ['user-a', LEARNING_BOT_USER_ID],
  participants: [
    { userId: 'user-a', nativeLang: 'en', learningLang: 'de' },
    { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
  ],
  aiEnabled: true,
  title: 'SavignasBoi',
};

describe('persisted in-memory chat', () => {
  it('saves and loads multiple messages with translations for the same user', async () => {
    const kv = new MemoryChatKv();
    const writer = new InMemoryChatRepository(kv);
    const conversation = await writer.createConversation(langs);

    const first = sourceMessageFromText({
      id: 'm-1',
      conversationId: conversation.id,
      authorId: 'user-a',
      sourceLang: 'en',
      sourceText: 'heeyy',
      receipt: 'delivered',
    });
    const second = sourceMessageFromText({
      id: 'm-2',
      conversationId: conversation.id,
      authorId: LEARNING_BOT_USER_ID,
      sourceLang: 'de',
      sourceText: 'Hallo! Wie geht’s?',
      kind: 'ai',
      receipt: 'sent',
    });
    const third = sourceMessageFromText({
      id: 'm-3',
      conversationId: conversation.id,
      authorId: 'user-a',
      sourceLang: 'en',
      sourceText: 'another one',
      receipt: 'delivered',
    });

    await writer.appendMessage(first);
    await writer.saveTranslations('m-1', [
      { lineIndex: 0, targetLang: 'de', text: 'heeyy', mode: 'lines' },
    ]);
    await writer.appendMessage(second);
    await writer.saveTranslations('m-2', [
      { lineIndex: 0, targetLang: 'en', text: 'Hello! How’s it going?', mode: 'lines' },
    ]);
    await writer.appendMessage(third);
    await writer.flush();

    const stored = parseChatSnapshot(await kv.getItem(chatStorageKey('user-a')));
    expect(stored?.messages[conversation.id]).toHaveLength(3);

    const reader = new InMemoryChatRepository(kv);
    await reader.hydrateForUser('user-a');
    const loaded = await reader.listMessages(conversation.id);
    expect(loaded.map((item) => item.sourceText)).toEqual(['heeyy', 'Hallo! Wie geht’s?', 'another one']);
    expect(await reader.listTranslations('m-1')).toEqual([
      { lineIndex: 0, targetLang: 'de', text: 'heeyy', mode: 'lines' },
    ]);
    expect(await reader.listTranslations('m-2')).toEqual([
      { lineIndex: 0, targetLang: 'en', text: 'Hello! How’s it going?', mode: 'lines' },
    ]);
  });

  it('does not let seedDemo wipe messages restored from storage', async () => {
    const kv = new MemoryChatKv();
    const writer = new InMemoryChatRepository(kv);
    const botId = await ensureLearningBotChat(writer, 'user-a');
    await writer.appendMessage(
      sourceMessageFromText({
        id: 'later',
        conversationId: botId,
        authorId: 'user-a',
        sourceLang: 'en',
        sourceText: 'heeyy',
        receipt: 'delivered',
      })
    );
    await writer.flush();

    const reader = new InMemoryChatRepository(kv);
    const restoredId = await ensureLearningBotChat(reader, 'user-a');
    expect(restoredId).toBe(botId);
    const loaded = await reader.listMessages(restoredId);
    expect(loaded.some((item) => item.sourceText === 'heeyy')).toBe(true);
    expect(loaded.length).toBeGreaterThan(1);

    reader.seedDemo('user-a', LEARNING_BOT_USER_ID);
    const afterSeed = await reader.listMessages(restoredId);
    expect(afterSeed.some((item) => item.sourceText === 'heeyy')).toBe(true);
    expect(afterSeed.map((item) => item.id)).toEqual(loaded.map((item) => item.id));
  });

  it('keeps users isolated in storage keys', async () => {
    const kv = new MemoryChatKv();
    const chat = new InMemoryChatRepository(kv);
    const a = await chat.createConversation(langs);
    await chat.appendMessage(
      sourceMessageFromText({
        id: 'only-a',
        conversationId: a.id,
        authorId: 'user-a',
        sourceLang: 'en',
        sourceText: 'secret a',
        receipt: 'sent',
      })
    );
    const b = await chat.createConversation({
      ...langs,
      participantIds: ['user-b', LEARNING_BOT_USER_ID],
      participants: [
        { userId: 'user-b', nativeLang: 'en', learningLang: 'de' },
        { userId: LEARNING_BOT_USER_ID, nativeLang: 'de', learningLang: 'en' },
      ],
    });
    await chat.appendMessage(
      sourceMessageFromText({
        id: 'only-b',
        conversationId: b.id,
        authorId: 'user-b',
        sourceLang: 'en',
        sourceText: 'secret b',
        receipt: 'sent',
      })
    );

    const other = new InMemoryChatRepository(kv);
    await other.hydrateForUser('user-b');
    expect((await other.listMessages(a.id)).map((item) => item.sourceText)).toEqual([]);
    expect((await other.listMessages(b.id)).map((item) => item.sourceText)).toEqual(['secret b']);
  });

  it('loadConversationThread returns every stored message and merged translations', async () => {
    const kv = new MemoryChatKv();
    const chat = new InMemoryChatRepository(kv);
    const conversation = await chat.createConversation(langs);
    await chat.appendMessage(
      sourceMessageFromText({
        id: 'repo-1',
        conversationId: conversation.id,
        authorId: 'user-a',
        sourceLang: 'en',
        sourceText: 'from repo',
        receipt: 'sent',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );
    await chat.saveTranslations('repo-1', [
      { lineIndex: 0, targetLang: 'de', text: 'aus dem repo', mode: 'lines' },
    ]);
    const extra = sourceMessageFromText({
      id: 'hist-1',
      conversationId: conversation.id,
      authorId: LEARNING_BOT_USER_ID,
      sourceLang: 'de',
      sourceText: 'from history',
      kind: 'ai',
      receipt: 'sent',
      createdAt: '2026-01-01T00:01:00.000Z',
    });
    const records = [
      {
        id: extra.id,
        conversationId: extra.conversationId,
        message: extra,
        translationMode: 'standard' as const,
        translations: [{ lineIndex: 0, targetLang: 'en', text: 'from history EN', mode: 'lines' as const }],
        pipelineState: 'persisted' as const,
        updatedAt: extra.createdAt,
      },
    ];
    const historyStore = {
      async save(record: (typeof records)[number]) {
        records.push(record);
        return record;
      },
      async get(id: string) {
        return records.find((item) => item.id === id) ?? null;
      },
      async listByConversation(conversationId: string) {
        return records.filter((item) => item.conversationId === conversationId);
      },
    };

    const loaded = await loadConversationThread({
      chat,
      historyStore,
      conversationId: conversation.id,
      userId: 'user-a',
    });
    expect(loaded.messages.map((item) => item.sourceText)).toEqual(['from repo', 'from history']);
    expect(loaded.translations['repo-1']?.[0]?.text).toBe('aus dem repo');
    expect(loaded.translations['hist-1']?.[0]?.text).toBe('from history EN');
  });
});

describe('persisted chat history store', () => {
  it('reloads pipeline translations after a new store instance', async () => {
    const kv = new MemoryChatKv();
    const writer = new InMemoryChatHistoryStore(kv);
    await writer.hydrateForUser('user-a');
    const message = sourceMessageFromText({
      id: 'hist-msg',
      conversationId: 'c-1',
      authorId: 'user-a',
      sourceLang: 'es',
      sourceText: 'Hola',
    });
    await persistCompletedHistory({
      store: writer,
      message,
      translations: [
        { lineIndex: 0, targetLang: 'en', text: 'Hi', mode: 'lines' },
        { lineIndex: 0, targetLang: 'en', text: 'Hola [Hi]', mode: 'birkenbihl' },
      ],
    });

    const reader = new InMemoryChatHistoryStore(kv);
    await reader.hydrateForUser('user-a');
    const loaded = await reader.get('hist-msg');
    expect(loaded?.message.sourceText).toBe('Hola');
    expect(loaded?.translations.find((row) => row.mode === 'lines')?.text).toBe('Hi');
    expect(loaded?.translations.find((row) => row.mode === 'birkenbihl')?.text).toBe('Hola [Hi]');
  });

  it('lets icestormfroste hydrate a DM written to the stub friend id', async () => {
    const kv = new MemoryChatKv();
    const savina = new InMemoryChatRepository(kv);
    const conversation = await savina.createConversation({
      participantIds: ['savina-live', ICESTORM_PROFILE_ID],
      participants: [
        { userId: 'savina-live', nativeLang: 'en', learningLang: 'de' },
        { userId: ICESTORM_PROFILE_ID, nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      title: 'icestormfroste',
    });
    await savina.appendMessage(
      sourceMessageFromText({
        id: 'from-savina',
        conversationId: conversation.id,
        authorId: 'savina-live',
        sourceLang: 'en',
        sourceText: 'btw ich schicke dir morgen eine App',
        receipt: 'sent',
      })
    );

    const ice = new InMemoryChatRepository(kv);
    await ice.hydrateForUser('ice-live', [ICESTORM_PROFILE_ID]);
    const inbox = await ice.listConversations('ice-live');
    expect(inbox.map((item) => item.id)).toContain(conversation.id);
    expect((await ice.listMessages(conversation.id)).map((item) => item.sourceText)).toEqual([
      'btw ich schicke dir morgen eine App',
    ]);
  });
});
