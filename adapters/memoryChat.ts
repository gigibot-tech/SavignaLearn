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
import {
  canDeleteForEveryone,
  previewAfterDelete,
  tombstoneMessage,
} from '@/domain/messageDelete';
import { unreadRecipients } from '@/domain/inbox';
import type { ChatRepository } from '@/ports/ports';
import {
  applySnapshot,
  chatStorageKey,
  humanParticipantIds,
  parseChatSnapshot,
  remapChatActorId,
  snapshotForUser,
  type ChatKv,
} from '@/adapters/chatPersistence';

export class InMemoryChatRepository implements ChatRepository {
  conversations: Conversation[] = [];
  messages = new Map<string, SourceMessage[]>();
  translations = new Map<string, LineTranslation[]>();
  private hides = new Map<string, Set<string>>();
  private unread = new Map<string, Map<string, number>>();
  private listeners = new Map<string, Array<(messages: SourceMessage[]) => void>>();
  private readonly hydratedUsers = new Set<string>();
  private hydrateInFlight: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private nextConversationSeq = 0;
  private lastUserId?: string;

  constructor(private readonly kv?: ChatKv) {}

  async hydrateForUser(userId: string, aliases: string[] = []): Promise<void> {
    this.lastUserId = userId;
    const extra = [...new Set(aliases.filter((id) => id && id !== userId))];
    if (this.hydrateInFlight) {
      await this.hydrateInFlight;
    }
    this.hydrateInFlight = (async () => {
      for (const id of extra) {
        if (!this.hydratedUsers.has(id)) await this.loadUser(id);
      }
      if (!this.hydratedUsers.has(userId)) await this.loadUser(userId);
      if (extra.length > 0) {
        for (const fromId of extra) {
          remapChatActorId({
            conversations: this.conversations,
            messages: this.messages,
            fromId,
            toId: userId,
          });
          this.mergeHides(fromId, userId);
          this.mergeUnread(fromId, userId);
        }
        await this.writeUsers([userId, ...extra]);
      }
    })();
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
    const hidden = userId ? this.hiddenSet(userId) : new Set<string>();
    return list
      .map((item) =>
        userId
          ? {
              ...item,
              lastMessagePreview: previewAfterDelete(
                this.messages.get(item.id) ?? [],
                hidden,
                conversationPreviewFor
              ),
              unreadCount: this.unreadCountFor(userId, item.id),
            }
          : item
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getConversation(id: string): Promise<Conversation | null> {
    if (this.lastUserId) await this.hydrateForUser(this.lastUserId);
    else await this.awaitHydrate();
    return this.conversations.find((item) => item.id === id) ?? null;
  }

  async createConversation(input: {
    id?: string;
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<Conversation> {
    await this.awaitHydrate();
    if (input.id) {
      const existing = this.conversations.find((item) => item.id === input.id);
      if (existing) return existing;
    }
    const conversation: Conversation = {
      id: input.id ?? `c-${Date.now()}-${++this.nextConversationSeq}`,
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
    const isNew = existing < 0;
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
      if (isNew && !message.deletedAt) this.bumpUnread(conversation, message.authorId);
    }
    await this.persistConversation(message.conversationId);
    this.emit(message.conversationId);
    return message;
  }

  async deleteMessage(input: {
    messageId: string;
    conversationId: string;
    actorId: string;
    scope: 'me' | 'everyone';
    viewerIds?: string[];
  }): Promise<SourceMessage | null> {
    await this.awaitHydrate();
    this.lastUserId = input.actorId;
    const list = this.messages.get(input.conversationId) ?? [];
    const found = list.find((item) => item.id === input.messageId);
    if (!found) return null;
    if (input.scope === 'me') {
      this.hiddenSet(input.actorId).add(input.messageId);
      await this.persistIds([input.actorId]);
      this.emit(input.conversationId);
      return found;
    }
    const viewerIds = input.viewerIds ?? [input.actorId];
    if (!canDeleteForEveryone(found, viewerIds)) {
      throw new Error('Cannot delete this message for everyone');
    }
    const tombstone = tombstoneMessage(found);
    const index = list.findIndex((item) => item.id === input.messageId);
    list[index] = tombstone;
    this.messages.set(input.conversationId, list);
    this.translations.delete(input.messageId);
    const conversation = this.conversations.find((item) => item.id === input.conversationId);
    if (conversation) {
      const last = list[list.length - 1];
      conversation.lastMessagePreview = last ? conversationPreviewFor(last) : undefined;
      conversation.updatedAt = tombstone.deletedAt ?? conversation.updatedAt;
    }
    await this.persistConversation(input.conversationId);
    this.emit(input.conversationId);
    return tombstone;
  }

  async listHiddenMessageIds(userId: string): Promise<string[]> {
    await this.hydrateForUser(userId);
    return [...this.hiddenSet(userId)];
  }

  async markConversationRead(conversationId: string, userIds: string[]): Promise<void> {
    await this.awaitHydrate();
    const unique = [...new Set(userIds.filter(Boolean))];
    for (const userId of unique) {
      this.unreadFor(userId).set(conversationId, 0);
    }
    if (unique[0]) this.lastUserId = unique[0];
    await this.persistIds(unique);
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

  private hiddenSet(userId: string): Set<string> {
    let set = this.hides.get(userId);
    if (!set) {
      set = new Set();
      this.hides.set(userId, set);
    }
    return set;
  }

  private mergeHides(fromId: string, toId: string): void {
    const from = this.hides.get(fromId);
    if (!from || fromId === toId) return;
    const to = this.hiddenSet(toId);
    for (const id of from) to.add(id);
    this.hides.delete(fromId);
  }

  private unreadFor(userId: string): Map<string, number> {
    let map = this.unread.get(userId);
    if (!map) {
      map = new Map();
      this.unread.set(userId, map);
    }
    return map;
  }

  private unreadCountFor(userId: string, conversationId: string): number {
    const stored = this.unreadFor(userId).get(conversationId);
    if (stored != null) return stored;
    return this.conversations.find((item) => item.id === conversationId)?.unreadCount ?? 0;
  }

  private bumpUnread(conversation: Conversation, authorId: string): void {
    for (const userId of unreadRecipients(conversation.participantIds, authorId)) {
      const map = this.unreadFor(userId);
      map.set(conversation.id, (map.get(conversation.id) ?? 0) + 1);
    }
  }

  private mergeUnread(fromId: string, toId: string): void {
    const from = this.unread.get(fromId);
    if (!from || fromId === toId) return;
    const to = this.unreadFor(toId);
    for (const [conversationId, count] of from) {
      to.set(conversationId, Math.max(to.get(conversationId) ?? 0, count));
    }
    this.unread.delete(fromId);
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
        if (snapshot.hiddenMessageIds?.length) {
          const set = this.hiddenSet(userId);
          for (const id of snapshot.hiddenMessageIds) set.add(id);
        }
        const unreadMap = this.unreadFor(userId);
        for (const conversation of snapshot.conversations) {
          const count = snapshot.unreadCounts?.[conversation.id] ?? conversation.unreadCount ?? 0;
          if (count > 0) unreadMap.set(conversation.id, Math.max(unreadMap.get(conversation.id) ?? 0, count));
        }
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
      const snapshot = snapshotForUser(
        this.conversations,
        this.messages,
        this.translations,
        userId,
        [...this.hiddenSet(userId)],
        Object.fromEntries(this.unreadFor(userId))
      );
      await this.kv.setItem(chatStorageKey(userId), JSON.stringify(snapshot));
    }
  }
}

const DEMO_PARTNERS: ReadonlyArray<{
  id: string;
  name: string;
  lang: string;
  text: string;
  english: string;
  minutesAgo: number;
  unread: boolean;
}> = [
  { id: 'friend-mira', name: 'Mira', lang: 'de', text: 'Guten Morgen! Hast du gut geschlafen?', english: 'Good morning! Did you sleep well?', minutesAgo: 4, unread: true },
  { id: 'demo-sofia', name: 'Sofia', lang: 'es', text: '¿Practicamos español esta noche?', english: 'Shall we practise Spanish tonight?', minutesAgo: 38, unread: true },
  { id: 'demo-yuki', name: 'Yuki', lang: 'ja', text: 'ありがとう、また明日ね！', english: 'Thank you, see you tomorrow!', minutesAgo: 190, unread: false },
  { id: 'demo-luca', name: 'Luca', lang: 'it', text: 'Ci vediamo domani al caffè?', english: 'See you tomorrow at the café?', minutesAgo: 1700, unread: false },
  { id: 'demo-noor', name: 'Noor', lang: 'fr', text: 'Je t’envoie les photos ce soir.', english: 'I’ll send you the photos tonight.', minutesAgo: 3400, unread: true },
  { id: 'friend-alex', name: 'Alex', lang: 'de', text: 'Bis später!', english: 'See you later!', minutesAgo: 9000, unread: false },
  { id: 'demo-kenji', name: 'Kenji', lang: 'ja', text: '今日の宿題、終わった？', english: 'Did you finish today’s homework?', minutesAgo: 12000, unread: false },
  { id: 'demo-amara', name: 'Amara', lang: 'fr', text: 'Merci pour hier, c’était génial !', english: 'Thanks for yesterday, it was great!', minutesAgo: 15000, unread: false },
  { id: 'demo-pablo', name: 'Pablo', lang: 'es', text: 'Nos vemos el viernes.', english: 'See you on Friday.', minutesAgo: 21000, unread: false },
  { id: 'demo-elif', name: 'Elif', lang: 'de', text: 'Ich habe das Buch gefunden!', english: 'I found the book!', minutesAgo: 30000, unread: false },
  { id: 'demo-hanna', name: 'Hanna', lang: 'it', text: 'Che bella giornata oggi.', english: 'What a lovely day today.', minutesAgo: 41000, unread: false },
  { id: 'demo-ravi', name: 'Ravi', lang: 'es', text: '¿Cómo va el curso?', english: 'How is the course going?', minutesAgo: 60000, unread: false },
];

/**
 * Demo mode only: give the offline demo learner a populated inbox (and so a real grid to look at).
 * Runs through the ChatRepository port, so it never touches a configured cloud backend by itself —
 * the caller decides when demo data is appropriate.
 */
export async function seedDemoFriendChats(chat: ChatRepository, viewerId: string): Promise<void> {
  const existing = await chat.listConversations(viewerId);
  for (const partner of DEMO_PARTNERS) {
    const id = `demo-chat-${partner.id}`;
    if (existing.some((item) => item.id === id)) continue;
    await chat.createConversation({
      id,
      title: partner.name,
      aiEnabled: false,
      participantIds: [viewerId, partner.id],
      participants: [
        { userId: viewerId, nativeLang: 'en', learningLang: partner.lang },
        { userId: partner.id, nativeLang: partner.lang, learningLang: 'en' },
      ],
    });
    await chat.appendMessage(
      sourceMessageFromText({
        id: `${id}-m1`,
        conversationId: id,
        authorId: partner.id,
        sourceLang: partner.lang,
        sourceText: partner.text,
        receipt: partner.unread ? 'delivered' : 'read',
        createdAt: new Date(Date.now() - partner.minutesAgo * 60_000).toISOString(),
      })
    );
    await chat.saveTranslations(`${id}-m1`, [
      { lineIndex: 0, targetLang: 'en', text: partner.english, mode: 'lines' },
      { lineIndex: 0, targetLang: partner.lang, text: partner.text, mode: 'lines' },
    ]);
    if (!partner.unread) await chat.markConversationRead(id, [viewerId]);
  }
}
