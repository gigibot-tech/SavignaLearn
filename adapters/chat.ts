import { tokenizeText } from '@/domain/text';
import { toGigolingoLangKey } from '@/domain';
import { getVocabularyCardPrompt } from '@/gigolingo-shared/vocabularyPrompts';
import { inferVocabLanguageFromWord } from '@/gigolingo-shared/languages';
import { InMemoryChatRepository } from '@/adapters/memoryChat';
import { authStorage } from '@/adapters/authStorage';
import {
  InMemoryChatRouteBook,
  LocalFirstChatPolicy,
  PolicyChatRepository,
  type ChatStorageBackendId,
} from '@/adapters/chatCloud';
export { ensureHumanDmCloudSaved } from '@/adapters/chatCloud';
import { createChatContentCipher } from '@/adapters/chatCipher';
import {
  completeFourSomeWebSocket,
  defaultAiBackend as readDefaultAiBackend,
  foursomeHttpChatUrl,
  isAiBackendId,
  isFourSomeUserId,
  messagesToFourSomeQuery,
  resolveFourSomeUserId,
  onPremChatBaseUrl,
  type AiBackendId,
} from '@/adapters/aiBackend';
import { getIdoSupabase, isIdoAiConfigured } from '@/adapters/idoAi';
import { IdoCoreChatCompletionAdapter } from '@/adapters/idoAi';
import { SupabaseChatRepository } from '@/adapters/supabase';
import {
  completeWithWebGemma,
  getWebGemmaStatus,
  isWebGemmaEnabled,
} from '@/adapters/webGemma';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type {
  ChatCompleteOptions,
  ChatCompletionMessage,
  ChatCompletionPort,
  ChatRepository,
  MediaCatalogPort,
  TokenizerPort,
  WordTapPort,
} from '@/ports/ports';

export type { AiBackendId } from '@/adapters/aiBackend';
export {
  AI_BACKENDS,
  defaultAiBackend,
  isFourSomeUserId,
  labelForAiBackend,
  resolveFourSomeUserId,
} from '@/adapters/aiBackend';

/**
 * Chat repository + completion + learning stubs.
 * Inbox/thread default is local KV (`savigna.chat.v1.<userId>`).
 * Human DMs also sync to savigna_* when iDO Auth is configured so both people
 * share one conversation id. Bot stays local.
 */

export { InMemoryChatRepository } from '@/adapters/memoryChat';

export const memoryChat = new InMemoryChatRepository(authStorage);
const chatRouteBook = new InMemoryChatRouteBook();
const chatStoragePolicy = new LocalFirstChatPolicy(chatRouteBook, {
  inboxBackends: isIdoAiConfigured() ? ['local', 'cloud'] : ['local'],
  shareHumanDms: isIdoAiConfigured(),
});

class UnavailableChatRepository implements ChatRepository {
  constructor(private readonly backendId: ChatStorageBackendId) {}

  private fail(): never {
    throw new Error(`${this.backendId} chat backend is not configured`);
  }

  async listConversations(): Promise<never> {
    this.fail();
  }

  async getConversation(): Promise<never> {
    this.fail();
  }

  async createConversation(): Promise<never> {
    this.fail();
  }

  async listMessages(): Promise<never> {
    this.fail();
  }

  async appendMessage(): Promise<never> {
    this.fail();
  }

  async deleteMessage(): Promise<never> {
    this.fail();
  }

  async listHiddenMessageIds(): Promise<never> {
    this.fail();
  }

  async markConversationRead(): Promise<never> {
    this.fail();
  }

  async updateReceipt(): Promise<never> {
    this.fail();
  }

  async saveTranslations(): Promise<never> {
    this.fail();
  }

  async listTranslations(): Promise<never> {
    this.fail();
  }

  async updateParticipants(): Promise<never> {
    this.fail();
  }

  subscribe(): () => void {
    this.fail();
  }
}

function cloudChatRepository(): ChatRepository {
  if (!isIdoAiConfigured()) return new UnavailableChatRepository('cloud');
  let inner: ChatRepository | null = null;
  const get = (): ChatRepository => {
    inner ??= new SupabaseChatRepository(getIdoSupabase(), createChatContentCipher());
    return inner;
  };
  return new Proxy({} as ChatRepository, {
    get(_target, prop) {
      const repo = get();
      const value = Reflect.get(repo as object, prop);
      return typeof value === 'function' ? value.bind(repo) : value;
    },
  });
}

const cloudChat = cloudChatRepository();
const routedChat = new PolicyChatRepository(
  { local: memoryChat, cloud: cloudChat },
  chatStoragePolicy,
  chatRouteBook
);

function openAiJsonFormat(json?: boolean): { response_format?: { type: 'json_object' } } {
  return json ? { response_format: { type: 'json_object' } } : {};
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export class ScriptedChatCompletionAdapter implements ChatCompletionPort {
  readonly provider = 'demo' as const;

  isAvailable(): boolean {
    return true;
  }

  async complete(
    messages: ChatCompletionMessage[],
    options?: ChatCompleteOptions
  ): Promise<string> {
    const last = [...messages].reverse().find((item) => item.role === 'user');
    const text = last?.content ?? '';
    const snippet = text.slice(0, 80);
    if (options?.json) {
      const joined = messages.map((item) => item.content).join('\n');
      const learning = joined.match(/learning_lang:\s*(\w+)/i)?.[1]?.toLowerCase() ?? 'de';
      const native = joined.match(/native_lang:\s*(\w+)/i)?.[1]?.toLowerCase() ?? 'en';
      const learningText =
        learning === 'de'
          ? `Lass uns üben — du schriebst „${snippet}“.`
          : `Let's practice — you wrote “${snippet}”.`;
      const nativeText =
        native === 'de'
          ? `Lass uns üben — du schriebst „${snippet}“.`
          : `Let's practice — you wrote “${snippet}”.`;
      return JSON.stringify({
        learning_text: learningText,
        native_text: nativeText,
        detected_source_lang: learning,
      });
    }
    return `Let's practice — you wrote “${text.slice(0, 120)}”. Try one more sentence in your learning language.`;
  }
}

/** Cascade like fourSome gigi_engine: try each step, then demo. */
export class ResilientChatCompletionAdapter implements ChatCompletionPort {
  lastUsed: AiBackendId = 'demo';
  lastError?: string;
  private coolDownUntil: Partial<Record<AiBackendId, number>> = {};

  constructor(
    private readonly steps: Array<{ id: AiBackendId; port: ChatCompletionPort }>,
    private readonly fallback = new ScriptedChatCompletionAdapter(),
    private readonly coolDownMs = 60_000
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async complete(
    messages: ChatCompletionMessage[],
    options?: ChatCompleteOptions
  ): Promise<string> {
    const now = Date.now();
    for (const step of this.steps) {
      if (!step.port.isAvailable()) continue;
      if ((this.coolDownUntil[step.id] ?? 0) > now) continue;
      try {
        const text = await withTimeout(
          step.port.complete(messages, options),
          20_000,
          `${step.id} timed out`
        );
        this.lastUsed = step.id;
        this.lastError = undefined;
        return text;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : `${step.id} failed`;
        this.coolDownUntil[step.id] = now + this.coolDownMs;
      }
    }
    if (!this.lastError && this.steps.length > 0) {
      this.lastError = this.steps.map((s) => s.id).includes('onprem')
        ? 'On-prem URL not set and OpenAI unavailable'
        : 'Selected AI backend unavailable';
    }
    this.lastUsed = 'demo';
    return this.fallback.complete(messages, options);
  }
}

export class HttpChatCompletionAdapter implements ChatCompletionPort {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string
  ) {}

  isAvailable(): boolean {
    return Boolean(this.endpoint);
  }

  async complete(
    messages: ChatCompletionMessage[],
    options?: ChatCompleteOptions
  ): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ messages, json: options?.json === true }),
    });
    if (!response.ok) throw new Error('Chat completion failed');
    const data = (await response.json()) as { response?: string; content?: string };
    return data.response ?? data.content ?? '';
  }
}

/**
 * fourSome Northflank GiGi chat — one real user talking to the AI.
 * Two-person SavignaLearn threads do not use this socket (ChatRepository instead).
 * Live deploy has no HTTP `/chat/`; WebSocket `/ws` is the GiGi path.
 */
export class FourSomeChatCompletionAdapter implements ChatCompletionPort {
  constructor(
    private readonly userId: string | null,
    private readonly baseUrl = foursomeHttpChatUrl()
  ) {}

  isAvailable(): boolean {
    return isFourSomeUserId(this.userId);
  }

  async complete(messages: ChatCompletionMessage[]): Promise<string> {
    const userId = this.userId;
    if (!isFourSomeUserId(userId)) {
      throw new Error('Set your fourSome user id (UUID) in Settings — GiGi will not invent a user');
    }
    const userQuery = messagesToFourSomeQuery(messages);
    if (Platform.OS === 'web') {
      const response = await fetch('/api/foursome/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, user_id: userId }),
      });
      return this.readContent(response);
    }
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ user_id: userId, user_query: userQuery }),
      });
      if (response.ok) return this.readContent(response);
    } catch {
      // HTTP `/chat/` is not on the current Northflank deploy — fall through to WS.
    }
    return completeFourSomeWebSocket({ message: userQuery, userId });
  }

  private async readContent(response: Response): Promise<string> {
    if (!response.ok) {
      throw new Error(`fourSome chat failed: ${response.status}`);
    }
    const data = (await response.json()) as {
      response?: string;
      message?: string;
      content?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content =
      data.response ?? data.message ?? data.content ?? data.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('fourSome response missing content');
    return content;
  }
}

/**
 * OpenAI chat completions (same env as fourSome: EXPO_PUBLIC_OPENAI_API_KEY).
 * On web, calls same-origin `/api/openai/chat` proxy — browsers cannot hit api.openai.com (CORS).
 * On native, calls OpenAI directly.
 */
export class OpenAIChatCompletionAdapter implements ChatCompletionPort {
  constructor(
    private readonly apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '',
    private readonly model = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-4o-mini',
    private readonly baseUrl = process.env.EXPO_PUBLIC_OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  ) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(messages: ChatCompletionMessage[], options?: ChatCompleteOptions): Promise<string> {
    if (Platform.OS === 'web') {
      return this.completeViaWebProxy(messages, options);
    }
    if (!this.apiKey) throw new Error('OpenAI API key not configured');
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 1000,
        ...openAiJsonFormat(options?.json),
      }),
    });
    return this.readOpenAiContent(response);
  }

  private async completeViaWebProxy(
    messages: ChatCompletionMessage[],
    options?: ChatCompleteOptions
  ): Promise<string> {
    const response = await fetch('/api/openai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model: this.model,
        temperature: 0.7,
        max_tokens: 1000,
        json: options?.json === true,
      }),
    });
    return this.readOpenAiContent(response);
  }

  private async readOpenAiContent(response: Response): Promise<string> {
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string | { message?: string };
      };
      const message =
        typeof errorData.error === 'string'
          ? errorData.error
          : errorData.error?.message ?? response.statusText;
      throw new Error(`OpenAI API error: ${response.status} ${message}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: string;
    };
    const content = data.choices?.[0]?.message?.content ?? data.content;
    if (!content) throw new Error('OpenAI response missing content');
    return content;
  }
}

/**
 * On-prem OpenAI-compatible chat (vLLM / Ollama / fourSome local engine).
 * Browser uses `/api/onprem/chat` so the Expo server talks to localhost.
 */
export class OnPremChatCompletionAdapter implements ChatCompletionPort {
  constructor(
    private readonly baseUrl = onPremChatBaseUrl(),
    private readonly model = process.env.EXPO_PUBLIC_ONPREM_MODEL || 'gpt-4o-mini',
    private readonly apiKey = process.env.EXPO_PUBLIC_ONPREM_API_KEY ||
      process.env.EXPO_PUBLIC_CHAT_COMPLETION_KEY ||
      ''
  ) {}

  isAvailable(): boolean {
    return Boolean(this.baseUrl) || getWebGemmaStatus().state === 'ready';
  }

  async complete(
    messages: ChatCompletionMessage[],
    options?: ChatCompleteOptions
  ): Promise<string> {
    if (this.baseUrl) {
      try {
        return await this.completeHttp(messages, options);
      } catch (error) {
        if (!isWebGemmaEnabled() || getWebGemmaStatus().state !== 'ready') throw error;
      }
    }
    if (isWebGemmaEnabled()) {
      if (getWebGemmaStatus().state !== 'ready') {
        throw new Error('Web Gemma not ready');
      }
      return completeWithWebGemma(messages);
    }
    throw new Error('On-prem chat URL not configured');
  }

  private async completeHttp(
    messages: ChatCompletionMessage[],
    options?: ChatCompleteOptions
  ): Promise<string> {
    if (Platform.OS === 'web') {
      const response = await fetch('/api/onprem/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, model: this.model, json: options?.json === true }),
      });
      return this.readContent(response);
    }
    if (!this.baseUrl) throw new Error('On-prem chat URL not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      });
      return this.readContent(response);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readContent(response: Response): Promise<string> {
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string | { message?: string };
      };
      const message =
        typeof errorData.error === 'string'
          ? errorData.error
          : errorData.error?.message ?? response.statusText;
      throw new Error(`On-prem API error: ${response.status} ${message}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: string;
      response?: string;
    };
    const content = data.choices?.[0]?.message?.content ?? data.content ?? data.response;
    if (!content) throw new Error('On-prem response missing content');
    return content;
  }
}

/** Vocabulary card prompts — Gigolingo `getVocabularyCardPrompt` (copied into gigolingo-shared). */
export function vocabularyCardPrompt(word: string, sentence: string, language = 'de') {
  const resolved = inferVocabLanguageFromWord(word, language);
  return getVocabularyCardPrompt(word, sentence, toGigolingoLangKey(resolved), 'EN');
}

const AI_BACKEND_STORAGE_KEY = 'savigna.aiBackend.v2';
const FOURSOME_USER_STORAGE_KEY = 'savigna.foursomeUserId';

export async function loadAiBackend(): Promise<AiBackendId> {
  try {
    const stored = await AsyncStorage.getItem(AI_BACKEND_STORAGE_KEY);
    if (isAiBackendId(stored)) return stored;
  } catch {
    // ignore
  }
  return readDefaultAiBackend();
}

export async function saveAiBackend(id: AiBackendId): Promise<void> {
  await AsyncStorage.setItem(AI_BACKEND_STORAGE_KEY, id);
}

export function envFourSomeUserId(): string | null {
  return resolveFourSomeUserId(process.env.EXPO_PUBLIC_FOURSOME_USER_ID);
}

export async function loadFourSomeUserId(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(FOURSOME_USER_STORAGE_KEY);
    return resolveFourSomeUserId(stored, envFourSomeUserId());
  } catch {
    return envFourSomeUserId();
  }
}

export async function saveFourSomeUserId(id: string): Promise<void> {
  const uuid = resolveFourSomeUserId(id);
  if (!uuid) throw new Error('fourSome user id must be a UUID');
  await AsyncStorage.setItem(FOURSOME_USER_STORAGE_KEY, uuid);
}

export function createChatCompletion(
  backend: AiBackendId = readDefaultAiBackend(),
  options?: { fourSomeUserId?: string | null }
): ChatCompletionPort {
  if (backend === 'demo') {
    return new ScriptedChatCompletionAdapter();
  }
  if (backend === 'openai') {
    return new ResilientChatCompletionAdapter([{ id: 'openai', port: new OpenAIChatCompletionAdapter() }]);
  }
  if (backend === 'onprem') {
    return new ResilientChatCompletionAdapter([{ id: 'onprem', port: new OnPremChatCompletionAdapter() }]);
  }
  if (backend === 'ido') {
    return new ResilientChatCompletionAdapter([{ id: 'ido', port: new IdoCoreChatCompletionAdapter() }]);
  }
  // fourSome gigi_engine: on-prem vLLM → OpenAI → optional GiGi socket → demo
  const fourSomeUserId = resolveFourSomeUserId(options?.fourSomeUserId, envFourSomeUserId());
  const steps: Array<{ id: AiBackendId; port: ChatCompletionPort }> = [
    { id: 'onprem', port: new OnPremChatCompletionAdapter() },
    { id: 'openai', port: new OpenAIChatCompletionAdapter() },
  ];
  if (fourSomeUserId) {
    steps.push({ id: 'foursome', port: new FourSomeChatCompletionAdapter(fourSomeUserId) });
  }
  return new ResilientChatCompletionAdapter(steps);
}

export function createChatRepository(seed?: { viewerId: string; partnerId: string }): ChatRepository {
  if (seed) routedChat.seedDemo(seed.viewerId, seed.partnerId);
  return routedChat;
}

export { ensureLearningBotChat, listInboxConversations } from '@/adapters/learningBot';

/** LONG-TERM: Gigolingo tokenizer / ShieldLine tokenization. */
export const defaultTokenizer: TokenizerPort = {
  tokenize: tokenizeText,
};

/**
 * LONG-TERM: Swap for GigolingoVocabularyTapAdapter
 * (pending_orange → VocabularyCardPort → LearningItemRepository → confirmed_green).
 */
export const noOpWordTap: WordTapPort = {
  async onPress() {
    return;
  },
};

export {
  ChatCompletionVocabularyCardAdapter,
  FakeVocabularyCardAdapter,
  InMemoryLearningItemRepository,
  createVocabularyCardPort,
  memoryLearningItems,
  openOrCreateVocabularyCard,
} from '@/adapters/vocabulary';

/** LONG-TERM: Gigolingo media catalog. Empty by design in MVP. */
export const emptyMediaCatalog: MediaCatalogPort = {
  async getMedia() {
    return null;
  },
  async listMedia() {
    return [];
  },
};
