/**
 * In-memory ChatRepository with optional local KV persistence (no react-native).
 */

import {
  LEARNING_BOT_USER_ID,
  conversationPreviewFor,
  sourceMessageFromText,
  type Conversation,
  type LineTranslation,
  type ReceiptStatus,
  type SourceMessage,
} from '@/domain/chat';
import type { ChatRepository } from '@/ports/ports';
import {
  applySnapshot,
  chatStorageKey,
  humanParticipantIds,
  parseChatSnapshot,
  snapshotForUser,
  type ChatKv,
} from '@/adapters/chatPersistence';

export class InMemoryChatRepository implements ChatRepository {
  conversations: Conversation[] = [];
  messages = new Map<string, SourceMessage[]>();
  translations = new Map<string, LineTranslation[]>();
  private listeners = new Map<string, Array<(messages: SourceMessage[]) => void>>();
  private readonly hydratedUsers = new Set<string>();
  private hydrateInFlight: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private nextConversationSeq = 0;
  private lastUserId?: string;

  constructor(private readonly kv?: ChatKv) {}

  async hydrateForUser(userId: string): Promise<void> {
    this.lastUserId = userId;
    if (!this.kv || this.hydratedUsers.has(userId)) return;
    if (this.hydrateInFlight) {
      await this.hydrateInFlight;
      if (this.hydratedUsers.has(userId)) return;
    }
    this.hydrateInFlight = this.loadUser(userId);
    try {
      await this.hydrateInFlight;
    } finally {
      this.hydrateInFlight = null;
    }
  }

  async flush(): Promise<void> {
    await this.persistQueue;
  }

  seedDemo(viewerId: string, partnerId: string) {
    const existingForViewer = this.conversations.find(
      (item) =>
        item.participantIds.includes(viewerId) &&
        (item.participantIds.includes(partnerId) || item.id === 'demo-1')
    );
    if (existingForViewer) {
      const stored = this.messages.get(existingForViewer.id) ?? [];
      if (stored.length > 0) {
        this.schedulePersist([viewerId]);
        return;
      }
    }
    const demo1 = this.conversations.find((item) => item.id === 'demo-1');
    if (demo1 && !demo1.participantIds.includes(viewerId)) {
      return;
    }
    if (demo1) {
      this.schedulePersist([viewerId]);
      return;
    }
    const conversation: Conversation = {
      id: 'demo-1',
      participantIds: [viewerId, partnerId],
      participants: [
        { userId: viewerId, nativeLang: 'en', learningLang: 'de' },
        { userId: partnerId, nativeLang: 'de', learningLang: 'en' },
      ],
      aiEnabled: true,
      updatedAt: new Date().toISOString(),
      lastMessagePreview: 'Guten Morgen',
      unreadCount: 1,
      title: 'Alex · DE↔EN',
    };
    this.conversations.unshift(conversation);
    if (!this.messages.has('demo-1')) {
      this.messages.set('demo-1', [
        sourceMessageFromText({
          id: 'msg-1',
          conversationId: 'demo-1',
          authorId: partnerId,
          sourceLang: 'de',
          sourceText: 'Guten Morgen\nWie geht es dir?',
          kind: partnerId === LEARNING_BOT_USER_ID ? 'ai' : 'user',
          receipt: 'read',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ]);
      this.translations.set('msg-1', [
        { lineIndex: 0, targetLang: 'en', text: 'Good morning', mode: 'lines' },
        { lineIndex: 1, targetLang: 'en', text: 'How are you?', mode: 'lines' },
        { lineIndex: 0, targetLang: 'de', text: 'Guten Morgen', mode: 'lines' },
        { lineIndex: 1, targetLang: 'de', text: 'Wie geht es dir?', mode: 'lines' },
      ]);
    }
    this.schedulePersist([viewerId]);
  }

  async listConversations(userId?: string): Promise<Conversation[]> {
    if (userId) await this.hydrateForUser(userId);
    await this.awaitHydrate();
    const list = userId
      ? this.conversations.filter((item) => item.participantIds.includes(userId))
      : [...this.conversations];
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getConversation(id: string): Promise<Conversation | null> {
    if (this.lastUserId) await this.hydrateForUser(this.lastUserId);
    else await this.awaitHydrate();
    return this.conversations.find((item) => item.id === id) ?? null;
  }

  async createConversation(input: {
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<Conversation> {
    await this.awaitHydrate();
    const conversation: Conversation = {
      id: `c-${Date.now()}-${++this.nextConversationSeq}`,
      participantIds: input.participantIds,
      participants: input.participants,
      aiEnabled: input.aiEnabled,
      title: input.title,
      updatedAt: new Date().toISOString(),
      unreadCount: 0,
    };
    this.conversations.unshift(conversation);
    this.messages.set(conversation.id, []);
    const humans = humanParticipantIds(conversation);
    if (humans[0]) this.lastUserId = humans[0];
    await this.persistIds(humans);
    return conversation;
  }

  async listMessages(conversationId: string): Promise<SourceMessage[]> {
    if (this.lastUserId) await this.hydrateForUser(this.lastUserId);
    else await this.awaitHydrate();
    return [...(this.messages.get(conversationId) ?? [])];
  }

  async appendMessage(message: SourceMessage): Promise<SourceMessage> {
    await this.awaitHydrate();
    const list = this.messages.get(message.conversationId) ?? [];
    const existing = list.findIndex((item) => item.id === message.id);
    if (existing >= 0) {
      list[existing] = message;
    } else {
      list.push(message);
    }
    this.messages.set(message.conversationId, list);
    const conversation = this.conversations.find((item) => item.id === message.conversationId);
    if (conversation) {
      conversation.lastMessagePreview = conversationPreviewFor(message);
      conversation.updatedAt = message.createdAt;
    }
    await this.persistConversation(message.conversationId);
    this.emit(message.conversationId);
    return message;
  }

  async updateReceipt(messageId: string, receipt: ReceiptStatus): Promise<void> {
    await this.awaitHydrate();
    for (const [conversationId, list] of this.messages) {
      const found = list.find((item) => item.id === messageId);
      if (found) {
        found.receipt = receipt;
        await this.persistConversation(conversationId);
        this.emit(conversationId);
        return;
      }
    }
  }

  async saveTranslations(messageId: string, translations: LineTranslation[]): Promise<void> {
    await this.awaitHydrate();
    const existing = this.translations.get(messageId) ?? [];
    const byKey = new Map(
      existing.map((t) => [`${t.lineIndex}:${t.targetLang}:${t.mode}`, t] as const)
    );
    for (const item of translations) {
      byKey.set(`${item.lineIndex}:${item.targetLang}:${item.mode}`, item);
    }
    this.translations.set(messageId, [...byKey.values()]);
    const conversationId = this.conversationIdForMessage(messageId);
    if (conversationId) await this.persistConversation(conversationId);
  }

  async listTranslations(messageId: string): Promise<LineTranslation[]> {
    if (this.lastUserId) await this.hydrateForUser(this.lastUserId);
    else await this.awaitHydrate();
    return this.translations.get(messageId) ?? [];
  }

  async updateParticipants(
    conversationId: string,
    participants: Conversation['participants']
  ): Promise<void> {
    await this.awaitHydrate();
    const conversation = this.conversations.find((item) => item.id === conversationId);
    if (conversation) {
      conversation.participants = participants;
      await this.persistConversation(conversationId);
    }
  }

  subscribe(conversationId: string, onChange: (messages: SourceMessage[]) => void): () => void {
    const current = this.listeners.get(conversationId) ?? [];
    current.push(onChange);
    this.listeners.set(conversationId, current);
    return () => {
      this.listeners.set(
        conversationId,
        (this.listeners.get(conversationId) ?? []).filter((fn) => fn !== onChange)
      );
    };
  }

  private emit(conversationId: string) {
    const messages = this.messages.get(conversationId) ?? [];
    for (const listener of this.listeners.get(conversationId) ?? []) {
      listener([...messages]);
    }
  }

  private conversationIdForMessage(messageId: string): string | undefined {
    for (const [conversationId, list] of this.messages) {
      if (list.some((item) => item.id === messageId)) return conversationId;
    }
    return undefined;
  }

  private async awaitHydrate(): Promise<void> {
    if (this.hydrateInFlight) await this.hydrateInFlight;
  }

  private async loadUser(userId: string): Promise<void> {
    if (!this.kv) return;
    try {
      const raw = await this.kv.getItem(chatStorageKey(userId));
      const snapshot = parseChatSnapshot(raw);
      if (snapshot) {
        this.conversations = applySnapshot(
          this.conversations,
          this.messages,
          this.translations,
          snapshot
        );
      }
    } catch {
      // Keep going with whatever is already in memory.
    }
    this.hydratedUsers.add(userId);
  }

  private schedulePersist(userIds: string[]) {
    this.persistQueue = this.persistQueue.then(() => this.writeUsers(userIds)).catch(() => undefined);
  }

  private async persistConversation(conversationId: string): Promise<void> {
    const conversation = this.conversations.find((item) => item.id === conversationId);
    await this.persistIds(humanParticipantIds(conversation));
  }

  async persistUser(userId: string): Promise<void> {
    await this.persistIds([userId]);
  }

  private async persistIds(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    this.persistQueue = this.persistQueue.then(() => this.writeUsers(unique)).catch(() => undefined);
    await this.persistQueue;
  }

  private async writeUsers(userIds: string[]): Promise<void> {
    if (!this.kv) return;
    for (const userId of userIds) {
      const snapshot = snapshotForUser(this.conversations, this.messages, this.translations, userId);
      await this.kv.setItem(chatStorageKey(userId), JSON.stringify(snapshot));
    }
  }
}
