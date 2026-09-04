/**
 * Chat presentation: Gigolingo-style GradientBackground shell + fourSome glass/ember UI.
 * LONG-TERM: WordTapPort only — never call VocabularyCardPort from here.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DELETED_FOR_EVERYONE_COPY,
  badgeLabel,
  hasInterlinearFormat,
  joinOriginalsFromSelection,
  LEARNING_BOT_DISPLAY_NAME,
  parseInterlinear,
  receiptMark,
} from '@/domain';
import type { DisplayLine, ReceiptStatus, TranslationMismatchReason } from '@/domain/chat';
import { translationRetryWhy } from '@/domain/chat';
import type { LearningSource } from '@/domain/learning';
import type { TokenizerPort, WordTapPort } from '@/ports/ports';
import { AI_BACKENDS, type AiBackendId } from '@/adapters/chat';
import { isBackendSelectable, type AiHealthReport } from '@/adapters/aiHealth';
import { type ThemeColors } from '@/constants/Colors';
import { shouldKeepLoggedIn } from '@/adapters/authStorage';
import { useAppearance } from '@/features/shell/AppearanceProvider';
import {
  ChatMediaImage,
  ComposerMediaButtons,
  StickerTray,
  type OutgoingMedia,
} from './composerMedia';
import type { MessageMediaKind } from '@/domain/chat';
import { TappableSentence, useWebClipboardJoin } from './TappableSentence';
import { PersonAvatar, SavignasBoiAvatar } from './avatars';

export { SavignasBoiAvatar };

export function useThemeColors(scheme: 'light' | 'dark' | null | undefined): ThemeColors {
  const { pack } = useAppearance();
  return scheme === 'dark' ? pack.dark : pack.light;
}

/**
 * Full-bleed screen wash (Gigolingo GradientBackground + active appearance stops).
 */
export function GradientBackground({
  children,
  scheme,
  style,
}: {
  children: React.ReactNode;
  scheme?: 'light' | 'dark' | null;
  style?: StyleProp<ViewStyle>;
}) {
  const { pack } = useAppearance();
  const colors = scheme === 'dark' ? pack.gradients.dark : pack.gradients.light;
  return (
    <LinearGradient
      colors={[...colors]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.15, y: 1 }}
      style={[shell.gradient, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** Safe area + gradient — default chat screen chrome. */
export function GradientScreen({
  children,
  scheme,
  edges = ['top', 'left', 'right'],
}: {
  children: React.ReactNode;
  scheme?: 'light' | 'dark' | null;
  edges?: Array<'top' | 'right' | 'bottom' | 'left'>;
}) {
  return (
    <GradientBackground scheme={scheme}>
      <SafeAreaView style={shell.flex} edges={edges}>
        {children}
      </SafeAreaView>
    </GradientBackground>
  );
}

export function GlassPanel({
  children,
  colors,
  style,
}: {
  children: React.ReactNode;
  colors: ThemeColors;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        shell.glass,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function GradientCta({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { pack } = useAppearance();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={shell.ctaWrap}
    >
      <LinearGradient
        colors={[...pack.gradients.cta]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={shell.cta}
      >
        <Text style={shell.ctaText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const SLAY_GIF = require('../../assets/slay.gif');

export function SlayGif({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={SLAY_GIF}
      accessibilityLabel="Slay gif"
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

export function ThreadChromeHeader({
  title,
  subtitle,
  pipelineLabel,
  onBack,
  onOpenSettings,
  inlineSettings,
  colors,
  scheme,
  isBot,
  photoUrl,
  leadingIcon = 'chevron-back',
  leadingLabel = 'Back',
  onOpenProfile,
}: {
  title: string;
  subtitle?: string;
  pipelineLabel?: string;
  onBack: () => void;
  onOpenSettings?: () => void;
  inlineSettings?: React.ReactNode;
  colors: ThemeColors;
  scheme?: 'light' | 'dark' | null;
  isBot?: boolean;
  photoUrl?: string | null;
  leadingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  leadingLabel?: string;
  onOpenProfile?: () => void;
}) {
  const { pack } = useAppearance();
  const wash = scheme === 'dark' ? pack.gradients.headerDark : pack.gradients.headerLight;
  return (
    <LinearGradient colors={[...wash]} style={shell.threadHeaderWash}>
      <View
        style={[
          shell.threadHeader,
          {
            backgroundColor: colors.headerGlass,
            borderBottomColor: inlineSettings ? 'transparent' : colors.border,
          },
        ]}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={leadingLabel}
          hitSlop={12}
          style={shell.backHit}
        >
          <Ionicons name={leadingIcon} size={24} color={colors.accent} />
        </Pressable>
        <Pressable
          onPress={onOpenProfile}
          disabled={!onOpenProfile}
          accessibilityRole={onOpenProfile ? 'button' : undefined}
          accessibilityLabel={onOpenProfile ? `Open ${title} profile` : undefined}
          style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}
        >
          <PersonAvatar
            size={32}
            name={title}
            photoUrl={photoUrl}
            isBot={isBot}
            style={shell.headerAvatar}
          />
          <View style={shell.headerTitles}>
            <Text style={[shell.threadTitle, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
            {pipelineLabel ? (
              <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>
                {pipelineLabel}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {onOpenSettings ? (
          <Pressable
            onPress={onOpenSettings}
            accessibilityLabel="Chat languages and AI"
            hitSlop={12}
            style={shell.backHit}
          >
            <Ionicons name="options-outline" size={22} color={colors.accent} />
          </Pressable>
        ) : inlineSettings ? null : (
          <View style={{ width: 40 }} />
        )}
      </View>
      {inlineSettings}
    </LinearGradient>
  );
}

export function InterlinearBlock({
  text,
  colors,
  onTokenPress,
  onAccent,
}: {
  text: string;
  colors: ThemeColors;
  onTokenPress?: (token: string) => void;
  onAccent?: boolean;
}) {
  const topColor = onAccent ? colors.onAccent : colors.text;
  const hintColor = onAccent ? 'rgba(255,255,255,0.78)' : colors.textMuted;
  const hostRef = useRef<View>(null);
  const transform = useCallback(
    (selected: string) =>
      joinOriginalsFromSelection(
        selected,
        parseInterlinear(text).map((segment) => segment.original)
      ),
    [text]
  );
  useWebClipboardJoin(hostRef, transform);
  if (!hasInterlinearFormat(text)) {
    return (
      <Text selectable style={[styles.learningText, { color: topColor }]}>
        {text}
      </Text>
    );
  }
  const segments = parseInterlinear(text);
  const webSelect = Platform.OS === 'web' ? ({ userSelect: 'text' } as TextStyle) : null;
  const webSkipSelect = Platform.OS === 'web' ? ({ userSelect: 'none' } as TextStyle) : null;
  return (
    <View ref={hostRef} style={styles.interlinearRow}>
      {segments.map((segment, index) => (
        <Pressable
          key={`${segment.original}-${index}`}
          onPress={() => segment.original && onTokenPress?.(segment.original)}
          hitSlop={8}
          style={styles.interlinearSegment}
          accessibilityRole="button"
          accessibilityLabel={segment.original}
        >
          <Text selectable style={[styles.learningText, { color: topColor }, webSelect]}>
            {segment.original}
          </Text>
          {segment.translation ? (
            <Text style={[styles.nativeText, { color: hintColor }, webSkipSelect]}>{segment.translation}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

export function MessageLines({
  lines,
  mode,
  language,
  tokenizer,
  wordTap,
  source,
  colors,
  onAccent,
  nativeLang,
  learningLang,
  busy,
}: {
  lines: DisplayLine[];
  mode: 'lines' | 'birkenbihl';
  language: string;
  tokenizer: TokenizerPort;
  wordTap: WordTapPort;
  source: Omit<LearningSource & { kind: 'chat' }, 'lineIndex'> & { lineIndex?: number };
  colors: ThemeColors;
  onAccent?: boolean;
  nativeLang?: string;
  learningLang?: string;
  busy?: boolean;
}) {
  const learningColor = onAccent ? colors.onAccent : colors.text;
  const nativeColor = onAccent ? 'rgba(255,255,255,0.78)' : colors.textMuted;
  return (
    <View style={styles.linesBlock}>
      {lines.map((line) => {
        if (mode === 'birkenbihl') {
          if (line.birkenbihl) {
            return (
              <InterlinearBlock
                key={line.lineIndex}
                text={line.birkenbihl}
                colors={colors}
                onAccent={onAccent}
                onTokenPress={(token) => {
                  void wordTap.onPress({
                    token,
                    sentence: line.sourceText,
                    language,
                    source: { ...source, kind: 'chat', lineIndex: line.lineIndex },
                  });
                }}
              />
            );
          }
          const original = line.sourceText || line.learningText;
          const parts = tokenizer.tokenize(original, language);
          return (
            <View key={line.lineIndex} style={styles.linePair}>
              <TappableSentence
                text={original}
                tokens={parts}
                onTokenPress={(token) =>
                  void wordTap.onPress({
                    token,
                    sentence: original,
                    language,
                    source: { ...source, kind: 'chat', lineIndex: line.lineIndex },
                  })
                }
                style={[styles.learningText, { color: learningColor }]}
              />
              {busy ? (
                <LineBusyBars colors={colors} onAccent={onAccent} />
              ) : (
                <Text
                  style={[styles.nativeText, { color: nativeColor, minHeight: 16 }]}
                  accessibilityLabel="Birkenbihl translation unavailable"
                >
                  {' '}
                </Text>
              )}
            </View>
          );
        }
        const parts = tokenizer.tokenize(line.learningText, line.learningLangTag);
        const showNative =
          line.nativeText.trim().length > 0 &&
          line.nativeText.trim() !== line.learningText.trim();
        return (
          <View key={line.lineIndex} style={styles.linePair}>
            {learningLang ? (
              <Text style={[styles.langTag, { color: nativeColor }]}>
                {(line.learningLangTag ?? learningLang).toUpperCase()}
              </Text>
            ) : null}
            <TappableSentence
              text={line.learningText}
              tokens={parts}
              onTokenPress={(token) =>
                void wordTap.onPress({
                  token,
                  sentence: line.learningText,
                  language: line.learningLangTag,
                  source: { ...source, kind: 'chat', lineIndex: line.lineIndex },
                })
              }
              style={[styles.learningText, { color: learningColor }]}
            />
            {showNative ? (
              <>
                {nativeLang ? (
                  <Text style={[styles.langTag, { color: nativeColor }]}>
                    {(line.nativeLangTag ?? nativeLang).toUpperCase()}
                  </Text>
                ) : null}
                <Text selectable style={[styles.nativeText, { color: nativeColor }]}>
                  {line.nativeText}
                </Text>
              </>
            ) : busy ? (
              <LineBusyBars colors={colors} onAccent={onAccent} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function MessageBubble({
  mine,
  kind,
  lines,
  mode,
  language,
  tokenizer,
  wordTap,
  source,
  colors,
  receipt,
  failed,
  onRetry,
  streaming,
  errorCopy,
  nativeLang,
  learningLang,
  imageUrls,
  mediaKind,
  onRetryBirkenbihl,
  birkenbihlBusy,
  onRetryTranslation,
  translationRetryReason,
  translationRetryBusy,
  translating,
  deleted,
  onRequestDelete,
}: {
  mine: boolean;
  kind: 'user' | 'ai' | 'system';
  lines: DisplayLine[];
  mode: 'lines' | 'birkenbihl';
  language: string;
  tokenizer: TokenizerPort;
  wordTap: WordTapPort;
  source: { conversationId: string; messageId: string };
  colors: ThemeColors;
  receipt?: ReceiptStatus;
  failed?: boolean;
  onRetry?: () => void;
  streaming?: boolean;
  errorCopy?: string;
  nativeLang?: string;
  learningLang?: string;
  imageUrls?: string[];
  mediaKind?: MessageMediaKind;
  onRetryBirkenbihl?: () => void;
  birkenbihlBusy?: boolean;
  onRetryTranslation?: () => void;
  translationRetryReason?: TranslationMismatchReason | null;
  translationRetryBusy?: boolean;
  translating?: boolean;
  deleted?: boolean;
  onRequestDelete?: () => void;
}) {
  const { pack } = useAppearance();
  if (kind === 'system') {
    return (
      <Text style={[styles.systemText, { color: colors.textMuted }]} accessibilityRole="text">
        {lines.map((l) => l.sourceText).join(' ')}
      </Text>
    );
  }

  const alignSelf = mine ? 'flex-end' : 'flex-start';
  const mediaUrls = imageUrls?.filter(Boolean) ?? [];
  const isSticker = mediaKind === 'sticker';
  const captionLines = mediaUrls.length ? [] : lines;
  const mediaBlock =
    mediaUrls.length > 0 ? (
      <View style={styles.mediaBlock}>
        {mediaUrls.map((url) => (
          <ChatMediaImage
            key={url}
            url={url}
            sticker={isSticker}
            accessibilityLabel={captionLines[0]?.sourceText || (isSticker ? 'Sticker' : 'Photo')}
          />
        ))}
      </View>
    ) : null;
  const body =
    captionLines.length === 0 ? null : (
      <MessageLines
        lines={captionLines}
        mode={mediaUrls.length ? 'lines' : mode}
        language={language}
        tokenizer={tokenizer}
        wordTap={wordTap}
        source={{
          kind: 'chat',
          conversationId: source.conversationId,
          messageId: source.messageId,
          lineIndex: 0,
        }}
        colors={colors}
        onAccent={mine && kind === 'user' && !failed}
        nativeLang={nativeLang}
        learningLang={learningLang}
        busy={Boolean(
          (receipt === 'pending' || translating || translationRetryBusy || birkenbihlBusy) && !isSticker
        )}
      />
    );
  const sendBusy = receipt === 'pending';
  const missingBirken = lines.some((line) => !line.birkenbihl);
  const showTranslationRetry =
    !isSticker &&
    !failed &&
    !sendBusy &&
    Boolean((onRetryTranslation && translationRetryReason) || translationRetryBusy);
  const retryTint = mine && kind === 'user' && !failed ? 'rgba(255,255,255,0.92)' : colors.accent;
  const translationRetry = showTranslationRetry ? (
    <RetryAction
      tint={retryTint}
      busy={Boolean(translationRetryBusy)}
      busyLabel="Retrying…"
      idleLabel="Retry"
      why={translationRetryReason ? translationRetryWhy(translationRetryReason) : undefined}
      onPress={onRetryTranslation}
      accessibilityLabel={
        translationRetryBusy
          ? 'Retrying translation'
          : `Retry, ${translationRetryWhy(translationRetryReason!)}`
      }
    />
  ) : null;
  const birkenRetry =
    mode === 'birkenbihl' &&
    !isSticker &&
    !failed &&
    !sendBusy &&
    !showTranslationRetry &&
    Boolean(onRetryBirkenbihl || birkenbihlBusy) ? (
      <RetryAction
        tint={retryTint}
        busy={Boolean(birkenbihlBusy)}
        busyLabel="Recalculating…"
        idleLabel={missingBirken ? 'Retry Birkenbihl' : 'Recalculate Birkenbihl'}
        onPress={onRetryBirkenbihl}
        accessibilityLabel={
          birkenbihlBusy
            ? 'Recalculating Birkenbihl'
            : missingBirken
              ? 'Retry Birkenbihl'
              : 'Recalculate Birkenbihl'
        }
      />
    ) : null;
  const sendStatus =
    sendBusy && !deleted ? (
      <BusyHint tint={retryTint} label="Sending…" />
    ) : translating && !failed && !deleted && !translationRetryBusy && !showTranslationRetry ? (
      <BusyHint tint={retryTint} label="Translating…" />
    ) : null;
  const tombstoneColor =
    mine && kind === 'user' && !failed ? 'rgba(255,255,255,0.88)' : colors.textMuted;
  const inner = deleted ? (
    <Text style={[styles.tombstoneText, { color: tombstoneColor }]}>{DELETED_FOR_EVERYONE_COPY}</Text>
  ) : (
    <>
      {mediaBlock}
      {body}
      {sendStatus}
      {translationRetry}
      {birkenRetry}
    </>
  );
  const gestureProps = onRequestDelete
    ? {
        delayLongPress: 380,
        onLongPress: onRequestDelete,
        ...(Platform.OS === 'web'
          ? {
              onContextMenu: (event: { preventDefault(): void }) => {
                event.preventDefault();
                onRequestDelete();
              },
              tabIndex: -1,
            }
          : {}),
      }
    : {};

  if (mine && kind === 'user') {
    return (
      <MessageBubbleHost
        style={[styles.bubbleOuter, { alignSelf }]}
        canDelete={Boolean(onRequestDelete)}
        gestureProps={gestureProps}
      >
        <LinearGradient
          colors={failed ? [pack.tokens.wine, pack.tokens.failedDeep] : [...pack.gradients.bubbleOut]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.bubble, styles.bubbleMine, failed && styles.bubbleFailed]}
        >
          {inner}
          {receipt && !failed && !deleted && !sendBusy && !translating ? (
            <Text style={[styles.receipt, { color: 'rgba(255,255,255,0.85)' }]} accessibilityLabel={receipt}>
              {receiptGlyph(receipt)}
            </Text>
          ) : null}
          {failed && !deleted ? (
            <RetryAction
              tint="#FFE8E0"
              busy={false}
              busyLabel="Sending…"
              idleLabel={errorCopy ?? "Couldn't send. Tap to retry."}
              onPress={onRetry}
              accessibilityLabel="Retry send"
            />
          ) : null}
        </LinearGradient>
      </MessageBubbleHost>
    );
  }

  const bg = kind === 'ai' ? colors.bubbleAi : colors.bubbleIncoming;
  return (
    <MessageBubbleHost
      style={[
        styles.bubble,
        styles.bubbleOther,
        { backgroundColor: bg, alignSelf, borderColor: colors.border },
      ]}
      canDelete={Boolean(onRequestDelete)}
      gestureProps={gestureProps}
    >
      {kind === 'ai' && !deleted ? (
        <View style={styles.aiHeader}>
          <SavignasBoiAvatar size={22} />
          <Text style={[styles.aiLabel, { color: colors.accent }]}>{LEARNING_BOT_DISPLAY_NAME}</Text>
          {streaming ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </View>
      ) : null}
      {inner}
      {failed && !deleted ? (
        <RetryAction
          tint={colors.danger}
          busy={false}
          busyLabel="Sending…"
          idleLabel={errorCopy ?? 'Retry'}
          onPress={onRetry}
          accessibilityLabel="Retry send"
        />
      ) : null}
    </MessageBubbleHost>
  );
}

/**
 * Long-press / right-click host for delete. Must not be a web <button> — Retry and
 * Birkenbihl token taps already are, and nested buttons are invalid HTML.
 */
function MessageBubbleHost({
  style,
  canDelete,
  gestureProps,
  children,
}: {
  style: StyleProp<ViewStyle>;
  canDelete: boolean;
  gestureProps: object;
  children: React.ReactNode;
}) {
  if (!canDelete) {
    return <View style={style}>{children}</View>;
  }
  return (
    <Pressable accessibilityRole="none" style={style} {...gestureProps}>
      {children}
    </Pressable>
  );
}

function receiptGlyph(receipt: ReceiptStatus): string {
  const mark = receiptMark(receipt);
  if (mark === 'error') return '!';
  if (mark === 'filled' || mark === 'double') return '✓✓';
  if (mark === 'single') return '✓';
  return '…';
}

/** Languages available in chat pickers (ISO 639-1). */
export const CHAT_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'tr', label: 'Turkish' },
] as const;

export type ChatLanguageCode = (typeof CHAT_LANGUAGES)[number]['code'];

export type AiPartnerMode = 'off' | 'bot';

function languageLabel(code: string): string {
  return CHAT_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

export { languageLabel };

function LangPickerModal({
  visible,
  title,
  selected,
  exclude,
  colors,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected: string;
  exclude?: string;
  colors: ThemeColors;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={pickerStyles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          style={[pickerStyles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation?.()}
        >
          <Text style={[pickerStyles.sheetTitle, { color: colors.text }]}>{title}</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {CHAT_LANGUAGES.filter((l) => l.code !== exclude).map((lang) => {
              const active = lang.code === selected;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => {
                    onSelect(lang.code);
                    onClose();
                  }}
                  style={[
                    pickerStyles.option,
                    active && { backgroundColor: colors.accentSoft },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={{ color: colors.text, fontWeight: active ? '700' : '500' }}>
                    {lang.label}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>{lang.code.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={onClose} style={pickerStyles.cancel} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Composer({
  colors,
  onSend,
  onSendImage,
  replyPreview,
  onCancelReply,
  nativeLang,
  learningLang,
}: {
  colors: ThemeColors;
  onSend: (text: string) => void;
  onSendImage?: (media: OutgoingMedia) => void;
  replyPreview?: string;
  onCancelReply?: () => void;
  nativeLang: string;
  learningLang?: string;
}) {
  const { pack } = useAppearance();
  const [text, setText] = useState('');
  const [trayOpen, setTrayOpen] = useState(false);
  const draft = useRef('');
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const setDraft = (value: string) => {
    draft.current = value;
    setText(value);
  };

  const submit = () => {
    const fromDom = Platform.OS === 'web' ? (areaRef.current?.value ?? '') : '';
    const value = (fromDom || draft.current || text).trim();
    if (!value) return;
    draft.current = '';
    setText('');
    if (areaRef.current) areaRef.current.value = '';
    onSend(value);
  };

  const sendMedia = (media: OutgoingMedia) => {
    setTrayOpen(false);
    onSendImage?.(media);
  };

  const canSend = (draft.current.trim() || text.trim()).length > 0;
  const placeholder = learningLang
    ? `Message in ${languageLabel(nativeLang)} (learning ${languageLabel(learningLang)})…`
    : `Message in ${languageLabel(nativeLang)}…`;
  const sendControl = (
    <LinearGradient colors={[...pack.gradients.cta]} style={[styles.sendBtn, { pointerEvents: 'none' }]}>
      <Ionicons name="send" size={18} color="#fff" />
    </LinearGradient>
  );

  return (
    <View style={[styles.composerWrap, { backgroundColor: colors.headerGlass, borderTopColor: colors.border }]}>
      {replyPreview ? (
        <View style={[styles.replyPreview, { backgroundColor: colors.accentSoft }]}>
          <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
            {replyPreview}
          </Text>
          <Pressable onPress={onCancelReply} accessibilityLabel="Cancel reply" hitSlop={10}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      {trayOpen && onSendImage ? <StickerTray colors={colors} onPick={sendMedia} /> : null}
      <View style={styles.composerRow}>
        {onSendImage ? (
          <ComposerMediaButtons
            colors={colors}
            trayOpen={trayOpen}
            onToggleTray={() => setTrayOpen((open) => !open)}
            onPickImage={sendMedia}
          />
        ) : null}
        {Platform.OS === 'web' ? (
          <textarea
            ref={areaRef}
            id="savigna-message"
            aria-label="Message"
            placeholder={placeholder}
            rows={2}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            style={{
              flex: 1,
              width: '100%',
              minHeight: 44,
              maxHeight: 120,
              borderRadius: 18,
              padding: '10px 14px',
              fontSize: 16,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceSolid,
              color: colors.text,
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <TextInput
            value={text}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            multiline
            blurOnSubmit={false}
            onSubmitEditing={submit}
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.surfaceSolid,
              },
            ]}
            accessibilityLabel="Message"
          />
        )}
        {Platform.OS === 'web' ? (
          <button
            type="button"
            aria-label="Send"
            onClick={submit}
            style={{
              width: 44,
              height: 44,
              minWidth: 44,
              minHeight: 44,
              flexShrink: 0,
              border: 'none',
              borderRadius: 22,
              cursor: 'pointer',
              background: `linear-gradient(90deg, ${pack.tokens.coral}, ${pack.tokens.ember})`,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              padding: 0,
            }}
          >
            ➤
          </button>
        ) : (
          <Pressable
            onPress={submit}
            accessibilityRole="button"
            accessibilityLabel="Send"
            hitSlop={8}
            style={[styles.sendHit, !canSend && { opacity: 0.4 }]}
          >
            {sendControl}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function healthCheck(health: AiHealthReport | null, id: string) {
  return health?.checks.find((item) => item.id === id) ?? null;
}

function StatusDot({ ok, colors }: { ok: boolean; colors: ThemeColors }) {
  return (
    <View
      style={[
        styles.statusDot,
        { backgroundColor: ok ? colors.online : 'transparent', borderColor: ok ? colors.online : colors.danger },
      ]}
    />
  );
}

/** Status + select in one tile. Infra probes (server / WebGPU) stay as a compact strip. */
export function AiConnectionPanel({
  health,
  checking,
  onRetry,
  colors,
  aiBackend,
  onAiBackendChange,
}: {
  health: AiHealthReport | null;
  checking: boolean;
  onRetry: () => void;
  colors: ThemeColors;
  aiBackend: AiBackendId;
  onAiBackendChange: (id: AiBackendId) => void;
}) {
  const server = healthCheck(health, 'server');
  const webgpu = healthCheck(health, 'webgpu');
  const [hoveredDisabledDetail, setHoveredDisabledDetail] = useState<string | null>(null);
  const isWeb = Platform.OS === 'web';
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[styles.settingsLabel, { color: colors.textMuted, paddingHorizontal: 0 }]}>
          AI backend
        </Text>
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry connection tests">
          <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
            {checking ? 'Testing…' : 'Retry'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.infraRow}>
        {server ? (
          <View style={styles.infraItem}>
            <StatusDot ok={server.ok} colors={colors} />
            <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
              Server · {server.detail}
            </Text>
          </View>
        ) : null}
        {webgpu ? (
          <View style={styles.infraItem}>
            <StatusDot ok={webgpu.ok} colors={colors} />
            <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
              WebGPU · {webgpu.detail}
            </Text>
          </View>
        ) : null}
      </View>

      {checking && !health ? (
        <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 12 }}>
          Checking server and AI backends…
        </Text>
      ) : (
        <View style={styles.backendGrid}>
          {AI_BACKENDS.map((item) => {
            const probe = healthCheck(health, item.id);
            const online = isBackendSelectable(item.id, health);
            const selected = aiBackend === item.id;
            const detail = probe?.detail ?? (online ? item.hint : 'No connection');
            const shortDetail = detail.split(' · ')[0];
            const webHoverProps =
              isWeb
                ? ({
                    onMouseEnter: () => {
                      // Only show the "disabled" reason when the backend is actually off.
                      setHoveredDisabledDetail(online ? null : detail);
                    },
                    onMouseLeave: () => setHoveredDisabledDetail(null),
                  } as any)
                : {};
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  if (!online) return;
                  onAiBackendChange(item.id);
                }}
                {...webHoverProps}
                style={[
                  styles.backendTile,
                  {
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accentSoft : colors.background,
                    opacity: online ? 1 : 0.45,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !online }}
                accessibilityLabel={`${item.label}, ${online ? 'online' : 'offline'}, ${detail}`}
              >
                <View style={styles.backendTileHead}>
                  <StatusDot ok={Boolean(probe?.ok) || item.id === 'demo'} colors={colors} />
                  <Text
                    style={{ color: colors.text, fontWeight: selected ? '800' : '600', fontSize: 14, flex: 1 }}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  {selected ? (
                    <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 13 }}>On</Text>
                  ) : null}
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 11, lineHeight: 15 }} numberOfLines={1}>
                  {shortDetail}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {isWeb && !checking && hoveredDisabledDetail ? (
        <Text style={{ color: colors.danger, marginTop: 8, fontSize: 12, lineHeight: 16 }}>
          {hoveredDisabledDetail}
        </Text>
      ) : null}

      <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 12, lineHeight: 16 }}>
        fourSome uses on-prem first, then OpenAI. Pick On-prem or OpenAI to force one.
      </Text>
    </View>
  );
}

type LangPickerKind = 'native' | 'learning' | 'partner' | null;

function ChatLangPickers({
  picker,
  nativeLang,
  learningLang,
  partnerLearningLang,
  colors,
  onNativeLangChange,
  onLearningLangChange,
  onPartnerLearningLangChange,
  onClose,
}: {
  picker: LangPickerKind;
  nativeLang: string;
  learningLang: string;
  partnerLearningLang: string;
  colors: ThemeColors;
  onNativeLangChange: (code: string) => void;
  onLearningLangChange: (code: string) => void;
  onPartnerLearningLangChange: (code: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <LangPickerModal
        visible={picker === 'native'}
        title="I speak"
        selected={nativeLang}
        exclude={learningLang}
        colors={colors}
        onSelect={onNativeLangChange}
        onClose={onClose}
      />
      <LangPickerModal
        visible={picker === 'learning'}
        title="I'm learning"
        selected={learningLang}
        exclude={nativeLang}
        colors={colors}
        onSelect={onLearningLangChange}
        onClose={onClose}
      />
      <LangPickerModal
        visible={picker === 'partner'}
        title="They read (partner learning language)"
        selected={partnerLearningLang}
        colors={colors}
        onSelect={onPartnerLearningLangChange}
        onClose={onClose}
      />
    </>
  );
}

export type ThreadChatSettingsProps = {
  colors: ThemeColors;
  mode: 'lines' | 'birkenbihl';
  onModeChange: (mode: 'lines' | 'birkenbihl') => void;
  botReplies: boolean;
  onBotRepliesChange: (on: boolean) => void;
  nativeLang: string;
  learningLang: string;
  partnerLearningLang: string;
  onNativeLangChange: (code: string) => void;
  onLearningLangChange: (code: string) => void;
  onPartnerLearningLangChange: (code: string) => void;
  isBotChat: boolean;
  storedInCloud?: boolean;
  aiBackend: AiBackendId;
  onAiBackendChange: (id: AiBackendId) => void;
  health: AiHealthReport | null;
  onRecalculateBirkenbihl?: () => void;
  birkenbihlBusy?: boolean;
};

/** Compact this-chat controls for L/XL thread headers — not the app Settings page. */
export function ThreadInlineChatSettings({
  colors,
  mode,
  onModeChange,
  botReplies,
  onBotRepliesChange,
  nativeLang,
  learningLang,
  partnerLearningLang,
  onNativeLangChange,
  onLearningLangChange,
  onPartnerLearningLangChange,
  isBotChat,
  storedInCloud = false,
  aiBackend,
  onAiBackendChange,
  health,
  onRecalculateBirkenbihl,
  birkenbihlBusy,
}: ThreadChatSettingsProps) {
  const [picker, setPicker] = useState<LangPickerKind>(null);
  const [hoveredDisabledDetail, setHoveredDisabledDetail] = useState<string | null>(null);
  const isWeb = Platform.OS === 'web';
  const chipBorder = (active: boolean) => ({
    borderColor: active ? colors.accent : colors.border,
    backgroundColor: active ? colors.accentSoft : colors.background,
  });
  return (
    <View
      style={[inlineStyles.bar, { backgroundColor: colors.headerGlass, borderBottomColor: colors.border }]}
      accessibilityLabel={
        isBotChat
          ? 'This chat: this device only'
          : storedInCloud
            ? 'This chat: saved in the cloud'
            : 'This chat: connection and languages'
      }
    >
      <Text style={[inlineStyles.kicker, { color: colors.textMuted }]}>
        This chat{isBotChat ? ' · This device' : storedInCloud ? ' · Cloud' : ''}
      </Text>
      <View style={inlineStyles.row}>
        {AI_BACKENDS.map((item) => {
          const probe = healthCheck(health, item.id);
          const online = isBackendSelectable(item.id, health);
          const selected = aiBackend === item.id;
          const detail = probe?.detail ?? (online ? item.hint : 'No connection');
          const webHoverProps =
            isWeb
              ? ({
                  onMouseEnter: () => setHoveredDisabledDetail(online ? null : detail),
                  onMouseLeave: () => setHoveredDisabledDetail(null),
                } as any)
              : {};
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                if (!online) return;
                onAiBackendChange(item.id);
              }}
              {...webHoverProps}
              style={[inlineStyles.chip, chipBorder(selected), { opacity: online ? 1 : 0.45 }]}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: !online }}
              accessibilityLabel={`${item.label} backend, ${online ? 'online' : 'offline'}, ${detail}`}
            >
              <StatusDot ok={Boolean(probe?.ok) || item.id === 'demo'} colors={colors} />
              <Text
                style={{ color: colors.text, fontWeight: selected ? '800' : '600', fontSize: 12 }}
                numberOfLines={1}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {isWeb && hoveredDisabledDetail ? (
        <Text
          style={{
            color: colors.danger,
            fontSize: 11,
            lineHeight: 14,
            marginTop: 4,
            paddingHorizontal: 2,
          }}
          numberOfLines={3}
        >
          {hoveredDisabledDetail}
        </Text>
      ) : null}
      <View style={inlineStyles.row}>
        <Pressable
          onPress={() => setPicker('native')}
          style={[inlineStyles.chip, chipBorder(false)]}
          accessibilityRole="button"
          accessibilityLabel={`I speak ${languageLabel(nativeLang)}`}
        >
          <Text style={[inlineStyles.chipHint, { color: colors.textMuted }]}>I speak</Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            {nativeLang.toUpperCase()}
          </Text>
        </Pressable>
        <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
        <Pressable
          onPress={() => setPicker('learning')}
          style={[inlineStyles.chip, chipBorder(false)]}
          accessibilityRole="button"
          accessibilityLabel={`Learning ${languageLabel(learningLang)}`}
        >
          <Text style={[inlineStyles.chipHint, { color: colors.textMuted }]}>Learning</Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            {learningLang.toUpperCase()}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setPicker('partner')}
          style={[inlineStyles.chip, chipBorder(false)]}
          accessibilityRole="button"
          accessibilityLabel={`They read ${languageLabel(partnerLearningLang)}`}
        >
          <Text style={[inlineStyles.chipHint, { color: colors.textMuted }]}>They read</Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            {partnerLearningLang.toUpperCase()}
          </Text>
        </Pressable>
        {isBotChat ? (
          <>
            <View style={[inlineStyles.vrule, { backgroundColor: colors.border }]} />
            <Pressable
              onPress={() => onBotRepliesChange(true)}
              style={[inlineStyles.chip, chipBorder(botReplies)]}
              accessibilityRole="button"
              accessibilityState={{ selected: botReplies }}
              accessibilityLabel="Bot replies on"
            >
              <Text style={{ color: colors.text, fontWeight: botReplies ? '800' : '600', fontSize: 12 }}>
                Bot on
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onBotRepliesChange(false)}
              style={[inlineStyles.chip, chipBorder(!botReplies)]}
              accessibilityRole="button"
              accessibilityState={{ selected: !botReplies }}
              accessibilityLabel="Bot replies off"
            >
              <Text style={{ color: colors.text, fontWeight: !botReplies ? '800' : '600', fontSize: 12 }}>
                Off
              </Text>
            </Pressable>
          </>
        ) : null}
        <View style={[inlineStyles.vrule, { backgroundColor: colors.border }]} />
        <Pressable
          onPress={() => onModeChange('lines')}
          style={[inlineStyles.chip, chipBorder(mode === 'lines')]}
          accessibilityRole="button"
          accessibilityLabel="Standard display mode"
          accessibilityState={{ selected: mode === 'lines' }}
        >
          <Text style={{ color: colors.text, fontWeight: mode === 'lines' ? '800' : '600', fontSize: 12 }}>
            Standard
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onModeChange('birkenbihl')}
          style={[inlineStyles.chip, chipBorder(mode === 'birkenbihl')]}
          accessibilityRole="button"
          accessibilityLabel="Birkenbihl display mode"
          accessibilityState={{ selected: mode === 'birkenbihl' }}
        >
          <Text style={{ color: colors.text, fontWeight: mode === 'birkenbihl' ? '800' : '600', fontSize: 12 }}>
            Birkenbihl
          </Text>
        </Pressable>
        {mode === 'birkenbihl' && onRecalculateBirkenbihl ? (
          <Pressable
            onPress={onRecalculateBirkenbihl}
            disabled={birkenbihlBusy}
            style={[inlineStyles.chip, chipBorder(false), { opacity: birkenbihlBusy ? 0.55 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Recalculate Birkenbihl"
            accessibilityState={{ disabled: Boolean(birkenbihlBusy), busy: Boolean(birkenbihlBusy) }}
          >
            {birkenbihlBusy ? <ActivityIndicator size="small" color={colors.text} /> : null}
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
              {birkenbihlBusy ? 'Recalculating…' : 'Recalculate Birkenbihl'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ChatLangPickers
        picker={picker}
        nativeLang={nativeLang}
        learningLang={learningLang}
        partnerLearningLang={partnerLearningLang}
        colors={colors}
        onNativeLangChange={(code) => {
          onNativeLangChange(code);
          setPicker(null);
        }}
        onLearningLangChange={(code) => {
          onLearningLangChange(code);
          setPicker(null);
        }}
        onPartnerLearningLangChange={(code) => {
          onPartnerLearningLangChange(code);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

export function ChatSettingsSheet({
  visible,
  onClose,
  colors,
  mode,
  onModeChange,
  botReplies,
  onBotRepliesChange,
  nativeLang,
  learningLang,
  partnerLearningLang,
  onNativeLangChange,
  onLearningLangChange,
  onPartnerLearningLangChange,
  pipelineLabel,
  isBotChat,
  storedInCloud = false,
  aiBackend,
  onAiBackendChange,
  health,
  healthChecking,
  onRetryHealth,
  onRecalculateBirkenbihl,
  birkenbihlBusy,
}: {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  mode: 'lines' | 'birkenbihl';
  onModeChange: (mode: 'lines' | 'birkenbihl') => void;
  botReplies: boolean;
  onBotRepliesChange: (on: boolean) => void;
  nativeLang: string;
  learningLang: string;
  partnerLearningLang: string;
  onNativeLangChange: (code: string) => void;
  onLearningLangChange: (code: string) => void;
  onPartnerLearningLangChange: (code: string) => void;
  pipelineLabel: string;
  isBotChat: boolean;
  storedInCloud?: boolean;
  aiBackend: AiBackendId;
  onAiBackendChange: (id: AiBackendId) => void;
  health: AiHealthReport | null;
  healthChecking: boolean;
  onRetryHealth: () => void;
  onRecalculateBirkenbihl?: () => void;
  birkenbihlBusy?: boolean;
}) {
  const [picker, setPicker] = useState<'native' | 'learning' | 'partner' | null>(null);
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pickerStyles.backdrop} onPress={onClose} accessibilityLabel="Close settings">
        <Pressable
          style={[pickerStyles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation?.()}
        >
          <Text style={[pickerStyles.sheetTitle, { color: colors.text }]}>Chat settings</Text>
          <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: colors.textMuted, paddingHorizontal: 16, marginBottom: 12, fontSize: 13 }}>
            {isBotChat
              ? `${pipelineLabel} · Bot stays on this device`
              : storedInCloud
                ? `${pipelineLabel} · Saved in the cloud`
                : pipelineLabel}
          </Text>

          <View style={{ paddingHorizontal: 16 }}>
            <AiConnectionPanel
              health={health}
              checking={healthChecking}
              onRetry={onRetryHealth}
              colors={colors}
              aiBackend={aiBackend}
              onAiBackendChange={onAiBackendChange}
            />
          </View>

          <Text style={[styles.settingsLabel, { color: colors.textMuted, paddingHorizontal: 16, marginTop: 12 }]}>
            Languages
          </Text>
          <View style={[styles.modeRow, { paddingHorizontal: 16, marginTop: 8 }]}>
            <Pressable
              onPress={() => setPicker('native')}
              style={[styles.selectChip, { borderColor: colors.border, backgroundColor: colors.background }]}
              accessibilityRole="button"
              accessibilityLabel={`I speak ${languageLabel(nativeLang)}`}
            >
              <Text style={[styles.selectHint, { color: colors.textMuted }]}>I speak</Text>
              <Text style={[styles.selectValue, { color: colors.text }]}>{languageLabel(nativeLang)}</Text>
            </Pressable>
            <Pressable
              onPress={() => setPicker('learning')}
              style={[styles.selectChip, { borderColor: colors.border, backgroundColor: colors.background }]}
              accessibilityRole="button"
              accessibilityLabel={`Learning ${languageLabel(learningLang)}`}
            >
              <Text style={[styles.selectHint, { color: colors.textMuted }]}>Learning</Text>
              <Text style={[styles.selectValue, { color: colors.text }]}>{languageLabel(learningLang)}</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => setPicker('partner')}
            style={[
              styles.selectChip,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
                marginHorizontal: 16,
                marginTop: 8,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Partner reads ${languageLabel(partnerLearningLang)}`}
          >
            <Text style={[styles.selectHint, { color: colors.textMuted }]}>They read</Text>
            <Text style={[styles.selectValue, { color: colors.text }]}>
              {languageLabel(partnerLearningLang)}
            </Text>
          </Pressable>

          <Text
            style={[styles.settingsLabel, { color: colors.textMuted, paddingHorizontal: 16, marginTop: 16 }]}
          >
            Display
          </Text>
          <View style={[styles.modeRow, { paddingHorizontal: 16, marginTop: 8 }]}>
            <Pressable
              onPress={() => onModeChange('lines')}
              style={[styles.modeChip, mode === 'lines' && { backgroundColor: colors.accentSoft }]}
              accessibilityRole="button"
              accessibilityLabel="Standard display mode"
              accessibilityState={{ selected: mode === 'lines' }}
            >
              <Text style={{ color: colors.text, fontWeight: mode === 'lines' ? '700' : '500' }}>Standard</Text>
            </Pressable>
            <Pressable
              onPress={() => onModeChange('birkenbihl')}
              style={[styles.modeChip, mode === 'birkenbihl' && { backgroundColor: colors.accentSoft }]}
              accessibilityRole="button"
              accessibilityLabel="Birkenbihl display mode"
              accessibilityState={{ selected: mode === 'birkenbihl' }}
            >
              <Text style={{ color: colors.text, fontWeight: mode === 'birkenbihl' ? '700' : '500' }}>
                Birkenbihl
              </Text>
            </Pressable>
          </View>
          {mode === 'birkenbihl' && onRecalculateBirkenbihl ? (
            <Pressable
              onPress={onRecalculateBirkenbihl}
              disabled={birkenbihlBusy}
              style={[
                styles.modeChip,
                {
                  marginHorizontal: 16,
                  marginTop: 8,
                  backgroundColor: colors.accentSoft,
                  opacity: birkenbihlBusy ? 0.55 : 1,
                  alignSelf: 'flex-start',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Recalculate Birkenbihl"
              accessibilityState={{ disabled: Boolean(birkenbihlBusy), busy: Boolean(birkenbihlBusy) }}
            >
              {birkenbihlBusy ? <ActivityIndicator size="small" color={colors.text} /> : null}
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {birkenbihlBusy ? 'Recalculating…' : 'Recalculate Birkenbihl'}
              </Text>
            </Pressable>
          ) : null}

          {isBotChat ? (
            <>
              <Text
                style={[styles.settingsLabel, { color: colors.textMuted, paddingHorizontal: 16, marginTop: 16 }]}
              >
                Bot replies
              </Text>
              <View style={[styles.modeRow, { paddingHorizontal: 16, marginTop: 8 }]}>
                <Pressable
                  onPress={() => onBotRepliesChange(true)}
                  style={[styles.modeChip, botReplies && { backgroundColor: colors.accentSoft }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: botReplies }}
                >
                  <Text style={{ color: colors.text, fontWeight: botReplies ? '700' : '500' }}>On</Text>
                </Pressable>
                <Pressable
                  onPress={() => onBotRepliesChange(false)}
                  style={[styles.modeChip, !botReplies && { backgroundColor: colors.accentSoft }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !botReplies }}
                >
                  <Text style={{ color: colors.text, fontWeight: !botReplies ? '700' : '500' }}>Off</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          <Pressable onPress={onClose} style={pickerStyles.cancel} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Done</Text>
          </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>

      <ChatLangPickers
        picker={picker}
        nativeLang={nativeLang}
        learningLang={learningLang}
        partnerLearningLang={partnerLearningLang}
        colors={colors}
        onNativeLangChange={(code) => {
          onNativeLangChange(code);
          setPicker(null);
        }}
        onLearningLangChange={(code) => {
          onLearningLangChange(code);
          setPicker(null);
        }}
        onPartnerLearningLangChange={(code) => {
          onPartnerLearningLangChange(code);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </Modal>
  );
}

export function WordTapToast({
  token,
  colors,
}: {
  token: string | null;
  colors: ThemeColors;
}) {
  if (!token) return null;
  return (
    <View style={[styles.tapToast, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{token}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>Saved to vocab later — Gigolingo seam</Text>
    </View>
  );
}

export function InboxRow({
  title,
  preview,
  time,
  unread,
  muted,
  online,
  isBot,
  photoUrl,
  colors,
  onPress,
}: {
  title: string;
  preview?: string;
  time: string;
  unread: number;
  muted?: boolean;
  online?: boolean;
  isBot?: boolean;
  photoUrl?: string | null;
  colors: ThemeColors;
  onPress: () => void;
}) {
  const titleStyle = useMemo(
    () =>
      [
        styles.inboxTitle,
        { color: colors.text },
        unread > 0 ? styles.inboxTitleUnread : null,
      ] as TextStyle[],
    [colors.text, unread]
  );
  return (
    <Pressable
      onPress={onPress}
      style={[styles.inboxRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}${unread ? `, ${unread} unread` : ''}`}
    >
      <View style={styles.avatarWrap}>
        <PersonAvatar
          size={46}
          name={title}
          photoUrl={photoUrl}
          isBot={isBot}
          online={online}
          showPresence
        />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.inboxTop}>
          <Text style={titleStyle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{time}</Text>
        </View>
        <View style={styles.inboxBottom}>
          <Text style={{ color: colors.textMuted, flex: 1 }} numberOfLines={1}>
            {preview ?? ' '}
          </Text>
          {muted ? <Ionicons name="notifications-off" size={14} color={colors.textMuted} /> : null}
          {unread > 0 ? (
            <View style={[styles.badge, { backgroundColor: colors.unread }]}>
              <Text style={styles.badgeText}>{badgeLabel(unread)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function InboxSkeleton({ colors }: { colors: ThemeColors }) {
  const opacity = useSkeletonPulse();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Loading chats"
      accessibilityState={{ busy: true }}
      style={{ paddingTop: 12 }}
    >
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonInboxRow}>
          <Animated.View
            style={[styles.skeletonAvatar, { backgroundColor: colors.accentSoft, opacity }]}
          />
          <View style={{ flex: 1, gap: 8, justifyContent: 'center' }}>
            <SkeletonBar colors={colors} opacity={opacity} width={i % 2 === 0 ? '44%' : '36%'} height={14} />
            <SkeletonBar colors={colors} opacity={opacity} width={i % 2 === 0 ? '78%' : '62%'} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const THREAD_SKELETON: Array<{ mine: boolean; widths: Array<`${number}%`> }> = [
  { mine: false, widths: ['72%', '54%'] },
  { mine: true, widths: ['48%', '64%', '32%'] },
  { mine: false, widths: ['66%'] },
  { mine: true, widths: ['58%', '40%'] },
  { mine: false, widths: ['70%', '52%', '28%'] },
];

/** Placeholder message lines while cloud hydrate / listMessages is in flight. */
export function ThreadMessageSkeleton({ colors }: { colors: ThemeColors }) {
  const opacity = useSkeletonPulse();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Loading messages"
      accessibilityState={{ busy: true }}
      style={styles.skeletonThread}
    >
      {THREAD_SKELETON.map((row, index) => (
        <View
          key={index}
          style={[styles.skeletonBubbleWrap, { alignItems: row.mine ? 'flex-end' : 'flex-start' }]}
        >
          <View
            style={[
              styles.skeletonBubble,
              {
                backgroundColor: row.mine ? colors.accentSoft : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {row.widths.map((width, line) => (
              <SkeletonBar
                key={line}
                colors={colors}
                opacity={opacity}
                width={width}
                height={line === 0 ? 13 : 11}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function useSkeletonPulse() {
  const opacity = useRef(new Animated.Value(0.42)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.88, duration: 720, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 720, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

function SkeletonBar({
  colors,
  opacity,
  width,
  height,
  color,
}: {
  colors: ThemeColors;
  opacity: Animated.Value;
  width: `${number}%`;
  height: number;
  color?: string;
}) {
  return (
    <Animated.View
      style={{
        height,
        width,
        borderRadius: 6,
        backgroundColor: color ?? colors.textMuted,
        opacity,
      }}
    />
  );
}

function LineBusyBars({ colors, onAccent }: { colors: ThemeColors; onAccent?: boolean }) {
  const opacity = useSkeletonPulse();
  const barColor = onAccent ? 'rgba(255,255,255,0.5)' : colors.textMuted;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Loading translation"
      accessibilityState={{ busy: true }}
      style={styles.lineBusyBars}
    >
      <SkeletonBar colors={colors} opacity={opacity} width="78%" height={11} color={barColor} />
      <SkeletonBar colors={colors} opacity={opacity} width="52%" height={11} color={barColor} />
    </View>
  );
}

function RetryAction({
  tint,
  busy,
  busyLabel,
  idleLabel,
  why,
  onPress,
  accessibilityLabel,
}: {
  tint: string;
  busy: boolean;
  busyLabel: string;
  idleLabel: string;
  why?: string;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: busy || !onPress, busy }}
      style={styles.retryHit}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <Ionicons name="refresh" size={14} color={tint} />
      )}
      <Text style={[styles.retryLabel, { color: tint }]}>{busy ? busyLabel : idleLabel}</Text>
      {why && !busy ? (
        <Text style={[styles.retryWhy, { color: tint }]}>{why}</Text>
      ) : null}
    </Pressable>
  );
}

function BusyHint({ tint, label }: { tint: string; label: string }) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={styles.retryHit}
    >
      <ActivityIndicator size="small" color={tint} />
      <Text style={[styles.retryLabel, { color: tint }]}>{label}</Text>
    </View>
  );
}

export function presenceOpacity(state: 'online' | 'away' | 'offline', stale = false): number {
  if (stale) return 0.55;
  if (state === 'offline') return 0.4;
  return 1;
}

export function announceMessage(input: {
  authorName: string;
  timestamp: string;
  content: string;
  system?: boolean;
}): string {
  if (input.system) return `System. ${input.content}`;
  return `${input.authorName}. ${input.timestamp}. ${input.content}`;
}

/**
 * Post-login empty chats home — brand-led on gradient (fourSome CTA + Gigolingo shell).
 */
export function ChatsEmptyHome({
  colors,
  username,
  identityKind = 'username',
  onCopyUsername,
  onShareInvite,
  onOpenBot,
  onNewChat,
  onSignOut,
  copied,
  vocabRail,
}: {
  colors: ThemeColors;
  username: string;
  identityKind?: 'username' | 'email';
  onCopyUsername: () => void;
  onShareInvite: () => void;
  onOpenBot: () => void;
  onNewChat: () => void;
  onSignOut: () => void;
  copied: boolean;
  vocabRail?: React.ReactNode;
}) {
  return (
    <View style={emptyStyles.root}>
      <View style={emptyStyles.topBar}>
        <Pressable
          onPress={onSignOut}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          style={emptyStyles.plusHit}
        >
          <Ionicons name="log-out-outline" size={24} color={colors.textMuted} />
        </Pressable>
        <Text style={[emptyStyles.brand, { color: colors.text }]} accessibilityRole="header">
          SavignaLearn
        </Text>
        <Pressable
          onPress={onNewChat}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Start new chat"
          style={emptyStyles.plusHit}
        >
          <Ionicons name="add" size={28} color={colors.accent} />
        </Pressable>
      </View>

      <View style={emptyStyles.body}>
        <Text style={[emptyStyles.headline, { color: colors.text }]}>
          Start your first conversation
        </Text>
        <Text style={[emptyStyles.subhead, { color: colors.textMuted }]}>
          {identityKind === 'email'
            ? 'That username is shared — invite with your email, or chat in your languages line by line.'
            : 'Invite a partner with your username — chat in your languages, line by line.'}
        </Text>

        <Text style={[emptyStyles.label, { color: colors.textMuted }]}>
          {identityKind === 'email' ? 'Email' : 'Username'}
        </Text>
        <GlassPanel colors={colors} style={emptyStyles.usernameCard}>
          <Pressable
            onPress={onCopyUsername}
            accessibilityRole="button"
            accessibilityLabel={`${identityKind === 'email' ? 'Email' : 'Username'} ${username}. Tap to copy`}
            style={emptyStyles.usernamePress}
          >
            <Text style={[emptyStyles.username, { color: colors.text }]} numberOfLines={1}>
              {username}
            </Text>
            <View style={[emptyStyles.copyPill, { backgroundColor: colors.accentSoft }]}>
              <Text style={[emptyStyles.copyPillText, { color: colors.accent }]}>
                {copied ? 'Copied' : 'Tap to copy'}
              </Text>
            </View>
          </Pressable>
        </GlassPanel>

        <Pressable
          onPress={onOpenBot}
          accessibilityRole="button"
          accessibilityLabel={`Open ${LEARNING_BOT_DISPLAY_NAME}`}
        >
          <GlassPanel colors={colors} style={emptyStyles.botCard}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[emptyStyles.botTitle, { color: colors.text }]}>{LEARNING_BOT_DISPLAY_NAME}</Text>
              <Text style={[emptyStyles.botPreview, { color: colors.textMuted }]} numberOfLines={2}>
                Practice anytime — I reply in your learning language, line by line.
              </Text>
            </View>
            <View style={emptyStyles.botArt}>
              <SlayGif size={64} />
              <SavignasBoiAvatar size={56} style={emptyStyles.botAvatar} />
            </View>
          </GlassPanel>
        </Pressable>
        {vocabRail ? <View style={emptyStyles.vocabSlot}>{vocabRail}</View> : null}
      </View>

      <View style={emptyStyles.footer}>
        <GradientCta label="Share invite link" onPress={onShareInvite} />
      </View>
    </View>
  );
}

/** Brand-first sign-in: fourSome and/or iDO with the same email. */
export function AuthHero({
  colors,
  onSignIn,
  allowDemo,
  onDemo,
}: {
  colors: ThemeColors;
  onSignIn: (email: string, password: string, keepLoggedIn: boolean) => Promise<void>;
  allowDemo?: boolean;
  onDemo?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepLoggedIn, setKeep] = useState(shouldKeepLoggedIn);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await onSignIn(email.trim(), password, keepLoggedIn);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={emptyStyles.authRoot}>
      <SlayGif size={88} />
      <Text style={[emptyStyles.authBrand, { color: colors.text }]} accessibilityRole="header">
        SavignaLearn
      </Text>
      <Text style={[emptyStyles.authSub, { color: colors.textMuted }]}>
        Sign in with your fourSome or iDO account. Demo iDO: learner@savigna.local / demo.
      </Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        style={[emptyStyles.authInput, { color: colors.text, borderColor: colors.border }]}
        accessibilityLabel="Email"
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        style={[emptyStyles.authInput, { color: colors.text, borderColor: colors.border }]}
        accessibilityLabel="Password"
      />
      <Pressable
        onPress={() => setKeep((value) => !value)}
        style={emptyStyles.keepRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: keepLoggedIn }}
        accessibilityLabel="Keep me logged in"
      >
        <Ionicons
          name={keepLoggedIn ? 'checkbox' : 'square-outline'}
          size={22}
          color={keepLoggedIn ? colors.accent : colors.textMuted}
        />
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>Keep me logged in</Text>
      </Pressable>
      {error ? (
        <Text style={{ color: colors.danger, marginBottom: 12, textAlign: 'center', fontSize: 13 }}>
          {error}
        </Text>
      ) : null}
      <View style={{ width: '100%', maxWidth: 340 }}>
        <GradientCta
          label={busy ? 'Signing in…' : 'Sign in'}
          onPress={() => {
            if (busy || !email || !password) return;
            void submit();
          }}
        />
      </View>
      {allowDemo && onDemo ? (
        <Pressable onPress={onDemo} style={{ marginTop: 16 }} accessibilityRole="button">
          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Continue as demo learner</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const shell = StyleSheet.create({
  flex: { flex: 1 },
  gradient: { flex: 1, width: '100%', height: '100%' },
  glass: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  ctaWrap: { borderRadius: 999, overflow: 'hidden' },
  cta: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  threadHeaderWash: { width: '100%' },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backHit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerTitles: { flex: 1, minWidth: 0 },
  threadTitle: { fontWeight: '700', fontSize: 16 },
});

const emptyStyles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    minHeight: 48,
  },
  brand: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  plusHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  headline: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  subhead: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  label: {
    marginTop: 32,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  usernameCard: { minHeight: 96 },
  usernamePress: {
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  username: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  copyPill: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  copyPillText: { fontSize: 12, fontWeight: '700' },
  botCard: {
    marginTop: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 92,
  },
  botTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  botPreview: { fontSize: 13, lineHeight: 18 },
  botArt: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vocabSlot: { marginTop: 20 },
  footer: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8 },
  authRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  authBrand: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  authSub: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 28,
    maxWidth: 340,
  },
  authInput: {
    width: '100%',
    maxWidth: 340,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 16,
  },
  keepRow: {
    width: '100%',
    maxWidth: 340,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    marginTop: 4,
  },
});

const styles = StyleSheet.create({
  mediaBlock: { gap: 8 },
  linesBlock: { gap: 8 },
  linePair: { gap: 2 },
  learningText: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  nativeText: { fontSize: 13, lineHeight: 18 },
  langTag: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginTop: 2 },
  retryHit: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    paddingVertical: 4,
    minHeight: 32,
  },
  retryLabel: { fontWeight: '800', fontSize: 13 },
  retryWhy: { fontWeight: '600', fontSize: 11, opacity: 0.9 },
  lineBusyBars: { gap: 6, marginTop: 6 },
  interlinearRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  interlinearSegment: { marginRight: 4 },
  bubbleOuter: { maxWidth: '88%', marginVertical: 5 },
  bubble: {
    maxWidth: '88%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginVertical: 4,
  },
  bubbleMine: { maxWidth: '100%', borderBottomRightRadius: 6 },
  tombstoneText: { fontSize: 14, fontStyle: 'italic', fontWeight: '600' },
  bubbleFailed: { borderWidth: 1, borderColor: 'rgba(255,220,200,0.45)' },
  failCopy: { color: '#FFE8E0', marginTop: 8, fontWeight: '700', fontSize: 13 },
  bubbleOther: {
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: 6,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  aiBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiLabel: { fontSize: 12, fontWeight: '700' },
  systemText: { textAlign: 'center', fontSize: 12, marginVertical: 8 },
  receipt: { alignSelf: 'flex-end', fontSize: 11, marginTop: 4 },
  composerWrap: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8, zIndex: 2 },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  infraRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, alignItems: 'center' },
  infraItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '100%' },
  backendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  backendTile: {
    flexGrow: 1,
    flexBasis: '47%',
    maxWidth: '48.5%',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 64,
    gap: 4,
  },
  backendTileHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  settingsBlock: { gap: 4 },
  settingsLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  selectChip: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  selectHint: { fontSize: 11, fontWeight: '600' },
  selectValue: { flex: 1, fontSize: 14, fontWeight: '700' },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendHit: { borderRadius: 22, overflow: 'hidden', width: 44, height: 44 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginVertical: 5,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 76,
  },
  avatarWrap: { width: 46, height: 46 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presence: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  inboxTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  inboxBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  inboxTitle: { fontSize: 16, flex: 1 },
  inboxTitleUnread: { fontWeight: '700' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tapToast: {
    position: 'absolute',
    bottom: 92,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  skeletonInboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  skeletonAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  skeletonThread: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 14,
  },
  skeletonBubbleWrap: {
    width: '100%',
  },
  skeletonBubble: {
    maxWidth: '78%',
    minWidth: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});

const inlineStyles = StyleSheet.create({
  bar: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingLeft: 2,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 32,
  },
  chipHint: { fontSize: 10, fontWeight: '600' },
  vrule: { width: StyleSheet.hairlineWidth, height: 18, marginHorizontal: 2 },
});

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 10, 8, 0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
});
