/**
 * Application ports (ISP at the type level; one module to avoid micro-files).
 * LONG-TERM: Gigolingo media/vocab/tap/card gen attach via these ports without editing chat UI.
 */

import type {
  Conversation,
  DisplayMode,
  LanguageCode,
  LineTranslation,
  ReceiptStatus,
  SourceMessage,
} from '@/domain/chat';
import type { MessageDeleteScope } from '@/domain/messageDelete';
import type { LearningItem, LearningSource, MediaCompatibleBlock } from '@/domain/learning';
import type { AsymmetricLanguageContext, ChatHistoryStore } from '@/domain/pipeline';
import type { FriendRow, Friendship, PublicProfile } from '@/domain/friends';
import type { ProfileCard } from '@/domain/profileCard';

export interface ChatRepository {
  listConversations(userId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(input: {
    id?: string;
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<Conversation>;
  listMessages(conversationId: string): Promise<SourceMessage[]>;
  appendMessage(message: SourceMessage): Promise<SourceMessage>;
  deleteMessage(input: {
    messageId: string;
    conversationId: string;
    actorId: string;
    scope: MessageDeleteScope;
    viewerIds?: string[];
  }): Promise<SourceMessage | null>;
  listHiddenMessageIds(userId: string): Promise<string[]>;
  updateReceipt(messageId: string, receipt: ReceiptStatus): Promise<void>;
  saveTranslations(messageId: string, translations: LineTranslation[]): Promise<void>;
  listTranslations(messageId: string): Promise<LineTranslation[]>;
  updateParticipants(
    conversationId: string,
    participants: Conversation['participants']
  ): Promise<void>;
  subscribe(
    conversationId: string,
    onChange: (messages: SourceMessage[]) => void
  ): () => void;
  markConversationRead(conversationId: string, userIds: string[]): Promise<void>;
}

export interface TranslationEngine {
  detectLanguage(text: string): Promise<LanguageCode>;
  translateLine(input: {
    text: string;
    sourceLang: LanguageCode;
    targetLang: LanguageCode;
    mode: DisplayMode;
    /** Both users' learning languages for asymmetric prompt payloads. */
    asymmetric?: AsymmetricLanguageContext;
  }): Promise<string>;
  isAvailable(): boolean;
}

/** Re-export for DI — in-memory first, Supabase later. */
export type { ChatHistoryStore };

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ChatCompleteOptions = {
  /** Ask the model for a JSON object (OpenAI json_object / iDO json features). */
  json?: boolean;
  /** iDO `ai-assist` feature name (`savigna-chat`, `savigna-translate`, …). */
  feature?: string;
};

export interface ChatCompletionChunk {
  text: string;
  done: boolean;
}

/** ISP: chat replies only. Vocabulary cards use VocabularyCardPort. */
export interface ChatCompletionPort {
  complete(messages: ChatCompletionMessage[], options?: ChatCompleteOptions): Promise<string>;
  stream?(
    messages: ChatCompletionMessage[],
    onChunk: (chunk: ChatCompletionChunk) => void,
    signal?: AbortSignal
  ): Promise<void>;
  isAvailable(): boolean;
}

export interface ChatContentCipher {
  readonly version: number;
  readonly alg: string;
  seal(plaintext: string): Promise<{ ciphertext: string; encVersion: number; encAlg: string }>;
  open(input: {
    ciphertext: string;
    encVersion?: number | null;
    encAlg?: string | null;
  }): Promise<string>;
}

export interface AuthUser {
  id: string;
  email?: string;
  displayName?: string;
  /** fourSome Supabase auth id — required for GiGi WebSocket. */
  fourSomeUserId?: string | null;
  /** ido-core Supabase auth id — required for `ai-assist`. */
  idoUserId?: string | null;
}

export interface AuthPort {
  getSession(): Promise<AuthUser | null>;
  signInWithPassword(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string, displayName?: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void;
}

export interface TokenizerPort {
  tokenize(text: string, language?: string): string[];
}

export interface WordTapRequest {
  token: string;
  sentence: string;
  language: LanguageCode;
  source: LearningSource;
}

/**
 * LONG-TERM: Gigolingo tap cycle pending_orange → generateVocabularyCard → save → confirmed_green.
 * Do not inline card generation in bubbles.
 */
export interface WordTapPort {
  onPress(request: WordTapRequest): Promise<void>;
}

/** Matches Gigolingo AIService.generateVocabularyCard. */
export interface VocabularyCardPort {
  generateVocabularyCard(
    word: string,
    sentence: string,
    language?: LanguageCode
  ): Promise<LearningItem | null>;
  isAvailable(): boolean;
}

export interface LearningItemRepository {
  save(item: LearningItem): Promise<LearningItem>;
  findById(id: string): Promise<LearningItem | null>;
  findByWord(userId: string, word: string): Promise<LearningItem | null>;
  findByIdentity(
    userId: string,
    word: string,
    language: LanguageCode | undefined,
    source: LearningSource
  ): Promise<LearningItem | null>;
  listBySource(source: LearningSource): Promise<LearningItem[]>;
  listForUser(userId: string): Promise<LearningItem[]>;
  /** Optional: repositories that can notify (the in-memory one does) let the UI refresh itself. */
  subscribe?(listener: () => void): () => void;
}

/** LONG-TERM: Gigolingo media library. Unused in MVP on purpose. */
export interface MediaCatalogPort {
  getMedia(
    mediaId: string
  ): Promise<{ id: string; name: string; blocks: MediaCompatibleBlock[] } | null>;
  listMedia(): Promise<Array<{ id: string; name: string }>>;
}

/** SavignaLearn identity store and/or iDO profiles — friends resolve against both. */
export interface UserDirectoryPort {
  findByEmail(email: string): Promise<PublicProfile | null>;
  findById(id: string): Promise<PublicProfile | null>;
  findByUsername(username: string): Promise<PublicProfile | null>;
  listByUsername(username: string): Promise<PublicProfile[]>;
}

/** Photo, about, last-seen. Distinct from friend-directory PublicProfile. */
export interface ProfileRepository {
  get(userId: string): Promise<ProfileCard | null>;
  list(userIds: string[]): Promise<ProfileCard[]>;
  upsertOwn(
    userId: string,
    patch: { photoUrl?: string | null; bio?: string; presenceOptIn?: boolean }
  ): Promise<ProfileCard>;
  heartbeat(userId: string): Promise<void>;
}

export interface FriendsRepository {
  registerProfile(profile: PublicProfile): Promise<void>;
  findByUsername(username: string): Promise<PublicProfile | null>;
  listFor(viewerId: string): Promise<Friendship[]>;
  listProfiles(ids: string[]): Promise<PublicProfile[]>;
  /** Re-check each friend against SavignaLearn + iDO. Marks inconsistent rows; never invents ghosts. */
  reconcile(viewerId: string): Promise<FriendRow[]>;
  /** Identifier: email, user id, `/friends?add=` link, or demo username. */
  request(viewerId: string, identifier: string): Promise<Friendship>;
  accept(viewerId: string, friendshipId: string): Promise<void>;
  decline(viewerId: string, friendshipId: string): Promise<void>;
  remove(viewerId: string, friendshipId: string): Promise<void>;
}

/** LONG-TERM: Gigolingo IVocabularyDisplay. */
export interface VocabularyDisplayPort {
  isClicked(word: string): boolean;
  isLearned(word: string): boolean;
  markClicked(word: string): Promise<void>;
  markLearned(word: string): Promise<void>;
}
