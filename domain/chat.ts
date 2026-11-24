/** Chat domain: languages, viewpoints, messages, conversations, receipts, render queries. */

import { isUsableBirkenbihlOverlay } from './text';

export type LanguageCode = string;

export function normalizeLanguageCode(raw: string): LanguageCode {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Language code must not be empty');
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes('-')) {
    const [lang, region] = trimmed.split('-');
    return `${lang.toLowerCase()}-${(region ?? '').toUpperCase()}`;
  }
  if (trimmed.length === 2 || /^[A-Za-z]{2}$/.test(trimmed)) {
    return lower;
  }
  return lower;
}

export function toGigolingoLangKey(code: LanguageCode): string {
  const base = code.split('-')[0] ?? code;
  return base.toUpperCase();
}

export type DisplayMode = 'lines' | 'birkenbihl';

export interface LearnerViewpoint {
  native: LanguageCode;
  learning: LanguageCode;
  displayMode: DisplayMode;
}

export function createLearnerViewpoint(input: LearnerViewpoint): LearnerViewpoint {
  if (input.native === input.learning) {
    throw new Error('Native and learning languages must differ');
  }
  return { ...input };
}

/** Shape + label communicate state; UI must not rely on color alone (WCAG). */
export type ReceiptStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export function receiptLabel(status: ReceiptStatus): string {
  switch (status) {
    case 'pending':
      return 'Sending';
    case 'sent':
      return 'Sent';
    case 'delivered':
      return 'Delivered';
    case 'read':
      return 'Read';
    case 'failed':
      return 'Failed';
  }
}

export function receiptMark(
  status: ReceiptStatus
): 'empty' | 'single' | 'double' | 'filled' | 'error' {
  switch (status) {
    case 'pending':
      return 'empty';
    case 'sent':
      return 'single';
    case 'delivered':
      return 'double';
    case 'read':
      return 'filled';
    case 'failed':
      return 'error';
  }
}

export type MessageKind = 'user' | 'ai' | 'system';
/** Stickers are images; tighter bubble sizing vs a picked photo. */
export type MessageMediaKind = 'image' | 'sticker';

export const STICKER_URI_PREFIX = 'sticker:';

/** WhatsApp-style placeholder after delete-for-everyone. */
export const DELETED_FOR_EVERYONE_COPY = 'This message was deleted';

export function stickerUri(id: string): string {
  return `${STICKER_URI_PREFIX}${id}`;
}

export function parseStickerId(uri: string): string | undefined {
  if (uri.startsWith('sticker://')) {
    const id = uri.slice('sticker://'.length).trim();
    return id.length > 0 ? id : undefined;
  }
  if (uri.startsWith(STICKER_URI_PREFIX)) {
    const id = uri.slice(STICKER_URI_PREFIX.length).trim();
    return id.length > 0 ? id : undefined;
  }
  return undefined;
}

export interface MessageLine {
  content: string;
  reading?: string;
  en?: string;
  imageUrls?: string[];
  mediaKind?: MessageMediaKind;
  [languageKey: string]: string | string[] | undefined;
}

export interface SourceMessage {
  id: string;
  conversationId: string;
  authorId: string;
  sourceLang: LanguageCode;
  sourceText: string;
  lines: MessageLine[];
  kind: MessageKind;
  /** Default text. Stickers and photos share `image` via `mediaKind` / `sticker`. */
  contentKind?: 'text' | 'image';
  mediaKind?: MessageMediaKind;
  sticker?: boolean;
  replyToId?: string;
  editedAt?: string;
  deletedAt?: string;
  receipt: ReceiptStatus;
  createdAt: string;
}

export interface LineTranslation {
  lineIndex: number;
  targetLang: LanguageCode;
  text: string;
  mode: DisplayMode;
}

export function splitSourceLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

export function sourceMessageFromText(input: {
  id: string;
  conversationId: string;
  authorId: string;
  sourceLang: LanguageCode;
  sourceText: string;
  kind?: MessageKind;
  receipt?: ReceiptStatus;
  createdAt?: string;
  replyToId?: string;
}): SourceMessage {
  const lines = splitSourceLines(input.sourceText).map((content) => ({ content }));
  return {
    id: input.id,
    conversationId: input.conversationId,
    authorId: input.authorId,
    sourceLang: input.sourceLang,
    sourceText: input.sourceText,
    lines: lines.length > 0 ? lines : [{ content: input.sourceText }],
    kind: input.kind ?? 'user',
    replyToId: input.replyToId,
    receipt: input.receipt ?? 'pending',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function sourceMessageFromImage(input: {
  id: string;
  conversationId: string;
  authorId: string;
  sourceLang: LanguageCode;
  imageUrl: string;
  mediaKind?: MessageMediaKind;
  alt?: string;
  kind?: MessageKind;
  receipt?: ReceiptStatus;
  createdAt?: string;
  replyToId?: string;
}): SourceMessage {
  const alt = (input.alt ?? '').trim();
  const mediaKind = input.mediaKind ?? (parseStickerId(input.imageUrl) ? 'sticker' : 'image');
  return {
    id: input.id,
    conversationId: input.conversationId,
    authorId: input.authorId,
    sourceLang: input.sourceLang,
    sourceText: alt,
    lines: [{ content: alt, imageUrls: [input.imageUrl], mediaKind }],
    kind: input.kind ?? 'user',
    contentKind: 'image',
    mediaKind,
    sticker: mediaKind === 'sticker',
    replyToId: input.replyToId,
    receipt: input.receipt ?? 'pending',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function imageUrlsOf(message: Pick<SourceMessage, 'lines'>): string[] {
  return message.lines.flatMap((line) => (Array.isArray(line.imageUrls) ? line.imageUrls : []));
}

export function mediaKindOf(
  message: Pick<SourceMessage, 'lines' | 'contentKind' | 'sticker' | 'mediaKind'>
): MessageMediaKind | undefined {
  if (message.mediaKind) return message.mediaKind;
  if (message.sticker) return 'sticker';
  if (message.lines.some((line) => line.mediaKind === 'sticker')) return 'sticker';
  const urls = imageUrlsOf(message);
  if (urls.some((url) => parseStickerId(url))) return 'sticker';
  if (message.contentKind === 'image' || urls.length > 0) return 'image';
  return undefined;
}

export function isMediaMessage(
  message: Pick<SourceMessage, 'lines' | 'contentKind' | 'sticker' | 'mediaKind'>
): boolean {
  return mediaKindOf(message) !== undefined;
}

/** Stickers and photos skip detect / translate / Birkenbihl. */
export function shouldTranslateMessage(
  message: Pick<SourceMessage, 'sourceText' | 'lines' | 'contentKind' | 'sticker' | 'mediaKind' | 'deletedAt'>
): boolean {
  if (message.deletedAt) return false;
  if (isMediaMessage(message)) return false;
  return message.sourceText.trim().length > 0;
}

export function conversationPreviewFor(
  message: Pick<SourceMessage, 'sourceText' | 'lines' | 'contentKind' | 'sticker' | 'mediaKind' | 'deletedAt'>
): string {
  if (message.deletedAt) return DELETED_FOR_EVERYONE_COPY;
  if (mediaKindOf(message) === 'sticker') return 'Sticker';
  if (isMediaMessage(message) && !message.sourceText.trim()) return 'Photo';
  return message.sourceText.split('\n')[0] ?? '';
}

export interface ConversationParticipant {
  userId: string;
  nativeLang: string;
  learningLang: string;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  participants: ConversationParticipant[];
  aiEnabled: boolean;
  pinned?: boolean;
  muted?: boolean;
  title?: string;
  updatedAt: string;
  lastMessagePreview?: string;
  unreadCount: number;
}

/** Stable participant id — friends skip this thread by id, not by display name. */
export const LEARNING_BOT_USER_ID = 'savigna-ai';
/** User-facing name for the learning partner. */
export const LEARNING_BOT_DISPLAY_NAME = 'Bot';

export function isLearningBotConversation(conversation: Pick<Conversation, 'participantIds' | 'title'>): boolean {
  return (
    conversation.participantIds.includes(LEARNING_BOT_USER_ID) ||
    conversation.title === LEARNING_BOT_DISPLAY_NAME ||
    Boolean(conversation.title && /savigna/i.test(conversation.title))
  );
}

/** One Bot row in the inbox — parallel ensure + mixed user ids created extras. */
export function pickLearningBotConversation(conversations: Conversation[]): Conversation | undefined {
  const bots = conversations.filter(isLearningBotConversation);
  if (bots.length === 0) return undefined;
  const meaningful = bots.filter((item) => {
    const preview = item.lastMessagePreview?.trim() ?? '';
    return preview.length > 0 && !/^ready when you are/i.test(preview);
  });
  const pool = meaningful.length > 0 ? meaningful : bots;
  return [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function collapseDuplicateLearningBots(conversations: Conversation[]): Conversation[] {
  const keeper = pickLearningBotConversation(conversations);
  if (!keeper) return conversations;
  return conversations.filter((item) => item.id === keeper.id || !isLearningBotConversation(item));
}

export function isHumanDirectChat(participantIds: string[]): boolean {
  if (participantIds.includes(LEARNING_BOT_USER_ID)) return false;
  return new Set(participantIds.filter(Boolean)).size === 2;
}

export function humanDirectPairKey(
  participantIds: string[],
  canonicalize: (id: string) => string = (id) => id
): string | null {
  const humans = [
    ...new Set(
      participantIds.filter((id) => id && id !== LEARNING_BOT_USER_ID).map((id) => canonicalize(id))
    ),
  ].sort();
  if (humans.length !== 2) return null;
  return `${humans[0]}:${humans[1]}`;
}

/** Shared id both participants use for one DM (`dm:<sortedUuid>:<sortedUuid>`). */
export function directConversationId(left: string, right: string): string {
  const [a, b] = [left, right].sort();
  return `dm:${a}:${b}`;
}

export function pickDirectConversation(group: Conversation[]): Conversation {
  const ranked = [...group].sort((a, b) => {
    const aCanon = a.id.startsWith('dm:') ? 1 : 0;
    const bCanon = b.id.startsWith('dm:') ? 1 : 0;
    if (aCanon !== bCanon) return bCanon - aCanon;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const keeper = ranked[0];
  const newest = [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return {
    ...keeper,
    updatedAt: newest.updatedAt,
    lastMessagePreview: newest.lastMessagePreview ?? keeper.lastMessagePreview,
    unreadCount: Math.max(...group.map((item) => item.unreadCount)),
  };
}

export function collapseDuplicateDirectChats(
  conversations: Conversation[],
  canonicalize: (id: string) => string = (id) => id
): Conversation[] {
  const groups = new Map<string, Conversation[]>();
  const rest: Conversation[] = [];
  for (const conversation of conversations) {
    if (isLearningBotConversation(conversation)) {
      rest.push(conversation);
      continue;
    }
    const key = humanDirectPairKey(conversation.participantIds, canonicalize);
    if (!key) {
      rest.push(conversation);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(conversation);
    groups.set(key, list);
  }
  return [...rest, ...[...groups.values()].map(pickDirectConversation)];
}

const RECEIPT_RANK: Record<ReceiptStatus, number> = {
  failed: 0,
  pending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export function pickRicherMessage(left: SourceMessage, right: SourceMessage): SourceMessage {
  const deletedAt = left.deletedAt ?? right.deletedAt;
  const receipt =
    RECEIPT_RANK[right.receipt] > RECEIPT_RANK[left.receipt] ? right.receipt : left.receipt;
  const lines = right.lines.length >= left.lines.length ? right.lines : left.lines;
  const older = left.createdAt <= right.createdAt ? left : right;
  const newer = older === left ? right : left;
  const merged: SourceMessage = {
    ...newer,
    id: older.id,
    receipt,
    lines,
    sourceText: newer.sourceText || left.sourceText || right.sourceText,
    editedAt: right.editedAt ?? left.editedAt,
    deletedAt,
  };
  if (deletedAt) {
    return {
      ...merged,
      deletedAt,
      sourceText: '',
      lines: [{ content: '' }],
      contentKind: 'text',
      mediaKind: undefined,
      sticker: undefined,
    };
  }
  return merged;
}

export function isNearDuplicateMessage(left: SourceMessage, right: SourceMessage): boolean {
  if (left.id === right.id) return true;
  if (left.authorId !== right.authorId || left.kind !== right.kind) return false;
  if (left.sourceText !== right.sourceText) return false;
  const delta = Math.abs(Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return Number.isFinite(delta) && delta <= 2000;
}

/** One timeline: same id or same author+text within 2s collapses; order is createdAt. */
export function mergeMessageTimelines(...lists: SourceMessage[][]): SourceMessage[] {
  const byId = new Map<string, SourceMessage>();
  for (const list of lists) {
    for (const message of list) {
      const previous = byId.get(message.id);
      byId.set(message.id, previous ? pickRicherMessage(previous, message) : message);
    }
  }
  const sorted = [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
  const merged: SourceMessage[] = [];
  for (const message of sorted) {
    const index = merged.findIndex((item) => isNearDuplicateMessage(item, message));
    if (index >= 0) merged[index] = pickRicherMessage(merged[index], message);
    else merged.push(message);
  }
  return merged;
}

export function otherParticipantId(
  conversation: Conversation,
  viewerId: string | readonly string[]
): string | undefined {
  const ids = typeof viewerId === 'string' ? [viewerId] : viewerId;
  return conversation.participantIds.find((id) => !ids.includes(id));
}

export function viewpointLangsFor(
  conversation: Conversation,
  viewerId: string | readonly string[]
): ConversationParticipant | undefined {
  const ids = typeof viewerId === 'string' ? [viewerId] : viewerId;
  return conversation.participants.find((item) => ids.includes(item.userId));
}

export interface DisplayLine {
  learningText: string;
  nativeText: string;
  sourceText: string;
  lineIndex: number;
  birkenbihl?: string;
  /** Language of `learningText` — source lang when there is no learning translation yet. */
  learningLangTag: LanguageCode;
  /** Language of `nativeText` when it is shown. */
  nativeLangTag: LanguageCode;
}

function langField(line: MessageLine, lang: LanguageCode): string | undefined {
  const direct = line[lang];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const upper = line[lang.toUpperCase()];
  if (typeof upper === 'string' && upper.length > 0) return upper;
  if (lang === 'en' || lang === 'EN') {
    return typeof line.en === 'string' ? line.en : undefined;
  }
  return undefined;
}

export function translationFor(
  translations: LineTranslation[],
  lineIndex: number,
  lang: LanguageCode,
  mode: DisplayMode
): string | undefined {
  return translations.find(
    (item) => item.lineIndex === lineIndex && item.targetLang === lang && item.mode === mode
  )?.text;
}

export function storedBirkenbihlFor(
  translations: LineTranslation[],
  lineIndex: number,
  preferredLang: LanguageCode
): string | undefined {
  const text =
    translationFor(translations, lineIndex, preferredLang, 'birkenbihl') ??
    translations.find((item) => item.lineIndex === lineIndex && item.mode === 'birkenbihl')?.text;
  return text && isUsableBirkenbihlOverlay(text) ? text : undefined;
}

export type TranslationMismatchReason =
  | 'missing_learning'
  | 'missing_native'
  | 'empty_pair'
  | 'same_as_source'
  | 'missing_birkenbihl';

/** Short why-copy for the bubble Retry control. */
export function translationRetryWhy(reason: TranslationMismatchReason): string {
  return reason === 'same_as_source' ? 'Language mismatch' : 'Missing translation';
}

function storedLineText(
  translations: LineTranslation[],
  lineIndex: number,
  lang: LanguageCode,
  mode: DisplayMode
): string | undefined {
  const want = lang.toLowerCase();
  return translations.find(
    (item) =>
      item.lineIndex === lineIndex &&
      item.targetLang.toLowerCase() === want &&
      item.mode === mode
  )?.text;
}

function isBlankOrSameAsSource(text: string | undefined, sourceText: string): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return true;
  return trimmed === sourceText.trim();
}

/**
 * Whether this bubble needs a visible Retry given the viewer’s languages.
 * Does not guess languages from the text — only stored JSON/lines vs settings.
 */
export function translationMismatch(input: {
  message: SourceMessage;
  translations: LineTranslation[];
  viewpoint: LearnerViewpoint;
}): TranslationMismatchReason | null {
  const { message, translations, viewpoint } = input;
  if (!shouldTranslateMessage(message)) return null;

  if (viewpoint.displayMode === 'birkenbihl') {
    const hasBirken = translations.some(
      (row) => row.mode === 'birkenbihl' && isUsableBirkenbihlOverlay(row.text)
    );
    return hasBirken ? null : 'missing_birkenbihl';
  }

  const sourceLang = message.sourceLang.toLowerCase();
  const learning = viewpoint.learning.toLowerCase();
  const native = viewpoint.native.toLowerCase();
  const needsLearning = learning !== sourceLang;
  const needsNative = native !== sourceLang && native !== learning;

  const lineRows = translations.filter((row) => row.mode === 'lines');
  const nonemptyPair = lineRows.some((row) => row.text.trim().length > 0);
  if ((needsLearning || needsNative) && !nonemptyPair) {
    return 'empty_pair';
  }

  for (const [lineIndex, line] of message.lines.entries()) {
    const sourceText = line.content;
    if (!sourceText.trim()) continue;

    if (needsLearning) {
      const learningText = storedLineText(translations, lineIndex, learning, 'lines');
      if (!learningText?.trim()) return 'missing_learning';
      if (isBlankOrSameAsSource(learningText, sourceText)) return 'same_as_source';
    }

    if (needsNative) {
      const nativeText = storedLineText(translations, lineIndex, native, 'lines');
      if (!nativeText?.trim()) return 'missing_native';
      if (isBlankOrSameAsSource(nativeText, sourceText)) return 'same_as_source';
    }
  }

  return null;
}

function distinctTranslation(
  candidate: string | undefined,
  sourceText: string
): string | undefined {
  const text = candidate?.trim();
  if (!text) return undefined;
  if (text === sourceText.trim()) return undefined;
  return candidate;
}

/**
 * Query: build what one viewer should see. Does not persist (CQS).
 * Birkenbihl overlays come only from stored `mode: 'birkenbihl'` rows — never from
 * local word-split synthesis of learning + native lines.
 */
export function renderViewpoint(
  message: SourceMessage,
  translations: LineTranslation[],
  viewpoint: LearnerViewpoint,
  options?: { own?: boolean }
): DisplayLine[] {
  return message.lines.map((line, lineIndex) => {
    const sourceText = line.content;
    const learningHit = distinctTranslation(
      translationFor(translations, lineIndex, viewpoint.learning, 'lines') ??
        langField(line, viewpoint.learning),
      sourceText
    );
    const nativeHit = distinctTranslation(
      translationFor(translations, lineIndex, viewpoint.native, 'lines') ??
        langField(line, viewpoint.native),
      sourceText
    );
    const birkenbihl =
      viewpoint.displayMode === 'birkenbihl'
        ? storedBirkenbihlFor(translations, lineIndex, viewpoint.native)
        : undefined;

    if (options?.own) {
      const second = learningHit;
      const showNative = Boolean(
        second &&
          second.trim().length > 0 &&
          // Case changes can happen when re-translating a "same-language" pair after a settings swap.
          second.trim().toLowerCase() !== sourceText.trim().toLowerCase()
      );
      return {
        learningText: sourceText,
        nativeText: showNative && second ? second : '',
        sourceText,
        lineIndex,
        birkenbihl,
        learningLangTag: viewpoint.native,
        nativeLangTag: showNative ? viewpoint.learning : viewpoint.native,
      };
    }

    const learningText = learningHit ?? sourceText;
    const nativeText =
      nativeHit ?? (viewpoint.native === message.sourceLang ? sourceText : '');
    const sameStringPair =
      nativeText.trim().length > 0 &&
      nativeText.trim() === learningText.trim() &&
      (nativeHit ? viewpoint.native : message.sourceLang) ===
        (learningHit ? viewpoint.learning : message.sourceLang);

    return {
      learningText,
      nativeText: sameStringPair ? '' : nativeText,
      sourceText,
      lineIndex,
      birkenbihl,
      learningLangTag: learningHit ? viewpoint.learning : message.sourceLang,
      nativeLangTag:
        nativeHit || viewpoint.native === message.sourceLang
          ? viewpoint.native
          : message.sourceLang,
    };
  });
}

export interface TranslationRequest {
  text: string;
  sourceLang?: LanguageCode;
  targetLang: LanguageCode;
  mode: DisplayMode;
}

/** Pure split + bookkeeping. Engine I/O belongs in application services (IOSP). */
export function planLineJobs(
  text: string,
  targetLang: LanguageCode,
  mode: DisplayMode
): TranslationRequest[] {
  return splitSourceLines(text).map((line) => ({
    text: line,
    targetLang,
    mode,
  }));
}

export function assembleLineTranslations(
  lines: string[],
  translated: string[],
  targetLang: LanguageCode,
  mode: DisplayMode
): LineTranslation[] {
  return lines.map((_, lineIndex) => ({
    lineIndex,
    targetLang,
    mode,
    text: translated[lineIndex] ?? '',
  }));
}
