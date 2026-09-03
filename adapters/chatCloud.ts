import type { Conversation, LineTranslation, ReceiptStatus, SourceMessage } from '@/domain/chat';
import type { ChatRepository } from '@/ports/ports';

export type ChatStorageBackendId = 'local' | 'cloud';

type MemoryCompatibleChat = ChatRepository & {
  conversations: Conversation[];
  seedDemo?: (viewerId: string, partnerId: string) => void;
  hydrateForUser?: (userId: string) => Promise<void>;
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
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<ChatStorageBackendId>;
  rememberConversation(conversationId: string, backend: ChatStorageBackendId): Promise<void>;
}

export class LocalFirstChatPolicy implements ChatStoragePolicy {
  constructor(
    private readonly routeBook: ChatRouteBook,
    private readonly options: {
      defaultBackend?: ChatStorageBackendId;
      inboxBackends?: ChatStorageBackendId[];
    } = {}
  ) {}

  async inboxBackends(): Promise<ChatStorageBackendId[]> {
    return this.options.inboxBackends ?? ['local'];
  }

  async backendForConversation(conversationId: string): Promise<ChatStorageBackendId> {
    return (await this.routeBook.get(conversationId)) ?? (this.options.defaultBackend ?? 'local');
  }

  async backendForNewConversation(): Promise<ChatStorageBackendId> {
    return this.options.defaultBackend ?? 'local';
  }

  async rememberConversation(
    conversationId: string,
    backend: ChatStorageBackendId
  ): Promise<void> {
    await this.routeBook.set(conversationId, backend);
  }
}

/** One repository interface, explicit backends, policy-driven routing. */
export class PolicyChatRepository implements ChatRepository {
  constructor(
    private readonly backends: Record<ChatStorageBackendId, ChatRepository>,
    private readonly policy: ChatStoragePolicy,
    private readonly routeBook?: ChatRouteBook
  ) {}

  get conversations(): Conversation[] {
    return this.localMemory()?.conversations ?? [];
  }

  async hydrateForUser(userId: string): Promise<void> {
    await this.localMemory()?.hydrateForUser?.(userId);
  }

  async persistUser(userId: string): Promise<void> {
    await this.localMemory()?.persistUser?.(userId);
  }

  seedDemo(viewerId: string, partnerId: string): void {
    this.localMemory()?.seedDemo?.(viewerId, partnerId);
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    const seen = new Map<string, Conversation>();
    for (const backendId of await this.policy.inboxBackends(userId)) {
      const list = await this.repo(backendId).listConversations(userId);
      for (const conversation of list) {
        seen.set(conversation.id, conversation);
        await this.policy.rememberConversation(conversation.id, backendId);
      }
    }
    return [...seen.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const backendId = await this.policy.backendForConversation(id);
    const repo = this.repo(backendId);
    const conv = await repo.getConversation(id);

    // When the conversation is loaded from cloud, ensure its participants language settings
    // match the local snapshot (so UI labels like “They read …” stay correct after
    // switching between local and cloud).
    if (!conv || backendId !== 'cloud') return conv;

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
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<Conversation> {
    const backendId = await this.policy.backendForNewConversation(input);
    const conversation = await this.repo(backendId).createConversation(input);
    await this.policy.rememberConversation(conversation.id, backendId);
    return conversation;
  }

  async listMessages(conversationId: string): Promise<SourceMessage[]> {
    const messages = await this.repoForConversation(conversationId).then((repo) =>
      repo.listMessages(conversationId)
    );
    for (const message of messages) {
      await this.routeBook?.setConversationForMessage(message.id, conversationId);
    }
    return messages;
  }

  async appendMessage(message: SourceMessage): Promise<SourceMessage> {
    const saved = await this.repoForConversation(message.conversationId).then((repo) =>
      repo.appendMessage(message)
    );
    await this.routeBook?.setConversationForMessage(saved.id, saved.conversationId);
    return saved;
  }

  async updateReceipt(messageId: string, receipt: ReceiptStatus): Promise<void> {
    const conversationId = await this.findConversationIdForMessage(messageId);
    if (!conversationId) return;
    await (await this.repoForConversation(conversationId)).updateReceipt(messageId, receipt);
  }

  async saveTranslations(messageId: string, translations: LineTranslation[]): Promise<void> {
    const conversationId = await this.findConversationIdForMessage(messageId);
    if (!conversationId) return;
    await (await this.repoForConversation(conversationId)).saveTranslations(messageId, translations);
  }

  async listTranslations(messageId: string): Promise<LineTranslation[]> {
    const conversationId = await this.findConversationIdForMessage(messageId);
    if (!conversationId) return [];
    return (await this.repoForConversation(conversationId)).listTranslations(messageId);
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
