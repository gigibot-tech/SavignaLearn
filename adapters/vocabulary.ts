/**
 * Vocabulary card adapters: Gigolingo prompt + parse, idempotent open/create.
 * Domain matching stays in `learningItemIdentityKey` / `findMatchingLearningItem`.
 */

import {
  createLearningItem,
  findMatchingLearningItem,
  learningItemIdentityKey,
  learningSourceKey,
  type LearningItem,
  type LearningSource,
} from '@/domain/learning';
import { extractJsonObject, normalizeLanguageCode, toGigolingoLangKey, type LanguageCode } from '@/domain';
import { getVocabularyCardPrompt } from '@/gigolingo-shared/vocabularyPrompts';
import {
  inferVocabLanguageFromWord,
  needsReadingAttribute,
  sentenceMatchesReadingLanguage,
} from '@/gigolingo-shared/languages';
import type {
  ChatCompletionPort,
  LearningItemRepository,
  VocabularyCardPort,
  WordTapPort,
} from '@/ports/ports';

export type OpenVocabularyCardInput = {
  userId: string;
  word: string;
  sentence: string;
  language: LanguageCode;
  source: LearningSource;
};

export type OpenVocabularyCardResult = {
  item: LearningItem;
  created: boolean;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveVocabCardLanguage(word: string, language?: string): LanguageCode {
  return normalizeLanguageCode(inferVocabLanguageFromWord(word, language));
}

function applyReadingLikeGigolingo<T extends { word: string; reading?: string; sentenceReading?: string }>(
  item: T,
  language: LanguageCode | undefined,
  sentence: string
): T {
  const gigolingoLang = language ? toGigolingoLangKey(language) : 'EN';
  if (!needsReadingAttribute(gigolingoLang)) {
    return { ...item, reading: '', sentenceReading: undefined };
  }
  const reading = item.reading?.trim() ? item.reading.trim() : item.word;
  const sentenceReading =
    sentenceMatchesReadingLanguage(sentence, gigolingoLang) && item.sentenceReading?.trim()
      ? item.sentenceReading.trim()
      : undefined;
  return { ...item, reading, sentenceReading };
}

function vocabularyCardPromptFor(word: string, sentence: string, language: LanguageCode) {
  const gigolingoLang = toGigolingoLangKey(language);
  const prompt = getVocabularyCardPrompt(word, sentence, gigolingoLang, 'EN');
  if (gigolingoLang === 'JA' && !sentenceMatchesReadingLanguage(sentence, gigolingoLang)) {
    return {
      ...prompt,
      userPrompt: `${prompt.userPrompt}

NOTE: The sentence context may not be Japanese. Still provide hiragana/katakana reading for the word. Leave sentenceReading empty if the sentence is not Japanese.`,
    };
  }
  return prompt;
}

/**
 * Gigolingo OpenAIService.parseVocabularyCardResponse, using SavignaLearn `extractJsonObject`.
 */
export function parseGeneratedVocabularyCard(
  raw: string,
  fallback: { word: string; sentence: string; language?: LanguageCode }
): Omit<LearningItem, 'source'> & { source?: LearningSource } | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;
  const word = asString(parsed.word) ?? fallback.word;
  const translation = asString(parsed.translation);
  if (!word || !translation) return null;

  const language = resolveVocabCardLanguage(word, fallback.language);
  const sentenceOrig = asString(parsed.sentenceOrig) ?? fallback.sentence;
  const item = createLearningItem({
    word,
    translation,
    sentenceOrig,
    sentenceEng: asString(parsed.sentenceEng) ?? fallback.sentence,
    sentenceReading: asString(parsed.sentenceReading),
    reading: asString(parsed.reading) ?? '',
    languageLevel: asString(parsed.languageLevel),
    frequency: asString(parsed.frequency),
    jlpt: asString(parsed.jlpt),
    language,
    source: { kind: 'manual' },
  });
  return applyReadingLikeGigolingo(item, language, sentenceOrig);
}

export class FakeVocabularyCardAdapter implements VocabularyCardPort {
  isAvailable(): boolean {
    return true;
  }

  async generateVocabularyCard(
    word: string,
    sentence: string,
    language?: string
  ): Promise<LearningItem | null> {
    const resolved = resolveVocabCardLanguage(word, language);
    const needsReading = needsReadingAttribute(toGigolingoLangKey(resolved));
    return createLearningItem({
      word,
      translation: word,
      sentenceOrig: sentence,
      sentenceEng: sentence,
      language: resolved,
      languageLevel: 'A2',
      frequency: 'medium',
      reading: needsReading ? word : '',
      source: { kind: 'manual' },
    });
  }
}

export class ChatCompletionVocabularyCardAdapter implements VocabularyCardPort {
  constructor(
    private readonly completion: ChatCompletionPort,
    private readonly fallback = new FakeVocabularyCardAdapter()
  ) {}

  isAvailable(): boolean {
    return this.completion.isAvailable() || this.fallback.isAvailable();
  }

  async generateVocabularyCard(
    word: string,
    sentence: string,
    language?: LanguageCode
  ): Promise<LearningItem | null> {
    const resolved = resolveVocabCardLanguage(word, language);
    const prompt = vocabularyCardPromptFor(word, sentence, resolved);
    try {
      const raw = await this.completion.complete(
        [
          { role: 'system', content: prompt.systemPrompt ?? '' },
          { role: 'user', content: prompt.userPrompt },
        ],
        { json: true, feature: 'savigna-vocab' }
      );
      const parsed = parseGeneratedVocabularyCard(raw, { word, sentence, language: resolved });
      if (parsed) {
        return createLearningItem({
          ...parsed,
          word,
          language: resolved,
          source: parsed.source ?? { kind: 'manual' },
        });
      }
    } catch {
      // fall through to fake card so tap never fails the thread
    }
    return this.fallback.generateVocabularyCard(word, sentence, resolved);
  }
}

export function createVocabularyCardPort(completion: ChatCompletionPort): VocabularyCardPort {
  return new ChatCompletionVocabularyCardAdapter(completion);
}

export function sortTippedVocabularyCards(items: LearningItem[]): LearningItem[] {
  return [...items].sort((a, b) => {
    const ta = a.dateAdded instanceof Date ? a.dateAdded.getTime() : 0;
    const tb = b.dateAdded instanceof Date ? b.dateAdded.getTime() : 0;
    if (tb !== ta) return tb - ta;
    return a.word.localeCompare(b.word);
  });
}

export async function listTippedVocabularyCards(
  items: LearningItemRepository,
  userId: string
): Promise<LearningItem[]> {
  return sortTippedVocabularyCards(await items.listForUser(userId));
}

export class InMemoryLearningItemRepository implements LearningItemRepository {
  private items: LearningItem[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(seed: LearningItem[] = []) {
    this.items = seed.map((item) => ({ ...item }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private copy(item: LearningItem): LearningItem {
    return { ...item };
  }

  async save(item: LearningItem): Promise<LearningItem> {
    const identity = learningItemIdentityKey(item.word, item.language, item.source);
    const existing = this.items.find(
      (row) =>
        row.userId === item.userId &&
        learningItemIdentityKey(row.word, row.language, row.source) === identity
    );
    if (existing) return this.copy(existing);
    const stored: LearningItem = {
      ...item,
      id: item.id ?? `vocab:${identity}`,
    };
    this.items.push(stored);
    this.notify();
    return this.copy(stored);
  }

  async findById(id: string): Promise<LearningItem | null> {
    const found = this.items.find((item) => item.id === id);
    return found ? this.copy(found) : null;
  }

  async findByWord(userId: string, word: string): Promise<LearningItem | null> {
    const found = this.items.find(
      (item) => item.userId === userId && item.word.toLowerCase() === word.toLowerCase()
    );
    return found ? this.copy(found) : null;
  }

  async findByIdentity(
    userId: string,
    word: string,
    language: LanguageCode | undefined,
    source: LearningSource
  ): Promise<LearningItem | null> {
    const match = findMatchingLearningItem(
      this.items.filter((item) => item.userId === userId),
      { word, language, source }
    );
    return match ? this.copy(match) : null;
  }

  async listBySource(source: LearningSource): Promise<LearningItem[]> {
    const key = learningSourceKey(source);
    return this.items.filter((item) => learningSourceKey(item.source) === key).map((item) => this.copy(item));
  }

  async listForUser(userId: string): Promise<LearningItem[]> {
    return this.items.filter((item) => item.userId === userId).map((item) => this.copy(item));
  }
}

export const memoryLearningItems = new InMemoryLearningItemRepository();

/**
 * Create once; later taps with the same word+lang+source refetch that row (same id).
 */
export async function openOrCreateVocabularyCard(
  deps: { cards: VocabularyCardPort; items: LearningItemRepository },
  input: OpenVocabularyCardInput
): Promise<OpenVocabularyCardResult> {
  const word = input.word.trim();
  if (!word) throw new Error('LearningItem.word must not be empty');
  const language = resolveVocabCardLanguage(word, input.language);
  const existing = await deps.items.findByIdentity(input.userId, word, language, input.source);
  if (existing?.id) {
    const refetched = (await deps.items.findById(existing.id)) ?? existing;
    return { item: refetched, created: false };
  }
  if (existing) {
    return { item: existing, created: false };
  }
  const generated = await deps.cards.generateVocabularyCard(word, input.sentence, language);
  const needsReading = needsReadingAttribute(toGigolingoLangKey(language));
  const toSave = createLearningItem({
    ...(generated ?? {
      word,
      translation: word,
      sentenceOrig: input.sentence,
      sentenceEng: input.sentence,
      language,
      reading: needsReading ? word : '',
    }),
    word,
    language,
    userId: input.userId,
    source: input.source,
    dateAdded: generated?.dateAdded ?? new Date(),
  });
  const saved = await deps.items.save(applyReadingLikeGigolingo(toSave, language, toSave.sentenceOrig));
  return { item: saved, created: true };
}

export function createVocabularyWordTap(input: {
  userId: () => string | null;
  cards: VocabularyCardPort;
  items: LearningItemRepository;
  onOpen: (result: OpenVocabularyCardResult) => void;
}): WordTapPort {
  return {
    async onPress(request) {
      const userId = input.userId();
      if (!userId) return;
      const result = await openOrCreateVocabularyCard(
        { cards: input.cards, items: input.items },
        {
          userId,
          word: request.token,
          sentence: request.sentence,
          language: resolveVocabCardLanguage(request.token, request.language),
          source: request.source,
        }
      );
      input.onOpen(result);
    },
  };
}
