/**
 * An open conversation: header, message list, composer and the sheets that hang off them.
 * All behaviour lives in `useThreadController`; this file only lays it out.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  canDeleteForEveryone,
  imageUrlsOf,
  isDeletedForEveryone,
  chatDayLabel,
  isLearningBotConversation,
  LEARNING_BOT_USER_ID,
  mediaKindOf,
  messageClockTime,
  renderViewpoint,
  sameChatDay,
  shouldTranslateMessage,
  translationMismatch,
  type SourceMessage,
} from '@/domain';
import { threadChromeTitle } from '@/adapters/friends';
import { chatPersistenceUserId, isChatSelf } from '@/adapters/identity';
import { profileHref, routeParam } from '@/adapters/postLogin';
import { useColorScheme } from '@/components/useColorScheme';
import type { ThemeColors } from '@/constants/Colors';
import { useDesktopShell, useWideChatChrome } from '@/features/shell/AppShell';
import { useInboxQuery } from '@/features/query/useChatQueries';
import { useVocabCardFromTap } from '@/features/vocabulary/CreateVocabCardModal';
import { useServices } from './AppProviders';
import { ChatSettingsSheet, ThreadInlineChatSettings } from './ChatSettings';
import { Composer } from './Composer';
import { DaySeparator, MessageBubble } from './MessageBubble';
import { GradientScreen, ThreadChromeHeader, ThreadMessageSkeleton, useThemeColors } from './chatUi';
import { useThreadController } from './useThreadController';

export function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const conversationId = routeParam(id, '');
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const router = useRouter();
  const desktop = useDesktopShell();
  const wideChrome = useWideChatChrome();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inboxQuery = useInboxQuery();
  const { tokenizer, setAiBackend, health, healthChecking, refreshHealth, vocabularyCards, learningItems } =
    useServices();
  const thread = useThreadController(conversationId);
  const { wordTap, modal: vocabModal } = useVocabCardFromTap({
    userId: thread.user ? chatPersistenceUserId(thread.user) : undefined,
    cards: vocabularyCards,
    items: learningItems,
    colors,
  });

  // Wide layouts show the settings inline, so a sheet left open on a phone must not linger.
  useEffect(() => {
    if (wideChrome) setSettingsOpen(false);
  }, [wideChrome]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const chatSettings = {
    colors,
    mode: thread.mode,
    onModeChange: thread.setMode,
    botReplies: thread.botReplies,
    onBotRepliesChange: thread.setBotReplies,
    nativeLang: thread.nativeLang,
    learningLang: thread.learningLang,
    partnerLearningLang: thread.partnerLearningLang,
    onNativeLangChange: thread.persistNative,
    onLearningLangChange: thread.persistLearning,
    onPartnerLearningLangChange: thread.persistPartner,
    isBotChat: thread.isBotChat,
    storedInCloud: !thread.isBotChat,
    aiBackend: thread.aiBackend,
    onAiBackendChange: setAiBackend,
    health,
    onRecalculateBirkenbihl: () => void thread.runBirkenbihlRecalc(thread.messages, false),
    birkenbihlBusy: thread.birkenBusy,
  };

  return (
    <GradientScreen scheme={scheme} edges={['top', 'left', 'right']}>
      <ThreadChromeHeader
        title={threadChromeTitle({
          conversation: thread.conversation,
          inbox: inboxQuery.data,
          conversationId,
          viewerIds: thread.selfIds,
        })}
        subtitle={thread.fetchingThread ? undefined : thread.presenceLabel || undefined}
        onBack={desktop ? undefined : goBack}
        leadingIcon="chevron-back"
        leadingLabel="Back to chats"
        onOpenSettings={wideChrome ? undefined : () => setSettingsOpen(true)}
        inlineSettings={wideChrome ? <ThreadInlineChatSettings {...chatSettings} /> : undefined}
        colors={colors}
        scheme={scheme}
        isBot={Boolean(thread.headerConversation && isLearningBotConversation(thread.headerConversation))}
        photoUrl={thread.headerConversation ? thread.partnerCard?.photoUrl : undefined}
        onOpenProfile={
          thread.partnerId ? () => router.push(profileHref(thread.partnerId!, conversationId)) : undefined
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <View style={styles.flex}>
          {thread.fetchingThread ? (
            <ThreadMessageSkeleton colors={colors} />
          ) : (
            <MessageList
              colors={colors}
              thread={thread}
              conversationId={conversationId}
              tokenizer={tokenizer}
              wordTap={wordTap}
            />
          )}
        </View>
        {thread.sendError ? (
          <Text style={[styles.sendError, { color: colors.danger }]} accessibilityLiveRegion="polite">
            {thread.sendError}
          </Text>
        ) : null}
        <Composer
          colors={colors}
          onSend={(text) => void thread.send({ type: 'text', text })}
          onSendImage={(media) => void thread.send({ type: 'image', media })}
          replyPreview={thread.replyTo?.sourceText}
          onCancelReply={() => thread.setReplyTo(null)}
          nativeLang={thread.nativeLang}
          learningLang={thread.learningLang}
        />
      </KeyboardAvoidingView>
      {vocabModal}
      <ChatSettingsSheet
        visible={settingsOpen && !wideChrome}
        onClose={() => setSettingsOpen(false)}
        {...chatSettings}
        pipelineLabel={thread.pipelineLabel}
        healthChecking={healthChecking}
        onRetryHealth={refreshHealth}
      />
      <MessageDeleteSheet
        visible={Boolean(thread.deleteTarget)}
        colors={colors}
        canDeleteForEveryone={Boolean(
          thread.deleteTarget && canDeleteForEveryone(thread.deleteTarget, thread.selfIds)
        )}
        onDeleteForMe={() => void thread.removeMessage('me')}
        onDeleteForEveryone={() => void thread.removeMessage('everyone')}
        onClose={() => thread.setDeleteTarget(null)}
      />
    </GradientScreen>
  );
}

type MessageListProps = {
  colors: ThemeColors;
  thread: ReturnType<typeof useThreadController>;
  conversationId: string;
  tokenizer: ReturnType<typeof useServices>['tokenizer'];
  wordTap: React.ComponentProps<typeof MessageBubble>['wordTap'];
};

function MessageList({ colors, thread, conversationId, tokenizer, wordTap }: MessageListProps) {
  const listRef = useRef<FlatList<SourceMessage>>(null);
  const { visibleMessages, translations, mode, viewpoint, nativeLang, learningLang, user } = thread;

  useEffect(() => {
    if (visibleMessages.length === 0) return;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [visibleMessages]);

  const renderMessage = useCallback(
    ({ item, index }: { item: SourceMessage; index: number }) => {
      const previous = visibleMessages[index - 1];
      const newDay = !previous || !sameChatDay(previous.createdAt, item.createdAt);
      const groupStart = newDay || previous.authorId !== item.authorId;
      const mine = isChatSelf(user, item.authorId);
      const fromBot = item.authorId === LEARNING_BOT_USER_ID || item.kind === 'ai';
      const deleted = isDeletedForEveryone(item);
      // The bubble is rendered from the viewer's side: my text is in my native language,
      // the Bot's is in the language I am learning.
      const itemForView = mine
        ? { ...item, sourceLang: nativeLang }
        : fromBot
          ? { ...item, sourceLang: learningLang }
          : item;
      const rows = translations[item.id] ?? [];
      const lines = renderViewpoint(itemForView, rows, viewpoint, { own: mine });
      const mismatch = translationMismatch({ message: itemForView, translations: rows, viewpoint });
      const canRetryTranslation =
        !deleted &&
        mismatch &&
        item.receipt !== 'failed' &&
        shouldTranslateMessage(item) &&
        mediaKindOf(item) !== 'sticker';
      const bubble = (
        <MessageBubble
          mine={mine}
          kind={fromBot ? 'ai' : item.kind}
          lines={deleted ? [] : lines}
          mode={mode}
          language={itemForView.sourceLang}
          tokenizer={tokenizer}
          wordTap={wordTap}
          source={{ conversationId, messageId: item.id }}
          colors={colors}
          receipt={item.receipt}
          failed={item.receipt === 'failed'}
          errorCopy={item.receipt === 'failed' ? (thread.sendError ?? undefined) : undefined}
          streaming={thread.streamingId === item.id}
          nativeLang={nativeLang}
          learningLang={learningLang}
          imageUrls={deleted ? [] : imageUrlsOf(item)}
          mediaKind={deleted ? undefined : mediaKindOf(item)}
          deleted={deleted}
          onRequestDelete={() => thread.setDeleteTarget(item)}
          onRetry={() => void thread.send({ type: 'retry', message: item })}
          onRetryTranslation={
            canRetryTranslation ? () => void thread.retryTranslation(item, mismatch) : undefined
          }
          translationRetryReason={canRetryTranslation ? mismatch : null}
          translationRetryBusy={thread.translationRetryIds.includes(item.id)}
          translating={thread.translatingIds.includes(item.id)}
          onRetryBirkenbihl={
            mode === 'birkenbihl' && shouldTranslateMessage(item)
              ? () => void thread.runBirkenbihlRecalc([item], false)
              : undefined
          }
          birkenbihlBusy={thread.birkenRetryIds.includes(item.id)}
          time={messageClockTime(item.createdAt)}
          groupStart={groupStart}
        />
      );
      if (!newDay) return bubble;
      return (
        <>
          <DaySeparator label={chatDayLabel(item.createdAt)} colors={colors} />
          {bubble}
        </>
      );
    },
    [
      thread,
      user,
      visibleMessages,
      translations,
      mode,
      viewpoint,
      nativeLang,
      learningLang,
      tokenizer,
      wordTap,
      colors,
      conversationId,
    ]
  );

  return (
    <FlatList
      ref={listRef}
      data={visibleMessages}
      // Anything the row depends on besides `item` must be listed so FlatList re-renders it.
      extraData={thread}
      keyExtractor={(item) => item.id}
      style={styles.flex}
      initialNumToRender={Math.max(visibleMessages.length, 32)}
      windowSize={21}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      contentContainerStyle={styles.listContent}
      renderItem={renderMessage}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 8, flexGrow: 1 },
  sendError: { paddingHorizontal: 16, paddingBottom: 6, fontSize: 13 },
});

/** "Delete for me" hides the bubble on this account; "for everyone" tombstones it for both people. */
export function MessageDeleteSheet({
  visible,
  colors,
  canDeleteForEveryone,
  onDeleteForMe,
  onDeleteForEveryone,
  onClose,
}: {
  visible: boolean;
  colors: ThemeColors;
  canDeleteForEveryone: boolean;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={sheetStyles.backdrop} onPress={onClose} accessibilityLabel="Close delete menu">
        <Pressable
          style={[sheetStyles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
          onPress={(event) => event.stopPropagation?.()}
        >
          <Text style={[sheetStyles.title, { color: colors.text }]}>Delete message</Text>
          <Text style={[sheetStyles.hint, { color: colors.textMuted }]}>
            Hide this bubble on your account, or remove it for both people in the chat.
          </Text>
          <Pressable
            onPress={onDeleteForMe}
            accessibilityRole="button"
            accessibilityLabel="Delete for me"
            style={sheetStyles.option}
          >
            <Text style={[sheetStyles.optionLabel, { color: colors.text }]}>Delete for me</Text>
          </Pressable>
          {canDeleteForEveryone ? (
            <Pressable
              onPress={onDeleteForEveryone}
              accessibilityRole="button"
              accessibilityLabel="Delete for everyone"
              style={sheetStyles.option}
            >
              <Text style={[sheetStyles.optionLabel, { color: colors.danger }]}>Delete for everyone</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" style={sheetStyles.cancel}>
            <Text style={{ color: colors.textMuted, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
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
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    paddingHorizontal: 16,
    marginBottom: 8,
    lineHeight: 18,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
});
