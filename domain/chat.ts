/** Chat domain: languages, viewpoints, messages, conversations, receipts, render queries. */

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

export function stickerUri(id: string): string {
  return `${STICKER_URI_PREFIX}${id}`;
}

export function parseStickerId(uri: string): string | undefined {
  return uri.startsWith(STICKER_URI_PREFIX) ? uri.slice(STICKER_URI_PREFIX.length) : undefined;
}

export interface MessageLine {
  content: string;
  reading?: string;
  en?: string;
  imageUrls?: string[];
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
  mediaKind?: MessageMediaKind;
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
    lines: [{ content: alt, imageUrls: [input.imageUrl] }],
    kind: input.kind ?? 'user',
    mediaKind,
    replyToId: input.replyToId,
    receipt: input.receipt ?? 'pending',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function imageUrlsOf(message: Pick<SourceMessage, 'lines'>): string[] {
  return message.lines.flatMap((line) => (Array.isArray(line.imageUrls) ? line.imageUrls : []));
}

export function mediaKindOf(
  message: Pick<SourceMessage, 'lines' | 'mediaKind'>
): MessageMediaKind | undefined {
  if (message.mediaKind) return message.mediaKind;
  const urls = imageUrlsOf(message);
  if (urls.some((url) => parseStickerId(url))) return 'sticker';
  if (urls.length > 0) return 'image';
  return undefined;
}

export function isMediaMessage(message: Pick<SourceMessage, 'lines' | 'mediaKind'>): boolean {
  return mediaKindOf(message) !== undefined;
}

/** Stickers and caption-less photos skip the translation pipeline. */
export function shouldTranslateMessage(
  message: Pick<SourceMessage, 'sourceText' | 'lines' | 'mediaKind'>
): boolean {
  if (mediaKindOf(message) === 'sticker') return false;
  if (isMediaMessage(message) && !message.sourceText.trim()) return false;
  return message.sourceText.trim().length > 0;
}

export function conversationPreviewFor(
  message: Pick<SourceMessage, 'sourceText' | 'lines' | 'mediaKind'>
): string {
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
export const LEARNING_BOT_DISPLAY_NAME = 'SavignasBoi';

export function isLearningBotConversation(conversation: Pick<Conversation, 'participantIds' | 'title'>): boolean {
  return (
    conversation.participantIds.includes(LEARNING_BOT_USER_ID) ||
    Boolean(conversation.title?.includes('Savigna'))
  );
}

export function otherParticipantId(
  conversation: Conversation,
  viewerId: string
): string | undefined {
  return conversation.participantIds.find((id) => id !== viewerId);
}

export function viewpointLangsFor(
  conversation: Conversation,
  viewerId: string
): ConversationParticipant | undefined {
  return conversation.participants.find((item) => item.userId === viewerId);
}

export interface DisplayLine {
  learningText: string;
  nativeText: string;
  sourceText: string;
  lineIndex: number;
  birkenbihl?: string;
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

/**
 * Query: build what one viewer should see. Does not persist (CQS).
 */
export function renderViewpoint(
  message: SourceMessage,
  translations: LineTranslation[],
  viewpoint: LearnerViewpoint,
  createInterlinear: (original: string, translation: string) => string
): DisplayLine[] {
  return message.lines.map((line, lineIndex) => {
    const sourceText = line.content;
    const learningText =
      translationFor(translations, lineIndex, viewpoint.learning, 'lines') ??
      langField(line, viewpoint.learning) ??
      sourceText;
    const nativeText =
      translationFor(translations, lineIndex, viewpoint.native, 'lines') ??
      langField(line, viewpoint.native) ??
      (viewpoint.native === message.sourceLang ? sourceText : '');
    const birkenbihl =
      viewpoint.displayMode === 'birkenbihl'
        ? (translationFor(translations, lineIndex, viewpoint.native, 'birkenbihl') ??
          createInterlinear(learningText, nativeText || sourceText))
        : undefined;

    return {
      learningText,
      nativeText: nativeText || sourceText,
      sourceText,
      lineIndex,
      birkenbihl,
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
  mode: DisplayMode,
  toBirkenbihl: (original: string, translation: string) => string
): LineTranslation[] {
  return lines.map((original, lineIndex) => ({
    lineIndex,
    targetLang,
    mode,
    text:
      mode === 'birkenbihl'
        ? toBirkenbihl(original, translated[lineIndex] ?? '')
        : (translated[lineIndex] ?? ''),
  }));
}
