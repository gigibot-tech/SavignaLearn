import type { Conversation, LineTranslation, ReceiptStatus, SourceMessage } from '@/domain/chat';
import {
  collapseDuplicateDirectChats,
  collapseDuplicateLearningBots,
  directConversationId,
  humanDirectPairKey,
  isHumanDirectChat,
  isLearningBotConversation,
  mergeMessageTimelines,
} from '@/domain/chat';
import { canonicalChatActorId } from '@/domain/friends';
import { messagesVisibleToViewer } from '@/domain/messageDelete';
import type { ChatRepository } from '@/ports/ports';

export type ChatStorageBackendId = 'local' | 'cloud';

type MemoryCompatibleChat = ChatRepository & {
  conversations: Conversation[];
  seedDemo?: (viewerId: string, partnerId: string) => void;
  hydrateForUser?: (userId: string, aliases?: string[]) => Promise<void>;
  persistUser?: (userId: string) => Promise<void>;
};

function participantsLanguageKey(participants: Conversation['participants']): string {
  // Order-independent snapshot to compare language settings.
  return [...participants]
    .map((p) => `${p.userId}:${p.nativeLang}:${p.learningLang}`)
    .sort()
    .join('|');
}

export interface ChatRouteBook {
  get(conversationId: string): Promise<ChatStorageBackendId | null>;
  set(conversationId: string, backend: ChatStorageBackendId): Promise<void>;
  getConversationForMessage(messageId: string): Promise<string | null>;
  setConversationForMessage(messageId: string, conversationId: string): Promise<void>;
}

export class InMemoryChatRouteBook implements ChatRouteBook {
  constructor(
    private readonly routes = new Map<string, ChatStorageBackendId>(),
    private readonly messages = new Map<string, string>()
  ) {}

  async get(conversationId: string): Promise<ChatStorageBackendId | null> {
    return this.routes.get(conversationId) ?? null;
  }

  async set(conversationId: string, backend: ChatStorageBackendId): Promise<void> {
    this.routes.set(conversationId, backend);
  }

  async getConversationForMessage(messageId: string): Promise<string | null> {
    return this.messages.get(messageId) ?? null;
  }

  async setConversationForMessage(messageId: string, conversationId: string): Promise<void> {
    this.messages.set(messageId, conversationId);
  }
}

export interface ChatStoragePolicy {
  inboxBackends(userId: string): Promise<ChatStorageBackendId[]>;
  backendForConversation(conversationId: string): Promise<ChatStorageBackendId>;
  backendForNewConversation(input: {
    id?: string;
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<ChatStorageBackendId>;
  rememberConversation(conversationId: string, backend: ChatStorageBackendId): Promise<void>;
  dualWriteHumanDms?(): boolean;
}

export class LocalFirstChatPolicy implements ChatStoragePolicy {
  constructor(
    private readonly routeBook: ChatRouteBook,
    private readonly options: {
      defaultBackend?: ChatStorageBackendId;
      inboxBackends?: ChatStorageBackendId[];
      shareHumanDms?: boolean;
    } = {}
  ) {}

  async inboxBackends(): Promise<ChatStorageBackendId[]> {
    return this.options.inboxBackends ?? ['local'];
  }

  async backendForConversation(conversationId: string): Promise<ChatStorageBackendId> {
    return (await this.routeBook.get(conversationId)) ?? (this.options.defaultBackend ?? 'local');
  }

  async backendForNewConversation(input: {
    participantIds: string[];
  }): Promise<ChatStorageBackendId> {
    if (this.options.defaultBackend) return this.options.defaultBackend;
    if (this.options.shareHumanDms && isHumanDirectChat(input.participantIds)) return 'cloud';
    return 'local';
  }

  async rememberConversation(
    conversationId: string,
    backend: ChatStorageBackendId
  ): Promise<void> {
    await this.routeBook.set(conversationId, backend);
  }

  dualWriteHumanDms(): boolean {
    return Boolean(this.options.shareHumanDms);
  }
}

/** One repository interface, explicit backends, policy-driven routing. */
export class PolicyChatRepository implements ChatRepository {
  private lastUserId?: string;

  constructor(
    private readonly backends: Record<ChatStorageBackendId, ChatRepository>,
    private readonly policy: ChatStoragePolicy,
    private readonly routeBook?: ChatRouteBook
  ) {}

  get conversations(): Conversation[] {
    return this.localMemory()?.conversations ?? [];
  }

  async hydrateForUser(userId: string, aliases?: string[]): Promise<void> {
    this.lastUserId = userId;
    await this.localMemory()?.hydrateForUser?.(userId, aliases);
  }

  async persistUser(userId: string): Promise<void> {
    await this.localMemory()?.persistUser?.(userId);
  }

  seedDemo(viewerId: string, partnerId: string): void {
    this.localMemory()?.seedDemo?.(viewerId, partnerId);
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    this.lastUserId = userId;
    const seen = new Map<string, Conversation>();
    for (const backendId of await this.policy.inboxBackends(userId)) {
      try {
        const list = await this.repo(backendId).listConversations(userId);
        for (const conversation of list) {
          seen.set(conversation.id, conversation);
          await this.policy.rememberConversation(conversation.id, backendId);
        }
      } catch {
        continue;
      }
    }
    const merged = collapseDuplicateDirectChats(
      collapseDuplicateLearningBots([...seen.values()]),
      canonicalChatActorId
    );
    const localList = await this.backends.local.listConversations(userId).catch(() => []);
    const localById = new Map(localList.map((item) => [item.id, item]));
    const localMessages = this.localMemory()?.messages;
    return merged
      .map((item) => {
        const local = localById.get(item.id);
        const localCount = localMessages?.get(item.id)?.length ?? 0;
        if (!local) return item;
        return {
          ...item,
          lastMessagePreview: localCount > 0 ? local.lastMessagePreview : item.lastMessagePreview,
          unreadCount:
            local.unreadCount > 0 || localCount > 0 ? local.unreadCount : item.unreadCount,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const preferred = await this.policy.backendForConversation(id);
    let conv = await this.repo(preferred).getConversation(id).catch(() => null);
    if (!conv) {
      const other: ChatStorageBackendId = preferred === 'cloud' ? 'local' : 'cloud';
      conv = await this.repo(other).getConversation(id).catch(() => null);
      if (conv) await this.policy.rememberConversation(id, other);
    }

    // When the conversation is loaded from cloud, ensure its participants language settings
    // match the local snapshot (so UI labels like “They read …” stay correct after
    // switching between local and cloud).
    if (!conv) return null;
    const backendId = (await this.policy.backendForConversation(id)) ?? preferred;
    if (backendId !== 'cloud') return conv;

    const local = this.backends.local as MemoryCompatibleChat;
    const hydrateUserId = conv.participants?.[0]?.userId;
    if (hydrateUserId) {
      await local.hydrateForUser?.(hydrateUserId).catch(() => undefined);
    }

    const localConv = await local.getConversation(id).catch(() => null);
    if (!localConv) return conv;

    if (
      participantsLanguageKey(localConv.participants) ===
      participantsLanguageKey(conv.participants)
    ) {
      return conv;
    }

    await this.backends.cloud
      .updateParticipants(id, localConv.participants)
      .catch(() => undefined);

    return { ...conv, participants: localConv.participants };
  }

  async createConversation(input: {
    id?: string;
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<Conversation> {
    const share = this.shareHumanDms() && isHumanDirectChat(input.participantIds);
    const participantIds = share ? input.participantIds.map(canonicalChatActorId) : input.participantIds;
    const participants = share
      ? input.participants.map((item) => ({ ...item, userId: canonicalChatActorId(item.userId) }))
      : input.participants;
    const id =
      input.id ??
      (share && participantIds.length === 2
        ? directConversationId(participantIds[0], participantIds[1])
        : undefined);
    const payload = { ...input, id, participantIds, participants };
    const backendId = await this.policy.backendForNewConversation(payload);
    let conversation: Conversation;
    try {
      conversation = await this.repo(backendId).createConversation(payload);
    } catch (error) {
      if (backendId !== 'cloud') throw error;
      conversation = await this.backends.local.createConversation(payload);
      await this.policy.rememberConversation(conversation.id, 'local');
      return conversation;
    }
    await this.policy.rememberConversation(conversation.id, backendId);
    if (share) {
      const other = backendId === 'cloud' ? this.backends.local : this.backends.cloud;
      await other.createConversation({ ...payload, id: conversation.id }).catch(() => undefined);
    }
    return conversation;
  }

  async listMessages(conversationId: string): Promise<SourceMessage[]> {
    if (!this.shareHumanDms()) {
      const messages = await this.repoForConversation(conversationId).then((repo) =>
        repo.listMessages(conversationId)
      );
      for (const message of messages) {
        await this.routeBook?.setConversationForMessage(message.id, conversationId);
      }
      return this.applyHides(messages);
    }
    const lists: SourceMessage[][] = [];
    for (const id of this.siblingConversationIds(conversationId)) {
      lists.push(await this.safeListMessages('local', id));
      lists.push(await this.safeListMessages('cloud', id));
    }
    const merged = mergeMessageTimelines(...lists).map((message) => ({
      ...message,
      conversationId,
    }));
    for (const message of merged) {
      await this.routeBook?.setConversationForMessage(message.id, conversationId);
    }
    return this.applyHides(merged);
  }

  async deleteMessage(input: {
    messageId: string;
    conversationId: string;
    actorId: string;
    scope: 'me' | 'everyone';
    viewerIds?: string[];
  }): Promise<SourceMessage | null> {
    this.lastUserId = input.actorId;
    const conv =
      (await this.backends.local.getConversation(input.conversationId).catch(() => null)) ??
      (await this.getConversation(input.conversationId).catch(() => null));
    const payload = { ...input, viewerIds: input.viewerIds ?? [input.actorId] };
    if (!this.shouldCloudSave(conv, input.conversationId)) {
      return (await this.repoForConversation(input.conversationId)).deleteMessage(payload);
    }
    const local = await this.backends.local.deleteMessage(payload).catch(() => null);
    const cloudId = this.cloudConversationId(conv, input.conversationId);
    await this.backends.cloud
      .deleteMessage({ ...payload, conversationId: cloudId })
      .catch(() => undefined);
    return local;
  }

  async listHiddenMessageIds(userId: string): Promise<string[]> {
    this.lastUserId = userId;
    const ids = new Set<string>();
    for (const backendId of ['local', 'cloud'] as const) {
      try {
        for (const id of await this.repo(backendId).listHiddenMessageIds(userId)) {
          ids.add(id);
        }
      } catch {
        continue;
      }
    }
    return [...ids];
  }

  async markConversationRead(conversationId: string, userIds: string[]): Promise<void> {
    if (userIds[0]) this.lastUserId = userIds[0];
    await this.backends.local.markConversationRead(conversationId, userIds).catch(() => undefined);
    if (this.shareHumanDms()) {
      await this.backends.cloud.markConversationRead(conversationId, userIds).catch(() => undefined);
    }
  }

  async appendMessage(message: SourceMessage): Promise<SourceMessage> {
    const conv =
      (await this.backends.local.getConversation(message.conversationId).catch(() => null)) ??
      (await this.getConversation(message.conversationId).catch(() => null));
    const share = this.shouldCloudSave(conv, message.conversationId);
    if (!share) {
      const saved = await this.repoForConversation(message.conversationId).then((repo) =>
        repo.appendMessage(message)
      );
      await this.routeBook?.setConversationForMessage(saved.id, saved.conversationId);
      return saved;
    }
    const saved = await this.backends.local.appendMessage(message).catch(async () =>
      this.repoForConversation(message.conversationId).then((repo) => repo.appendMessage(message))
    );
    const cloudId = this.cloudConversationId(conv, message.conversationId);
    const cloudMessage = { ...message, conversationId: cloudId };
    try {
      if (conv) {
        await this.backends.cloud
          .createConversation({
            id: cloudId,
            participantIds: conv.participantIds.map(canonicalChatActorId),
            participants: conv.participants.map((item) => ({
              ...item,
              userId: canonicalChatActorId(item.userId),
            })),
            aiEnabled: conv.aiEnabled,
            title: conv.title,
          })
          .catch(() => undefined);
      }
      await this.backends.cloud.appendMessage(cloudMessage);
      await this.policy.rememberConversation(cloudId, 'cloud');
    } catch {
      // Local copy is enough until the next successful sync.
    }
    await this.routeBook?.setConversationForMessage(saved.id, saved.conversationId);
    return saved;
  }

  async saveTranslations(messageId: string, translations: LineTranslation[]): Promise<void> {
    const conversationId = await this.findConversationIdForMessage(messageId);
    if (!conversationId) return;
    if (!this.shareHumanDms()) {
      await (await this.repoForConversation(conversationId)).saveTranslations(messageId, translations);
      return;
    }
    await this.backends.local.saveTranslations(messageId, translations).catch(() => undefined);
    await this.backends.cloud.saveTranslations(messageId, translations).catch(() => undefined);
  }

  async listTranslations(messageId: string): Promise<LineTranslation[]> {
    const conversationId = await this.findConversationIdForMessage(messageId);
    if (!conversationId) return [];
    if (!this.shareHumanDms()) {
      return (await this.repoForConversation(conversationId)).listTranslations(messageId);
    }
    const local = await this.backends.local.listTranslations(messageId).catch(() => []);
    const cloud = await this.backends.cloud.listTranslations(messageId).catch(() => []);
    const seen = new Map(local.map((row) => [`${row.lineIndex}:${row.targetLang}:${row.mode}`, row]));
    for (const row of cloud) seen.set(`${row.lineIndex}:${row.targetLang}:${row.mode}`, row);
    return [...seen.values()];
  }

  async updateReceipt(messageId: string, receipt: ReceiptStatus): Promise<void> {
    const conversationId = await this.findConversationIdForMessage(messageId);
    if (!conversationId) return;
    if (!this.shareHumanDms()) {
      await (await this.repoForConversation(conversationId)).updateReceipt(messageId, receipt);
      return;
    }
    await this.backends.local.updateReceipt(messageId, receipt).catch(() => undefined);
    await this.backends.cloud.updateReceipt(messageId, receipt).catch(() => undefined);
  }

  /** Push a non-bot DM (and its local history) onto savigna_*. Bot stays local. */
  async ensureHumanDmCloud(conversationId: string): Promise<string | null> {
    if (!this.shareHumanDms()) return null;
    const conv = await this.getConversation(conversationId);
    if (!conv || isLearningBotConversation(conv) || !isHumanDirectChat(conv.participantIds)) {
      return null;
    }
    const cloudId = this.cloudConversationId(conv, conversationId);
    const participantIds = conv.participantIds.map(canonicalChatActorId);
    const participants = conv.participants.map((item) => ({
      ...item,
      userId: canonicalChatActorId(item.userId),
    }));
    await this.backends.cloud
      .createConversation({
        id: cloudId,
        participantIds,
        participants,
        aiEnabled: conv.aiEnabled,
        title: conv.title,
      })
      .catch(() => undefined);
    await this.backends.local
      .createConversation({
        id: cloudId,
        participantIds,
        participants,
        aiEnabled: conv.aiEnabled,
        title: conv.title,
      })
      .catch(() => undefined);
    const messages = mergeMessageTimelines(
      ...(await Promise.all(
        this.siblingConversationIds(conversationId).map((id) => this.safeListMessages('local', id))
      ))
    );
    for (const message of messages) {
      await this.backends.cloud
        .appendMessage({ ...message, conversationId: cloudId })
        .catch(() => undefined);
    }
    await this.policy.rememberConversation(conversationId, 'cloud');
    await this.policy.rememberConversation(cloudId, 'cloud');
    return cloudId;
  }

  async updateParticipants(
    conversationId: string,
    participants: Conversation['participants']
  ): Promise<void> {
    // Mirror participant language updates to both backends, so switching between local
    // and cloud never produces mismatched UI labels.
    const updates = [
      this.backends.local.updateParticipants(conversationId, participants),
      this.backends.cloud.updateParticipants(conversationId, participants),
    ];
    await Promise.allSettled(updates);
  }

  subscribe(conversationId: string, onChange: (messages: SourceMessage[]) => void): () => void {
    if (!this.shareHumanDms()) {
      let unsubscribe: (() => void) | undefined;
      let cancelled = false;
      void this.repoForConversation(conversationId).then((repo) => {
        if (cancelled) return;
        unsubscribe = repo.subscribe(conversationId, onChange);
      });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    }
    const emit = () => {
      void this.listMessages(conversationId).then(onChange).catch(() => undefined);
    };
    const unsubs = this.siblingConversationIds(conversationId).flatMap((id) => [
      this.safeSubscribe('local', id, emit),
      this.safeSubscribe('cloud', id, emit),
    ]);
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }

  private shareHumanDms(): boolean {
    return this.policy.dualWriteHumanDms?.() === true;
  }

  private shouldCloudSave(conversation: Conversation | null, conversationId: string): boolean {
    if (!this.shareHumanDms()) return false;
    if (conversation && isLearningBotConversation(conversation)) return false;
    if (conversation && isHumanDirectChat(conversation.participantIds)) return true;
    return conversationId.startsWith('dm:');
  }

  private cloudConversationId(conversation: Conversation | null, fallback: string): string {
    if (fallback.startsWith('dm:')) return fallback;
    if (!conversation) return fallback;
    const key = humanDirectPairKey(conversation.participantIds, canonicalChatActorId);
    if (!key) return fallback;
    const [left, right] = key.split(':');
    return directConversationId(left, right);
  }

  private siblingConversationIds(conversationId: string): string[] {
    const ids = new Set<string>([conversationId]);
    const pool = this.localMemory()?.conversations ?? [];
    const target = pool.find((item) => item.id === conversationId);
    const key = target
      ? humanDirectPairKey(target.participantIds, canonicalChatActorId)
      : conversationId.startsWith('dm:')
        ? conversationId.slice(3)
        : null;
    if (key) {
      for (const conversation of pool) {
        if (humanDirectPairKey(conversation.participantIds, canonicalChatActorId) === key) {
          ids.add(conversation.id);
        }
      }
      const [left, right] = key.split(':');
      if (left && right) ids.add(directConversationId(left, right));
    }
    return [...ids];
  }

  private async safeListMessages(
    backendId: ChatStorageBackendId,
    conversationId: string
  ): Promise<SourceMessage[]> {
    try {
      return await this.repo(backendId).listMessages(conversationId);
    } catch {
      return [];
    }
  }

  private safeSubscribe(
    backendId: ChatStorageBackendId,
    conversationId: string,
    onChange: (messages: SourceMessage[]) => void
  ): () => void {
    try {
      return this.repo(backendId).subscribe(conversationId, onChange);
    } catch {
      return () => undefined;
    }
  }

  private async applyHides(messages: SourceMessage[]): Promise<SourceMessage[]> {
    const userId = this.lastUserId;
    if (!userId) return messages;
    const hidden = new Set(await this.listHiddenMessageIds(userId));
    return messagesVisibleToViewer(messages, hidden);
  }

  private repo(backendId: ChatStorageBackendId): ChatRepository {
    return this.backends[backendId];
  }

  private async repoForConversation(conversationId: string): Promise<ChatRepository> {
    return this.repo(await this.policy.backendForConversation(conversationId));
  }

  private localMemory(): MemoryCompatibleChat | null {
    const local = this.backends.local as MemoryCompatibleChat;
    return Array.isArray(local?.conversations) ? local : null;
  }

  private async findConversationIdForMessage(messageId: string): Promise<string | null> {
    const remembered = await this.routeBook?.getConversationForMessage(messageId);
    if (remembered) return remembered;

    const local = this.localMemory();
    if (local) {
      for (const [conversationId, messages] of (local as MemoryCompatibleChat & {
        messages?: Map<string, SourceMessage[]>;
      }).messages ?? []) {
        if (messages.some((message) => message.id === messageId)) {
          await this.routeBook?.setConversationForMessage(messageId, conversationId);
          return conversationId;
        }
      }
    }

    for (const backendId of ['local', 'cloud'] as const) {
      const candidate = this.backends[backendId] as ChatRepository & {
        messages?: Map<string, SourceMessage[]>;
      };
      for (const [conversationId, messages] of candidate.messages ?? []) {
        if (messages.some((message) => message.id === messageId)) {
          await this.policy.rememberConversation(conversationId, backendId);
          await this.routeBook?.setConversationForMessage(messageId, conversationId);
          return conversationId;
        }
      }
    }

    return null;
  }
}

export async function ensureHumanDmCloudSaved(
  chat: ChatRepository,
  conversationId: string
): Promise<string | null> {
  const candidate = chat as ChatRepository & {
    ensureHumanDmCloud?: (id: string) => Promise<string | null>;
  };
  if (typeof candidate.ensureHumanDmCloud !== 'function') return null;
  return candidate.ensureHumanDmCloud(conversationId);
}
