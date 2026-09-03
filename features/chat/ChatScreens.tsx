/**
 * Inbox + thread screens — Gigolingo gradient shell + fourSome ember UI.
 */

import { router, useLocalSearchParams, useRouter } from 'expo-router';
import { learningBotHref, routeParam } from '@/adapters/postLogin';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  createLearnerViewpoint,
  isLearningBotConversation,
  LEARNING_BOT_DISPLAY_NAME,
  LEARNING_BOT_USER_ID,
  otherParticipantId,
  renderViewpoint,
  sourceMessageFromText,
  toTranslationMode,
  type AsymmetricLanguageContext,
  type Conversation,
  type DisplayMode,
  type LineTranslation,
  type SourceMessage,
} from '@/domain';
import { ensureLearningBotChat, labelForAiBackend, ResilientChatCompletionAdapter } from '@/adapters/chat';
import { usernameFromUser } from '@/adapters/friends';
import { processOutgoingTranslation, completeBilingualBotReply } from '@/adapters/translation';
import type { WordTapPort } from '@/ports/ports';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState, useServices } from './AppProviders';
import { useAppShell, useWideChatChrome } from '@/features/shell/AppShell';
import {
  ChatSettingsSheet,
  ChatsEmptyHome,
  Composer,
  GradientScreen,
  InboxRow,
  SavignasBoiAvatar,
  SlayGif,
  InboxSkeleton,
  MessageBubble,
  ThreadChromeHeader,
  ThreadInlineChatSettings,
  useThemeColors,
  WordTapToast,
} from './chatUi';

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(delta / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function newMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Keep FlatList keys unique when merging optimistic + subscribed repo snapshots. */
function upsertMessages(prev: SourceMessage[], ...incoming: SourceMessage[]): SourceMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function InboxScreen() {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { desktop } = useAppShell();
  const { chat, auth } = useServices();
  const { user, ready } = useAuthState();
  const nav = useRouter();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const refresh = useCallback(async () => {
    if (!user) return;
    await ensureLearningBotChat(chat, user.id);
    const list = await chat.listConversations(user.id);
    setItems(list);
    setLoading(false);
  }, [chat, user]);

  useEffect(() => {
    if (!ready || !user) return;
    void refresh();
  }, [ready, user, refresh]);

  const filtered = useMemo(() => {
    if (!debounced) return items;
    return items.filter(
      (c) =>
        (c.title ?? '').toLowerCase().includes(debounced) ||
        (c.lastMessagePreview ?? '').toLowerCase().includes(debounced)
    );
  }, [debounced, items]);

  const username = user ? usernameFromUser(user) : 'SavignaLearner';
  const inviteUrl = `https://savignalearn.app/u/${encodeURIComponent(username)}`;

  const copyUsername = async () => {
    await Clipboard.setStringAsync(username);
    setCopied(true);
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setTimeout(() => setCopied(false), 1600);
  };

  const shareInvite = async () => {
    await Share.share({
      message: `Practice languages with me on SavignaLearn — ${inviteUrl}`,
      url: inviteUrl,
    });
  };

  const openBot = async () => {
    if (!user) return;
    const id = await ensureLearningBotChat(chat, user.id);
    await refresh();
    nav.push(learningBotHref(id));
  };

  if (!ready || (loading && user)) {
    return (
      <GradientScreen scheme={scheme}>
        <InboxSkeleton colors={colors} />
      </GradientScreen>
    );
  }

  // Ethora: empty inbox is a guided composition, not a blank screen.
  if (filtered.length === 0 && !debounced && !desktop) {
    return (
      <GradientScreen scheme={scheme}>
        <ChatsEmptyHome
          colors={colors}
          username={username}
          copied={copied}
          onCopyUsername={() => void copyUsername()}
          onShareInvite={() => void shareInvite()}
          onOpenBot={() => void openBot()}
          onNewChat={() => void openBot()}
          onSignOut={() => {
            router.replace('/');
            void auth.signOut();
          }}
        />
      </GradientScreen>
    );
  }

  if (desktop) {
    return (
      <GradientScreen scheme={scheme}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <SlayGif size={72} />
            <SavignasBoiAvatar size={56} />
          </View>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
            Pick a chat
          </Text>
          <Text style={{ color: colors.textMuted, marginTop: 8, textAlign: 'center', maxWidth: 360 }}>
            Conversations stay in the sidebar — chat and friends only, no meetups.
          </Text>
        </View>
      </GradientScreen>
    );
  }

  return (
    <GradientScreen scheme={scheme}>
      <View style={styles.listHeader}>
        <Pressable
          onPress={() => {
            router.replace('/');
            void auth.signOut();
          }}
          accessibilityLabel="Sign out"
          hitSlop={10}
        >
          <Ionicons name="log-out-outline" size={24} color={colors.textMuted} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.header, { color: colors.text }]} accessibilityRole="header">
            SavignaLearn
          </Text>
          <SlayGif size={36} />
        </View>
        <Pressable onPress={() => void openBot()} accessibilityLabel="New chat" hitSlop={10}>
          <Ionicons name="add-circle" size={30} color={colors.accent} />
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.search,
          {
            color: colors.text,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
        accessibilityLabel="Search conversations"
      />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 16 }}
        renderItem={({ item }) => (
          <InboxRow
            title={item.title ?? 'Chat'}
            preview={item.lastMessagePreview}
            time={relativeTime(item.updatedAt)}
            unread={item.unreadCount}
            muted={item.muted}
            online
            isBot={isLearningBotConversation(item)}
            colors={colors}
            onPress={() => nav.push(learningBotHref(item.id))}
          />
        )}
      />
    </GradientScreen>
  );
}

export function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const conversationId = routeParam(id, 'demo-1');
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const {
    chat,
    translation,
    completion,
    tokenizer,
    historyStore,
    aiBackend,
    setAiBackend,
    health,
    healthChecking,
    refreshHealth,
  } = useServices();
  const { user } = useAuthState();
  const router = useRouter();
  const wideChrome = useWideChatChrome();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<SourceMessage[]>([]);
  const [translations, setTranslations] = useState<Record<string, LineTranslation[]>>({});
  const [mode, setMode] = useState<DisplayMode>('lines');
  const [botReplies, setBotReplies] = useState(true);
  const [nativeLang, setNativeLang] = useState('en');
  const [learningLang, setLearningLang] = useState('de');
  const [partnerLearningLang, setPartnerLearningLang] = useState('en');
  const [replyTo, setReplyTo] = useState<SourceMessage | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tapToken, setTapToken] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<FlatList<SourceMessage>>(null);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (wideChrome) setSettingsOpen(false);
  }, [wideChrome]);

  const isBotChat = Boolean(conversation && isLearningBotConversation(conversation));

  const pipelineLabel = useMemo(() => {
    const resilient =
      completion instanceof ResilientChatCompletionAdapter ? completion : null;
    const selected = labelForAiBackend(aiBackend);
    if (resilient?.lastError && resilient.lastUsed === 'demo' && aiBackend !== 'demo') {
      return `${selected} failed · using Demo`;
    }
    if (
      aiBackend === 'foursome' &&
      resilient?.lastUsed &&
      resilient.lastUsed !== 'foursome' &&
      resilient.lastUsed !== 'demo'
    ) {
      return `fourSome · ${labelForAiBackend(resilient.lastUsed)}`;
    }
    return selected;
  }, [completion, aiBackend, messages, streamingId]);

  const wordTap = useMemo<WordTapPort>(
    () => ({
      async onPress(request) {
        setTapToken(request.token);
        setTimeout(() => setTapToken(null), 1800);
      },
    }),
    []
  );

  const viewpoint = useMemo(() => {
    return createLearnerViewpoint({
      native: nativeLang,
      learning: learningLang,
      displayMode: mode,
    });
  }, [nativeLang, learningLang, mode]);

  const retranslateThread = useCallback(
    async (
      msgs: SourceMessage[],
      langs: { native: string; learning: string; partnerLearning: string }
    ) => {
      if (!user || !conversation) return;
      const map: Record<string, LineTranslation[]> = { ...translations };
      for (const msg of msgs) {
        const asymmetric = {
          senderUserId: msg.authorId,
          receiverUserId: msg.authorId === user.id ? (otherParticipantId(conversation, user.id) ?? LEARNING_BOT_USER_ID) : user.id,
          senderLearningLang: msg.authorId === user.id ? langs.learning : langs.partnerLearning,
          receiverLearningLang: msg.authorId === user.id ? langs.partnerLearning : langs.learning,
          senderNativeLang: msg.authorId === user.id ? langs.native : langs.learning,
          receiverNativeLang: msg.authorId === user.id ? langs.learning : langs.native,
        };
        try {
          const { translations: next } = await processOutgoingTranslation({
            message: msg,
            asymmetric,
            mode: toTranslationMode(mode),
            engine: translation,
            historyStore,
            knownSourceLang: msg.sourceLang,
          });
          await chat.saveTranslations(msg.id, next);
          map[msg.id] = next;
        } catch {
          // keep previous lines
        }
      }
      setTranslations(map);
    },
    [user, conversation, translations, mode, translation, historyStore, chat]
  );

  const persistLanguages = useCallback(
    async (next: { native: string; learning: string; partnerLearning: string }) => {
      if (!user || !conversation) return;
      setNativeLang(next.native);
      setLearningLang(next.learning);
      setPartnerLearningLang(next.partnerLearning);
      const receiverId = otherParticipantId(conversation, user.id) ?? LEARNING_BOT_USER_ID;
      const participants = conversation.participants.map((p) => {
        if (p.userId === user.id) {
          return { ...p, nativeLang: next.native, learningLang: next.learning };
        }
        if (p.userId === receiverId) {
          return { ...p, learningLang: next.partnerLearning };
        }
        return p;
      });
      await chat.updateParticipants(conversation.id, participants);
      setConversation({ ...conversation, participants });
      await retranslateThread(messages, next);
    },
    [user, conversation, chat, messages, retranslateThread]
  );

  const load = useCallback(async () => {
    let conv = await chat.getConversation(conversationId);
    let activeId = conversationId;
    if (!conv && user) {
      const botId = await ensureLearningBotChat(chat, user.id);
      if (botId !== conversationId) {
        router.replace(learningBotHref(botId));
        return;
      }
      conv = await chat.getConversation(botId);
      activeId = botId;
    }
    setConversation(conv);
    setBotReplies(conv?.aiEnabled !== false);
    const participant = conv?.participants.find((p) => p.userId === user?.id);
    const receiverId = conv && user ? otherParticipantId(conv, user.id) : undefined;
    const receiver = conv?.participants.find((p) => p.userId === receiverId);
    if (participant) {
      setNativeLang(participant.nativeLang);
      setLearningLang(participant.learningLang);
    }
    if (receiver) setPartnerLearningLang(receiver.learningLang);
    const msgs = await chat.listMessages(activeId);
    setMessages((prev) => {
      const pending = prev.filter(
        (item) => inFlight.current.has(item.id) && !msgs.some((stored) => stored.id === item.id)
      );
      return upsertMessages(msgs, ...pending);
    });
    const map: Record<string, LineTranslation[]> = {};
    for (const msg of msgs) {
      map[msg.id] = await chat.listTranslations(msg.id);
    }
    setTranslations(map);
  }, [chat, conversationId, user?.id, router]);

  useEffect(() => {
    void load();
    return chat.subscribe(conversationId, (next) => {
      setMessages((prev) => {
        const pending = prev.filter(
          (item) => inFlight.current.has(item.id) && !next.some((stored) => stored.id === item.id)
        );
        return upsertMessages(next, ...pending);
      });
    });
  }, [chat, conversationId, load]);

  useEffect(() => {
    if (messages.length === 0) return;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages]);

  const send = async (text: string, retryOf?: SourceMessage) => {
    const body = text.trim();
    if (!body) return;

    const authorId = user?.id ?? 'local';
    let thread = conversation;
    let threadId = conversation?.id ?? conversationId;

    const optimistic = retryOf
      ? { ...retryOf, sourceText: body, receipt: 'pending' as const }
      : sourceMessageFromText({
          id: newMessageId('local'),
          conversationId: threadId,
          authorId,
          sourceLang: viewpoint.native,
          sourceText: body,
          receipt: 'pending',
          replyToId: replyTo?.id,
        });

    if (inFlight.current.has(optimistic.id)) return;
    inFlight.current.add(optimistic.id);
    setSendError(null);
    setMessages((prev) =>
      retryOf
        ? prev.map((m) => (m.id === retryOf.id ? optimistic : m))
        : upsertMessages(prev, optimistic)
    );
    if (!retryOf) setReplyTo(null);

    if (!user) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, receipt: 'failed' } : m))
      );
      setSendError('Sign in to send.');
      inFlight.current.delete(optimistic.id);
      return;
    }

    if (!thread) {
      threadId = await ensureLearningBotChat(chat, user.id);
      thread = await chat.getConversation(threadId);
      setConversation(thread);
      if (threadId !== conversationId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? { ...m, conversationId: threadId } : m))
        );
        router.replace(learningBotHref(threadId));
      }
    }
    if (!thread) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, receipt: 'failed' } : m))
      );
      setSendError("Couldn't open this chat.");
      inFlight.current.delete(optimistic.id);
      return;
    }

    const receiverId = otherParticipantId(thread, user.id) ?? LEARNING_BOT_USER_ID;
    const asymmetric: AsymmetricLanguageContext = {
      senderUserId: user.id,
      receiverUserId: receiverId,
      senderLearningLang: learningLang,
      receiverLearningLang: partnerLearningLang,
      senderNativeLang: nativeLang,
      receiverNativeLang: learningLang,
    };
    const outgoing = { ...optimistic, conversationId: threadId };

    let saved = optimistic;
    try {
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const alreadyStored = (await chat.listMessages(threadId)).some(
        (m) => m.id === optimistic.id
      );
      saved = alreadyStored
        ? { ...outgoing, receipt: 'sent' }
        : await chat.appendMessage({ ...outgoing, receipt: 'sent' });
      if (alreadyStored) await chat.updateReceipt(saved.id, 'sent');
      setMessages((prev) => upsertMessages(prev, saved));

      const { translations: all } = await processOutgoingTranslation({
        message: saved,
        asymmetric,
        mode: toTranslationMode(mode),
        engine: translation,
        historyStore,
      });
      await chat.saveTranslations(saved.id, all);
      setTranslations((prev) => ({ ...prev, [saved.id]: all }));
      await chat.updateReceipt(saved.id, 'delivered');
      saved = { ...saved, receipt: 'delivered' };
      setMessages((prev) => upsertMessages(prev, saved));
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, receipt: 'failed' } : m))
      );
      setSendError(error instanceof Error ? error.message : "Couldn't send. Tap the bubble to retry.");
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      inFlight.current.delete(optimistic.id);
      return;
    }

    const talkingToBot = isLearningBotConversation(thread);
    if (botReplies && talkingToBot) {
      const aiId = newMessageId('ai');
      setStreamingId(aiId);
      try {
        const bilingual = await completeBilingualBotReply({
          completion,
          learnerText: body,
          learningLang,
          nativeLang,
        });
        const aiMessage = sourceMessageFromText({
          id: aiId,
          conversationId: threadId,
          authorId: LEARNING_BOT_USER_ID,
          sourceLang: bilingual.sourceLang,
          sourceText: bilingual.sourceText,
          kind: 'ai',
          receipt: 'sent',
        });
        const storedAi = await chat.appendMessage(aiMessage);
        let aiTranslations = bilingual.translations;
        if (aiTranslations.length === 0) {
          const aiAsymmetric: AsymmetricLanguageContext = {
            senderUserId: LEARNING_BOT_USER_ID,
            receiverUserId: user.id,
            senderLearningLang: partnerLearningLang,
            receiverLearningLang: learningLang,
            senderNativeLang: learningLang,
            receiverNativeLang: nativeLang,
          };
          try {
            const { translations } = await processOutgoingTranslation({
              message: storedAi,
              asymmetric: aiAsymmetric,
              mode: toTranslationMode(mode),
              engine: translation,
              historyStore,
            });
            aiTranslations = translations;
          } catch {
            // Keep the bubble even if the translation pass fails.
          }
        }
        if (aiTranslations.length > 0) {
          await chat.saveTranslations(storedAi.id, aiTranslations);
          setTranslations((prev) => ({ ...prev, [storedAi.id]: aiTranslations }));
        }
        setMessages((prev) => upsertMessages(prev, saved, storedAi));
        const resilient =
          completion instanceof ResilientChatCompletionAdapter ? completion : null;
        if (resilient?.lastError && resilient.lastUsed === 'demo' && aiBackend !== 'demo') {
          setSendError(`${labelForAiBackend(aiBackend)} failed · ${resilient.lastError}`);
        }
      } catch (error) {
        setSendError(error instanceof Error ? error.message : `${LEARNING_BOT_DISPLAY_NAME} didn't reply.`);
        setMessages((prev) => upsertMessages(prev, saved));
      } finally {
        setStreamingId(null);
      }
    }
    inFlight.current.delete(optimistic.id);
  };

  const persistNative = (code: string) => {
    if (code === learningLang) return;
    void persistLanguages({
      native: code,
      learning: learningLang,
      partnerLearning: partnerLearningLang,
    });
  };
  const persistLearning = (code: string) => {
    if (code === nativeLang) return;
    void persistLanguages({
      native: nativeLang,
      learning: code,
      partnerLearning: partnerLearningLang,
    });
  };
  const persistPartner = (code: string) => {
    void persistLanguages({
      native: nativeLang,
      learning: learningLang,
      partnerLearning: code,
    });
  };

  const chatSettings = {
    colors,
    mode,
    onModeChange: setMode,
    botReplies,
    onBotRepliesChange: setBotReplies,
    nativeLang,
    learningLang,
    partnerLearningLang,
    onNativeLangChange: persistNative,
    onLearningLangChange: persistLearning,
    onPartnerLearningLangChange: persistPartner,
    isBotChat,
    aiBackend,
    onAiBackendChange: setAiBackend,
    health,
  };

  return (
    <GradientScreen scheme={scheme} edges={['top', 'left', 'right', 'bottom']}>
      <ThreadChromeHeader
        title={conversation?.title ?? LEARNING_BOT_DISPLAY_NAME}
        subtitle={
          wideChrome
            ? undefined
            : `${nativeLang.toUpperCase()} → ${learningLang.toUpperCase()} · they read ${partnerLearningLang.toUpperCase()}`
        }
        pipelineLabel={wideChrome ? undefined : pipelineLabel}
        onBack={() => router.back()}
        onOpenSettings={wideChrome ? undefined : () => setSettingsOpen(true)}
        inlineSettings={wideChrome ? <ThreadInlineChatSettings {...chatSettings} /> : undefined}
        colors={colors}
        scheme={scheme}
        isBot={isBotChat}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <FlatList
          ref={listRef}
          data={messages}
          extraData={{ messages, translations }}
          keyExtractor={(item) => item.id}
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={{ padding: 16, paddingBottom: 8, flexGrow: 1 }}
          renderItem={({ item }) => {
            const mine = item.authorId === user?.id;
            const kind = item.kind === 'ai' || item.authorId === LEARNING_BOT_USER_ID ? 'ai' : item.kind;
            const lines = renderViewpoint(item, translations[item.id] ?? [], viewpoint);
            return (
              <MessageBubble
                mine={mine}
                kind={kind}
                lines={lines}
                mode={mode}
                language={item.sourceLang}
                tokenizer={tokenizer}
                wordTap={wordTap}
                source={{ conversationId, messageId: item.id }}
                colors={colors}
                receipt={item.receipt}
                failed={item.receipt === 'failed'}
                errorCopy={item.receipt === 'failed' ? sendError ?? undefined : undefined}
                streaming={streamingId === item.id}
                nativeLang={nativeLang}
                learningLang={learningLang}
                onRetry={() => void send(item.sourceText, item)}
              />
            );
          }}
        />
        {sendError ? (
          <Text
            style={{ color: colors.danger, paddingHorizontal: 16, paddingBottom: 6, fontSize: 13 }}
            accessibilityLiveRegion="polite"
          >
            {sendError}
          </Text>
        ) : null}
        <Composer
          colors={colors}
          onSend={(text) => void send(text)}
          replyPreview={replyTo?.sourceText}
          onCancelReply={() => setReplyTo(null)}
          nativeLang={nativeLang}
        />
      </KeyboardAvoidingView>
      <WordTapToast token={tapToken} colors={colors} />
      <ChatSettingsSheet
        visible={settingsOpen && !wideChrome}
        onClose={() => setSettingsOpen(false)}
        {...chatSettings}
        pipelineLabel={pipelineLabel}
        healthChecking={healthChecking}
        onRetryHealth={refreshHealth}
      />
    </GradientScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  header: { fontSize: 28, fontWeight: '800', paddingVertical: 8, letterSpacing: -0.5 },
  search: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 44,
  },
});
