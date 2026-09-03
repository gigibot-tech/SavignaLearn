/**
 * Inbox + thread screens — Gigolingo gradient shell + fourSome ember UI.
 */

import { router, useLocalSearchParams, useRouter } from 'expo-router';
import { learningBotHref, routeParam } from '@/adapters/postLogin';
import { chatActorIds, chatPersistenceUserId, isChatSelf } from '@/adapters/identity';
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
  imageUrlsOf,
  isLearningBotConversation,
  isMediaMessage,
  LEARNING_BOT_DISPLAY_NAME,
  LEARNING_BOT_USER_ID,
  mediaKindOf,
  otherParticipantId,
  renderViewpoint,
  shouldTranslateMessage,
  sourceMessageFromImage,
  sourceMessageFromText,
  mergeLineTranslations,
  mergeTranslationMaps,
  toTranslationMode,
  translationMismatch,
  type AsymmetricLanguageContext,
  type Conversation,
  type DisplayMode,
  type LineTranslation,
  type TranslationMismatchReason,
  type SourceMessage,
} from '@/domain';
import { shouldAutoReplyFromSendInput } from '@/domain/chatAutoReply';
import {
  ensureLearningBotChat,
  labelForAiBackend,
  listInboxConversations,
  ResilientChatCompletionAdapter,
} from '@/adapters/chat';
import { usernameFromUser } from '@/adapters/friends';
import { processOutgoingTranslation, completeBilingualBotReply, persistCompletedHistory, recalculateBirkenbihlForThread, retryBubbleTranslations } from '@/adapters/translation';
import { loadConversationThread } from '@/adapters/chatPersistence';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState, useServices } from './AppProviders';
import { useNotifications } from '@/features/notifications/NotificationProvider';
import { useAppShell, useWideChatChrome } from '@/features/shell/AppShell';
import { useVocabCardFromTap } from '@/features/vocabulary/CreateVocabCardModal';
import { TippedVocabHome } from '@/features/vocabulary/vocabularyUi';
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
} from './chatUi';
import type { OutgoingMedia } from './composerMedia';

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(delta / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function newMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
    const ids = chatActorIds(user);
    try {
      await ensureLearningBotChat(chat, chatPersistenceUserId(user), ids);
      setItems(await listInboxConversations(chat, ids));
    } finally {
      setLoading(false);
    }
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
    const id = await ensureLearningBotChat(chat, chatPersistenceUserId(user), chatActorIds(user));
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
          vocabRail={<TippedVocabHome colors={colors} />}
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
          <View style={{ alignSelf: 'stretch', width: '100%', maxWidth: 560, marginTop: 28 }}>
            <TippedVocabHome colors={colors} />
          </View>
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
    vocabularyCards,
    learningItems,
  } = useServices();
  const { user } = useAuthState();
  const chatUserId = user ? chatPersistenceUserId(user) : undefined;
  const selfIds = useMemo(
    () => (user ? chatActorIds(user) : []),
    [user?.id, user?.idoUserId]
  );
  const router = useRouter();
  const { showNotification } = useNotifications();
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
  const [sendError, setSendError] = useState<string | null>(null);
  const [birkenBusy, setBirkenBusy] = useState(false);
  const [translationRetryIds, setTranslationRetryIds] = useState<string[]>([]);
  const listRef = useRef<FlatList<SourceMessage>>(null);
  const inFlight = useRef(new Set<string>());
  const translationsRef = useRef(translations);
  translationsRef.current = translations;
  const birkenInFlight = useRef(new Set<string>());
  const translationRetryInFlight = useRef(new Set<string>());

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

  const { wordTap, modal: vocabModal } = useVocabCardFromTap({
    userId: user?.id,
    cards: vocabularyCards,
    items: learningItems,
    colors,
  });

  const viewpoint = useMemo(() => {
    return createLearnerViewpoint({
      native: nativeLang,
      learning: learningLang,
      displayMode: mode,
    });
  }, [nativeLang, learningLang, mode]);

  const asymmetricFor = useCallback(
    (
      msg: SourceMessage,
      langs: { native: string; learning: string; partnerLearning: string }
    ): AsymmetricLanguageContext | null => {
      if (!user || !conversation) return null;
      const mine = isChatSelf(user, msg.authorId);
      const receiverId = mine
        ? (otherParticipantId(conversation, selfIds) ?? LEARNING_BOT_USER_ID)
        : (chatUserId ?? user.id);
      return {
        senderUserId: msg.authorId,
        receiverUserId: receiverId,
        senderLearningLang: mine ? langs.learning : langs.partnerLearning,
        receiverLearningLang: mine ? langs.partnerLearning : langs.learning,
        senderNativeLang: mine ? langs.native : langs.learning,
        receiverNativeLang: mine ? langs.learning : langs.native,
      };
    },
    [user, conversation, chatUserId, selfIds]
  );

  const retryTranslation = useCallback(
    async (msg: SourceMessage, mismatchReason?: TranslationMismatchReason | null) => {
      if (!user || !conversation) return;
      if (!shouldTranslateMessage(msg)) return;
      if (translationRetryInFlight.current.has(msg.id)) return;
      translationRetryInFlight.current.add(msg.id);
      setTranslationRetryIds([...translationRetryInFlight.current]);
      const existing = translationsRef.current[msg.id] ?? [];
      const sourceSnapshot = msg.sourceText;
      try {
        const messageForRetry =
          isChatSelf(user, msg.authorId) ? { ...msg, sourceLang: nativeLang } : {
            ...msg,
            // SavignasBoi stores `sourceText` as `learning_text`; for mismatch logic we treat
            // that as the viewer’s `learningLang`, not the model’s `detected_source_lang`.
            sourceLang:
              msg.authorId === LEARNING_BOT_USER_ID || msg.kind === 'ai' ? learningLang : msg.sourceLang,
          };
        const reason = mismatchReason ?? translationMismatch({
          message: messageForRetry,
          translations: existing,
          viewpoint,
        });
        const asymmetric =
          asymmetricFor(msg, {
            native: nativeLang,
            learning: learningLang,
            partnerLearning: partnerLearningLang,
          }) ?? {
            senderUserId: msg.authorId,
            receiverUserId: chatUserId ?? user.id,
            senderLearningLang: learningLang,
            receiverLearningLang: learningLang,
            senderNativeLang: nativeLang,
            receiverNativeLang: nativeLang,
          };
        const next = await retryBubbleTranslations({
          message: messageForRetry,
          existingTranslations: existing,
          asymmetric,
          mode: toTranslationMode(mode),
          engine: translation,
          historyStore,
          completion: msg.kind === 'ai' || msg.authorId === LEARNING_BOT_USER_ID ? completion : undefined,
          learningLang,
          nativeLang,
          mismatchReason: reason,
        });
        if (msg.sourceText !== sourceSnapshot) {
          msg.sourceText = sourceSnapshot;
        }
        const merged = mergeLineTranslations(existing, next);
        await chat.saveTranslations(msg.id, merged);
        setTranslations((prev) => ({ ...prev, [msg.id]: mergeLineTranslations(prev[msg.id] ?? [], merged) }));
      } catch {
        // Keep source visible; Retry stays if the pair is still empty/mismatched.
      } finally {
        translationRetryInFlight.current.delete(msg.id);
        setTranslationRetryIds([...translationRetryInFlight.current]);
      }
    },
    [
      user,
      conversation,
      asymmetricFor,
      nativeLang,
      learningLang,
      partnerLearningLang,
      mode,
      translation,
      historyStore,
      completion,
      chat,
    ]
  );

  const runBirkenbihlRecalc = useCallback(
    async (msgs: SourceMessage[], fillMissingOnly: boolean) => {
      if (!user || !conversation) return;
      const pending = (fillMissingOnly
        ? msgs.filter((msg) => {
            const rows = translationsRef.current[msg.id] ?? [];
            return !rows.some((row) => row.mode === 'birkenbihl' && row.text.trim().length > 0);
          })
        : msgs
      ).filter((msg) => shouldTranslateMessage(msg) && !birkenInFlight.current.has(msg.id));
      if (pending.length === 0) return;
      const pendingForSourceLang = pending.map((m) => {
        const mine = isChatSelf(user, m.authorId);
        if (mine) return { ...m, sourceLang: nativeLang };
        if (m.authorId === LEARNING_BOT_USER_ID || m.kind === 'ai') {
          return { ...m, sourceLang: learningLang };
        }
        return m;
      });
      for (const msg of pending) birkenInFlight.current.add(msg.id);
      setBirkenBusy(true);
      try {
        const { translationsByMessage, errors } = await recalculateBirkenbihlForThread({
          messages: pendingForSourceLang,
          translationsByMessage: translationsRef.current,
          asymmetric: (msg) =>
            asymmetricFor(msg, {
              native: nativeLang,
              learning: learningLang,
              partnerLearning: partnerLearningLang,
            }) ?? {
              senderUserId: msg.authorId,
              receiverUserId: chatUserId ?? user.id,
              senderLearningLang: learningLang,
              receiverLearningLang: learningLang,
              senderNativeLang: nativeLang,
              receiverNativeLang: nativeLang,
            },
          engine: translation,
          hintLang: nativeLang,
          historyStore,
          fillMissingOnly,
        });
        for (const [messageId, rows] of Object.entries(translationsByMessage)) {
          try {
            await chat.saveTranslations(messageId, rows);
          } catch {
            // keep going — per-message persistence must not fail the thread
          }
        }
        setTranslations((prev) => ({ ...prev, ...translationsByMessage }));
        if (errors.length > 0) {
          setSendError(
            errors.length === 1
              ? `Birkenbihl recalc failed: ${errors[0]?.error}`
              : `Birkenbihl recalc failed for ${errors.length} messages.`
          );
        }
      } finally {
        for (const msg of pending) birkenInFlight.current.delete(msg.id);
        setBirkenBusy(birkenInFlight.current.size > 0);
      }
    },
    [
      user,
      conversation,
      nativeLang,
      learningLang,
      partnerLearningLang,
      asymmetricFor,
      translation,
      historyStore,
      chat,
    ]
  );

  useEffect(() => {
    if (mode !== 'birkenbihl' || messages.length === 0) return;
    void runBirkenbihlRecalc(messages, true);
  }, [mode, messages, runBirkenbihlRecalc]);

  const retranslateThread = useCallback(
    async (
      msgs: SourceMessage[],
      langs: { native: string; learning: string; partnerLearning: string }
    ) => {
      if (!user || !conversation) return;
      const map: Record<string, LineTranslation[]> = { ...translations };
      for (const msg of msgs) {
        if (!shouldTranslateMessage(msg)) continue;
        const asymmetric =
          asymmetricFor(msg, langs) ?? {
            senderUserId: msg.authorId,
            receiverUserId: chatUserId ?? user.id,
            senderLearningLang: langs.learning,
            receiverLearningLang: langs.learning,
            senderNativeLang: langs.native,
            receiverNativeLang: langs.native,
          };
        try {
          const { translations: next } = await processOutgoingTranslation({
            message: msg,
            asymmetric,
            mode: 'standard',
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
    [user, conversation, translations, translation, historyStore, chat, asymmetricFor, chatUserId]
  );

  const persistLanguages = useCallback(
    async (next: { native: string; learning: string; partnerLearning: string }) => {
      if (!user || !conversation) return;
      setNativeLang(next.native);
      setLearningLang(next.learning);
      setPartnerLearningLang(next.partnerLearning);
      const receiverId = otherParticipantId(conversation, selfIds) ?? LEARNING_BOT_USER_ID;
      const participants = conversation.participants.map((p) => {
        if (isChatSelf(user, p.userId)) {
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
    [user, conversation, chat, messages, retranslateThread, selfIds]
  );

  const load = useCallback(async () => {
    if (user && chatUserId) await ensureLearningBotChat(chat, chatUserId, selfIds);
    let conv = await chat.getConversation(conversationId);
    let activeId = conversationId;
    if (!conv && user && chatUserId) {
      const botId = await ensureLearningBotChat(chat, chatUserId, selfIds);
      if (botId !== conversationId) {
        router.replace(learningBotHref(botId));
        return;
      }
      conv = await chat.getConversation(botId);
      activeId = botId;
    }
    setConversation(conv);
    setBotReplies(conv?.aiEnabled !== false);
    const participant = conv?.participants.find((p) => (user ? isChatSelf(user, p.userId) : false));
    const receiverId = conv && user ? otherParticipantId(conv, selfIds) : undefined;
    const receiver = conv?.participants.find((p) => p.userId === receiverId);
    if (participant) {
      setNativeLang(participant.nativeLang);
      setLearningLang(participant.learningLang);
    }
    if (receiver) setPartnerLearningLang(receiver.learningLang);
    const thread = await loadConversationThread({
      chat,
      historyStore,
      conversationId: activeId,
      userId: chatUserId ?? user?.id,
    });
    setMessages((prev) => {
      const pending = prev.filter(
        (item) =>
          inFlight.current.has(item.id) && !thread.messages.some((stored) => stored.id === item.id)
      );
      return upsertMessages(thread.messages, ...pending);
    });
    setTranslations((prev) => mergeTranslationMaps(prev, thread.translations));
  }, [chat, historyStore, conversationId, user?.id, chatUserId, selfIds, router]);

  useEffect(() => {
    void load();
    return chat.subscribe(conversationId, (next) => {
      setMessages((prev) => {
        const pending = prev.filter(
          (item) => inFlight.current.has(item.id) && !next.some((stored) => stored.id === item.id)
        );
        return upsertMessages(next, ...pending);
      });
      void (async () => {
        const extras: Record<string, LineTranslation[]> = {};
        for (const msg of next) {
          const listed = await chat.listTranslations(msg.id);
          if (listed.length > 0) extras[msg.id] = listed;
        }
        setTranslations((prev) => {
          const merged: Record<string, LineTranslation[]> = { ...prev };
          for (const [id, rows] of Object.entries(extras)) {
            merged[id] = mergeLineTranslations(prev[id] ?? [], rows);
          }
          return merged;
        });
      })();
    });
  }, [chat, conversationId, load]);

  useEffect(() => {
    if (messages.length === 0) return;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages]);

  const send = async (
    input:
      | { type: 'text'; text: string; retryOf?: SourceMessage }
      | { type: 'image'; media: OutgoingMedia }
      | { type: 'retry'; message: SourceMessage }
  ) => {
    const authorId = chatUserId ?? user?.id ?? 'local';
    let thread = conversation;
    let threadId = conversation?.id ?? conversationId;

    let optimistic: SourceMessage;
    if (input.type === 'retry') {
      optimistic = { ...input.message, receipt: 'pending' };
    } else if (input.type === 'image') {
      if (!input.media.url) return;
      optimistic = sourceMessageFromImage({
        id: newMessageId(),
        conversationId: threadId,
        authorId,
        sourceLang: nativeLang,
        imageUrl: input.media.url,
        mediaKind: input.media.mediaKind,
        alt: input.media.alt,
        receipt: 'pending',
        replyToId: replyTo?.id,
      });
    } else {
      const body = input.text.trim();
      if (!body) return;
      optimistic = input.retryOf
        ? { ...input.retryOf, sourceText: body, receipt: 'pending' as const }
        : sourceMessageFromText({
            id: newMessageId(),
            conversationId: threadId,
            authorId,
            sourceLang: nativeLang,
            sourceText: body,
            receipt: 'pending',
            replyToId: replyTo?.id,
          });
    }

    const retryOf = input.type === 'retry' ? input.message : input.type === 'text' ? input.retryOf : undefined;

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
      threadId = await ensureLearningBotChat(chat, chatPersistenceUserId(user), selfIds);
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

    const receiverId = otherParticipantId(thread, selfIds) ?? LEARNING_BOT_USER_ID;
    const asymmetric: AsymmetricLanguageContext = {
      senderUserId: chatPersistenceUserId(user),
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
        knownSourceLang: nativeLang,
        existingTranslations: translationsRef.current[saved.id],
      });
      await chat.saveTranslations(saved.id, all);
      setTranslations((prev) => ({
        ...prev,
        [saved.id]: mergeLineTranslations(prev[saved.id] ?? [], all),
      }));
      await chat.updateReceipt(saved.id, 'delivered');
      saved = { ...saved, receipt: 'delivered' };
      setMessages((prev) => upsertMessages(prev, saved));
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, receipt: 'failed' } : m))
      );
      const msg =
        error instanceof Error ? error.message : "Couldn't send. Tap the bubble to retry.";
      setSendError(msg);
      if (Platform.OS === 'web') {
        const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
        if (hidden) {
          void showNotification({
            title: 'Send failed',
            body: msg.slice(0, 180),
            url: learningBotHref(threadId),
            data: { conversationId: threadId },
            tag: `send-fail:${threadId}`,
          });
        }
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      inFlight.current.delete(optimistic.id);
      return;
    }

    const talkingToBot = isLearningBotConversation(thread);
    const isMedia = isMediaMessage(saved);
    if (
      shouldAutoReplyFromSendInput(input.type, {
        botReplies,
        talkingToBot,
        isMediaMessage: isMedia,
      })
    ) {
      const aiId = newMessageId();
      setStreamingId(aiId);
      let storedAi: SourceMessage | undefined;
      try {
        const bilingual = await completeBilingualBotReply({
          completion,
          learnerText: saved.sourceText,
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
        storedAi = await chat.appendMessage(aiMessage);
        const persistedAi = storedAi;
        let aiTranslations = bilingual.translations;
        if (aiTranslations.length === 0) {
          const aiAsymmetric: AsymmetricLanguageContext = {
            senderUserId: LEARNING_BOT_USER_ID,
            receiverUserId: chatUserId ?? user.id,
            senderLearningLang: partnerLearningLang,
            receiverLearningLang: learningLang,
            senderNativeLang: learningLang,
            receiverNativeLang: nativeLang,
          };
          try {
            const { translations } = await processOutgoingTranslation({
              message: persistedAi,
              asymmetric: aiAsymmetric,
              mode: toTranslationMode(mode),
              engine: translation,
              historyStore,
              existingTranslations: translationsRef.current[persistedAi.id],
            });
            aiTranslations = mergeLineTranslations(
              translationsRef.current[persistedAi.id] ?? [],
              translations
            );
          } catch {
            // Keep the bubble even if the translation pass fails.
          }
        }
        if (aiTranslations.length > 0) {
          await chat.saveTranslations(persistedAi.id, aiTranslations);
          try {
            await persistCompletedHistory({
              store: historyStore,
              message: persistedAi,
              translations: aiTranslations,
              mode: 'standard',
            });
          } catch {
            // Chat repo is the source of truth; history is a reload backup.
          }
          setTranslations((prev) => ({
            ...prev,
            [persistedAi.id]: mergeLineTranslations(prev[persistedAi.id] ?? [], aiTranslations),
          }));
        }
        setMessages((prev) => upsertMessages(prev, saved, persistedAi));
        const resilient =
          completion instanceof ResilientChatCompletionAdapter ? completion : null;
        if (resilient?.lastError && resilient.lastUsed === 'demo' && aiBackend !== 'demo') {
          setSendError(`${labelForAiBackend(aiBackend)} failed · ${resilient.lastError}`);
        }
      } catch (error) {
        setSendError(error instanceof Error ? error.message : `${LEARNING_BOT_DISPLAY_NAME} didn't reply.`);
        setMessages((prev) => upsertMessages(prev, saved, ...(storedAi ? [storedAi] : [])));
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
    onRecalculateBirkenbihl: () => void runBirkenbihlRecalc(messages, false),
    birkenbihlBusy: birkenBusy,
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
          extraData={{ messages, translations, mode, birkenBusy, translationRetryIds }}
          keyExtractor={(item) => item.id}
          style={styles.flex}
          initialNumToRender={Math.max(messages.length, 32)}
          windowSize={21}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={{ padding: 16, paddingBottom: 8, flexGrow: 1 }}
          renderItem={({ item }) => {
            const mine = isChatSelf(user, item.authorId);
            const kind = item.kind === 'ai' || item.authorId === LEARNING_BOT_USER_ID ? 'ai' : item.kind;
            const itemForView = mine
              ? { ...item, sourceLang: nativeLang }
              : item.authorId === LEARNING_BOT_USER_ID || item.kind === 'ai'
                ? { ...item, sourceLang: learningLang }
                : item;
            const lines = renderViewpoint(itemForView, translations[item.id] ?? [], viewpoint, {
              own: mine,
            });
            const mismatch = translationMismatch({
              message: itemForView,
              translations: translations[item.id] ?? [],
              viewpoint,
            });
            const canRetryTranslation =
              mismatch &&
              item.receipt !== 'failed' &&
              shouldTranslateMessage(item) &&
              mediaKindOf(item) !== 'sticker';
            return (
              <MessageBubble
                mine={mine}
                kind={kind}
                lines={lines}
                mode={mode}
                language={itemForView.sourceLang}
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
                imageUrls={imageUrlsOf(item)}
                mediaKind={mediaKindOf(item)}
                onRetry={() => void send({ type: 'retry', message: item })}
                onRetryTranslation={
                  canRetryTranslation ? () => void retryTranslation(item, mismatch) : undefined
                }
                translationRetryReason={canRetryTranslation ? mismatch : null}
                translationRetryBusy={translationRetryIds.includes(item.id)}
                onRetryBirkenbihl={
                  mode === 'birkenbihl' && shouldTranslateMessage(item)
                    ? () => void runBirkenbihlRecalc([item], false)
                    : undefined
                }
                birkenbihlBusy={birkenInFlight.current.has(item.id)}
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
          onSend={(text) => void send({ type: 'text', text })}
          onSendImage={(media) => void send({ type: 'image', media })}
          replyPreview={replyTo?.sourceText}
          onCancelReply={() => setReplyTo(null)}
          nativeLang={nativeLang}
          learningLang={learningLang}
        />
      </KeyboardAvoidingView>
      {vocabModal}
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
