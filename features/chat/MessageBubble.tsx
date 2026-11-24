/**
 * One chat message: line-by-line / interlinear / Birkenbihl rendering, receipts, retry and
 * translation-busy states, media, and the long-press delete affordance.
 */

import React, { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  DELETED_FOR_EVERYONE_COPY,
  hasInterlinearFormat,
  joinOriginalsFromSelection,
  LEARNING_BOT_DISPLAY_NAME,
  parseInterlinear,
  receiptMark,
} from '@/domain';
import type { DisplayLine, ReceiptStatus, TranslationMismatchReason, MessageMediaKind } from '@/domain/chat';
import { translationRetryWhy } from '@/domain/chat';
import type { LearningSource } from '@/domain/learning';
import type { TokenizerPort, WordTapPort } from '@/ports/ports';
import { type ThemeColors } from '@/constants/Colors';
import { useAppearance } from '@/features/shell/AppearanceProvider';
import { TappableSentence, useWebClipboardJoin } from './TappableSentence';
import { SavignasBoiAvatar } from './avatars';
import { SkeletonBar, useSkeletonPulse } from './chatUi';
import { mediaImageSource } from './stickerAssets';

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
  time,
  groupStart = true,
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
  /** Clock time shown inside the bubble, bottom right. */
  time?: string;
  /** First bubble of a run from the same sender: more room above, and the "tail" corner. */
  groupStart?: boolean;
}) {
  const { pack } = useAppearance();
  const spacing = { marginTop: groupStart ? 8 : 2 };
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
        style={[styles.bubbleOuter, { alignSelf }, spacing]}
        canDelete={Boolean(onRequestDelete)}
        gestureProps={gestureProps}
      >
        <LinearGradient
          colors={failed ? [pack.tokens.wine, pack.tokens.failedDeep] : [...pack.gradients.bubbleOut]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.bubble,
            styles.bubbleMine,
            groupStart && styles.tailMine,
            failed && styles.bubbleFailed,
          ]}
        >
          {inner}
          <BubbleMeta
            time={time}
            glyph={receipt && !failed && !deleted && !sendBusy && !translating ? receiptGlyph(receipt) : undefined}
            glyphLabel={receipt}
            color="rgba(255,255,255,0.78)"
          />
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
        groupStart && styles.tailOther,
        { backgroundColor: bg, alignSelf, borderColor: colors.border },
        spacing,
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
      <BubbleMeta time={time} color={colors.textMuted} />
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

/** Time and delivery ticks, tucked into the bubble's bottom-right corner like WhatsApp. */
function BubbleMeta({
  time,
  glyph,
  glyphLabel,
  color,
}: {
  time?: string;
  glyph?: string;
  glyphLabel?: string;
  color: string;
}) {
  if (!time && !glyph) return null;
  return (
    <View style={styles.meta}>
      {time ? <Text style={[styles.metaText, { color }]}>{time}</Text> : null}
      {glyph ? (
        <Text style={[styles.metaText, { color }]} accessibilityLabel={glyphLabel}>
          {glyph}
        </Text>
      ) : null}
    </View>
  );
}

/** Centered pill between days of a thread ("Today", "Yesterday", "Friday"…). */
export function DaySeparator({ label, colors }: { label: string; colors: ThemeColors }) {
  return (
    <View style={styles.daySeparator} accessibilityRole="header">
      <Text
        style={[
          styles.dayLabel,
          { color: colors.textMuted, backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {label}
      </Text>
    </View>
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


export function ChatMediaImage({
  url,
  sticker,
  accessibilityLabel,
}: {
  url: string;
  sticker?: boolean;
  accessibilityLabel?: string;
}) {
  const size = sticker ? 136 : 240;
  return (
    <Image
      source={mediaImageSource(url)}
      accessibilityLabel={accessibilityLabel ?? (sticker ? 'Sticker' : 'Photo')}
      style={{
        width: size,
        height: size,
        borderRadius: sticker ? 18 : 12,
        backgroundColor: 'rgba(0,0,0,0.08)',
      }}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  mediaBlock: { gap: 8 },
  linesBlock: { gap: 6 },
  linePair: { gap: 1 },
  learningText: { fontSize: 16, fontWeight: '500', lineHeight: 21 },
  nativeText: { fontSize: 13.5, fontWeight: '400', lineHeight: 18 },
  langTag: { fontSize: 9.5, fontWeight: '600', letterSpacing: 0.5, opacity: 0.8 },
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
  bubbleOuter: { maxWidth: '82%' },
  bubble: {
    maxWidth: '82%',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 5,
  },
  bubbleMine: { maxWidth: '100%' },
  // The "tail": the first bubble of a run squares off the corner nearest the sender.
  tailMine: { borderTopRightRadius: 2 },
  tailOther: { borderTopLeftRadius: 2 },
  tombstoneText: { fontSize: 14, fontStyle: 'italic', fontWeight: '600' },
  bubbleFailed: { borderWidth: 1, borderColor: 'rgba(255,220,200,0.45)' },
  bubbleOther: { borderWidth: StyleSheet.hairlineWidth },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  aiLabel: { fontSize: 12, fontWeight: '700' },
  systemText: { textAlign: 'center', fontSize: 12, marginVertical: 8 },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { fontSize: 11, lineHeight: 14 },
  daySeparator: { alignItems: 'center', marginTop: 14, marginBottom: 6 },
  dayLabel: {
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
