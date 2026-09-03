export type {
  LanguageCode,
  DisplayMode,
  LearnerViewpoint,
  ReceiptStatus,
  MessageKind,
  MessageLine,
  SourceMessage,
  LineTranslation,
  ConversationParticipant,
  Conversation,
  DisplayLine,
  TranslationRequest,
} from './chat';
export {
  normalizeLanguageCode,
  toGigolingoLangKey,
  createLearnerViewpoint,
  receiptLabel,
  receiptMark,
  splitSourceLines,
  sourceMessageFromText,
  otherParticipantId,
  viewpointLangsFor,
  translationFor,
  planLineJobs,
  LEARNING_BOT_USER_ID,
  LEARNING_BOT_DISPLAY_NAME,
  isLearningBotConversation,
} from './chat';

export type {
  LearningSource,
  LearningItem,
  MediaCompatibleLine,
  MediaCompatibleBlock,
} from './learning';
export {
  learningSourceKey,
  toGigolingoSourceMediaId,
  toGigolingoSourceMediaName,
  createLearningItem,
  toMediaBlock,
  fromMediaBlock,
} from './learning';

export type { InterlinearSegment } from './text';
export {
  parseInterlinear,
  extractOriginalText,
  hasInterlinearFormat,
  createInterlinearFormat,
  tokenizeText,
} from './text';

export type {
  FriendshipStatus,
  PublicProfile,
  Friendship,
  FriendRowKind,
  FriendRow,
  FriendRequestError,
  ParsedFriendIdentifier,
} from './friends';
export {
  FriendRequestFailed,
  normalizeUsername,
  friendshipPairKey,
  otherFriendId,
  kindForViewer,
  validateFriendRequest,
  existingIncomingFrom,
  listFriendRows,
  friendRequestErrorMessage,
  parseFriendIdentifier,
  parseFriendShareInput,
  friendSharePath,
  friendShareUrl,
  dualDirectoryError,
  seedMutualAccepted,
} from './friends';

export type {
  TranslationMode,
  AsymmetricLanguageContext,
  TranslationLlmPayload,
  PipelineProvider,
  ChatHistoryPipelineState,
  ChatHistoryPipelineEvent,
  ChatHistoryRecord,
  ChatHistoryStore,
  BilingualChatReply,
} from './pipeline';
export {
  toDisplayMode,
  toTranslationMode,
  buildTranslationPayload,
  buildDetectThenTranslatePrompt,
  parseDetectThenTranslateJson,
  extractJsonObject,
  buildBilingualChatPrompt,
  parseBilingualChatJson,
  extractChatReplyText,
  lineTranslationsFromBilingual,
  createChatHistoryRecord,
  transitionChatHistory,
  splitTranslationIntoLines,
} from './pipeline';

import {
  assembleLineTranslations as assembleCore,
  renderViewpoint as renderViewpointCore,
  type DisplayLine,
  type DisplayMode,
  type LanguageCode,
  type LearnerViewpoint,
  type LineTranslation,
  type SourceMessage,
} from './chat';
import { createInterlinearFormat } from './text';

/** Bind Birkenbihl helper so callers import from domain once. */
export function renderViewpoint(
  message: SourceMessage,
  translations: LineTranslation[],
  viewpoint: LearnerViewpoint
): DisplayLine[] {
  return renderViewpointCore(message, translations, viewpoint, createInterlinearFormat);
}

export function assembleLineTranslations(
  lines: string[],
  translated: string[],
  targetLang: LanguageCode,
  mode: DisplayMode
) {
  return assembleCore(lines, translated, targetLang, mode, createInterlinearFormat);
}
