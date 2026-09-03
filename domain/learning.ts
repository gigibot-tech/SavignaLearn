/**
 * Learning domain shared with future Gigolingo media/vocabulary.
 * LONG-TERM: LearningItem field names match Gigolingo Word; chat never imports features/media.
 */

import type { LanguageCode } from './chat';
import { toGigolingoLangKey } from './chat';
import type { MessageLine } from './chat';

export type LearningSource =
  | {
      kind: 'chat';
      conversationId: string;
      messageId: string;
      lineIndex: number;
    }
  | {
      kind: 'media';
      mediaId: string;
      mediaName?: string;
      blockId?: string;
      lineIndex?: number;
    }
  | { kind: 'lecture'; lectureId: string }
  | { kind: 'manual' }
  | { kind: 'plugin'; pluginId: string };

export function learningSourceKey(source: LearningSource): string {
  switch (source.kind) {
    case 'chat':
      return `chat:${source.conversationId}:${source.messageId}:${source.lineIndex}`;
    case 'media':
      return `media:${source.mediaId}:${source.blockId ?? ''}:${source.lineIndex ?? ''}`;
    case 'lecture':
      return `lecture:${source.lectureId}`;
    case 'manual':
      return 'manual';
    case 'plugin':
      return `plugin:${source.pluginId}`;
  }
}

/** Maps to Gigolingo Word.sourceMediaId when the source is media; chat stays unset. */
export function toGigolingoSourceMediaId(source: LearningSource): string | undefined {
  return source.kind === 'media' ? source.mediaId : undefined;
}

export function toGigolingoSourceMediaName(source: LearningSource): string | undefined {
  return source.kind === 'media' ? source.mediaName : undefined;
}

/**
 * Field names match Gigolingo `Word` so later toGigolingoWord is a mapper.
 * LONG-TERM: do not add sourceMediaId here — use `source`.
 */
export interface LearningItem {
  id?: string;
  word: string;
  translation: string;
  sentenceOrig: string;
  sentenceEng: string;
  sentenceReading?: string;
  reading: string;
  seenCount?: number;
  progress?: number;
  languageLevel?: string;
  frequency?: string;
  jlpt?: string;
  language?: LanguageCode;
  dateAdded?: Date;
  lastReviewed?: Date;
  nextReview?: Date;
  correctCount?: number;
  userId?: string;
  easeFactor?: number;
  interval?: number;
  repetitions?: number;
  quality?: number;
  source: LearningSource;
}

export function createLearningItem(
  input: Omit<LearningItem, 'reading' | 'source'> & {
    reading?: string;
    source: LearningSource;
  }
): LearningItem {
  const word = input.word.trim();
  if (!word) {
    throw new Error('LearningItem.word must not be empty');
  }
  return {
    ...input,
    word,
    reading: input.reading ?? '',
    source: input.source,
  };
}

/** Structural compatibility with Gigolingo Media Block/Line. */
export interface MediaCompatibleLine {
  content: string;
  reading: string;
  anchors: string[];
  en: string;
  imageUrls?: string[];
  [languageKey: string]: string | string[] | undefined;
}

export interface MediaCompatibleBlock {
  id: string;
  lines: MediaCompatibleLine[];
}

export function toMediaBlock(
  messageId: string,
  lines: MessageLine[],
  translationsByLang: Record<string, string[]>
): MediaCompatibleBlock {
  const mapped: MediaCompatibleLine[] = lines.map((line, index) => {
    const en =
      translationsByLang.en?.[index] ??
      translationsByLang.EN?.[index] ??
      (typeof line.en === 'string' ? line.en : '');
    const extra: Record<string, string> = {};
    for (const [lang, values] of Object.entries(translationsByLang)) {
      extra[toGigolingoLangKey(lang as LanguageCode)] = values[index] ?? '';
    }
    return {
      content: line.content,
      reading: typeof line.reading === 'string' ? line.reading : '',
      anchors: [],
      en,
      imageUrls: line.imageUrls,
      ...extra,
    };
  });
  return { id: `chat-${messageId}`, lines: mapped };
}

export function fromMediaBlock(block: MediaCompatibleBlock): MessageLine[] {
  return block.lines.map((line) => ({
    content: line.content,
    reading: line.reading,
    en: line.en,
    imageUrls: line.imageUrls,
  }));
}
