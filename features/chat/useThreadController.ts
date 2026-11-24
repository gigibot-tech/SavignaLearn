/**
 * Everything a chat thread *does*, kept out of the screen so ThreadScreen can just render:
 * loading and live updates, sending (with optimistic bubbles), translation and Birkenbihl
 * retries, language changes, deleting, and the Bot's replies.
 *
 * One controller per open conversation; `conversationId` comes from the route.
 */

import { useRouter } from 'expo-router';
import { chatHref } from '@/adapters/postLogin';
import { chatActorIds, chatPersistenceUserId, isChatSelf } from '@/adapters/identity';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  createLearnerViewpoint,
  formatCardPresence,
  isLearningBotConversation,
  isMediaMessage,
  LEARNING_BOT_DISPLAY_NAME,
  LEARNING_BOT_USER_ID,
  mergeMessageTimelines,
  messagesVisibleToViewer,
  otherParticipantId,
  profileCardFor,
  shouldTranslateMessage,
  sourceMessageFromImage,
  sourceMessageFromText,
  mergeLineTranslations,
  mergeTranslationMaps,
  toTranslationMode,
  tombstoneMessage,
  translationMismatch,
  type AsymmetricLanguageContext,
  type Conversation,
  type DisplayMode,
  type LineTranslation,
  type TranslationMismatchReason,
  type SourceMessage,
} from '@/domain';
import { shouldAutoReplyFromSendInput } from '@/domain/chatAutoReply';
import { labelForAiBackend, ResilientChatCompletionAdapter } from '@/adapters/chat';
import {
  processOutgoingTranslation,
  completeBilingualBotReply,
  persistCompletedHistory,
  recalculateBirkenbihlForThread,
  retryBubbleTranslations,
} from '@/adapters/translation';
import { useAuthState, useServices } from './AppProviders';
import { useInboxQuery, useProfileCardsQuery, useThreadQuery } from '@/features/query/useChatQueries';
import { queryKeys } from '@/features/query/queryKeys';
import type { ThreadSnapshot } from '@/features/query/fetchThread';
import { useQueryClient } from '@tanstack/react-query';
import { useNotifications } from '@/features/notifications/NotificationProvider';
import type { OutgoingMedia } from './Composer';

function newMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Keep FlatList keys unique when merging optimistic + subscribed repo snapshots. */
function upsertMessages(prev: SourceMessage[], ...incoming: SourceMessage[]): SourceMessage[] {
  return mergeMessageTimelines(prev, incoming);
}

/** Ids with work in flight: readable synchronously (to dedupe) and as state (to render spinners). */
function useTrackedSet(): [string[], TrackedSet] {
  const ref = useRef(new Set<string>());
  const [ids, setIds] = useState<string[]>([]);
  const ops = useMemo<TrackedSet>(() => {
    const publish = () => setIds([...ref.current]);
    return {
      has: (id) => ref.current.has(id),
      add: (...items) => {
        for (const id of items) ref.current.add(id);
        publish();
      },
      remove: (...items) => {
        for (const id of items) ref.current.delete(id);
        publish();
      },
      clear: () => {
        ref.current.clear();
        publish();
      },
    };
  }, []);
  return [ids, ops];
}

type TrackedSet = {
  has: (id: string) => boolean;
  add: (...ids: string[]) => void;
  remove: (...ids: string[]) => void;
  clear: () => void;
};

export function useThreadController(conversationId: string) {
  const {
    chat,
    translation,
    completion,
    historyStore,
    aiBackend,
    bumpFriends,
  } = useServices();
  const { user } = useAuthState();
  const chatUserId = user ? chatPersistenceUserId(user) : undefined;
  const selfIds = useMemo(
    () => (user ? chatActorIds(user) : []),
    [user?.id, user?.idoUserId]
  );
  const router = useRouter();
  const queryClient = useQueryClient();
  const threadQuery = useThreadQuery(conversationId);
  const inboxQuery = useInboxQuery();
  const threadUserId = user ? chatPersistenceUserId(user) : 'anon';
  const { showNotification } = useNotifications();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<SourceMessage[]>([]);
  const [boundId, setBoundId] = useState(conversationId);
  const [translations, setTranslations] = useState<Record<string, LineTranslation[]>>({});
  const [mode, setMode] = useState<DisplayMode>('lines');
  const [botReplies, setBotReplies] = useState(true);
  const [nativeLang, setNativeLang] = useState('en');
  const [learningLang, setLearningLang] = useState('de');
  const [partnerLearningLang, setPartnerLearningLang] = useState('en');
  const [replyTo, setReplyTo] = useState<SourceMessage | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [translationRetryIds, translationRetry] = useTrackedSet();
  const [birkenRetryIds, birkenRetry] = useTrackedSet();
  const [translatingIds, translating] = useTrackedSet();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<SourceMessage | null>(null);
  const visibleMessages = useMemo(
    () => messagesVisibleToViewer(messages, hiddenIds),
    [messages, hiddenIds]
  );
  const inFlight = useRef(new Set<string>());
  const translationsRef = useRef(translations);
  translationsRef.current = translations;

  const headerConversation =
    conversation?.id === conversationId
      ? conversation
      : (inboxQuery.data ?? []).find((item) => item.id === conversationId) ?? null;
  const isBotChat = Boolean(
    conversation?.id === conversationId && conversation && isLearningBotConversation(conversation)
  );
  const partnerId =
    (headerConversation && otherParticipantId(headerConversation, selfIds)) ||
    (headerConversation && isLearningBotConversation(headerConversation)
      ? LEARNING_BOT_USER_ID
      : undefined);
  const partnerCards = useProfileCardsQuery(partnerId ? [partnerId] : []);
  const partnerCard = profileCardFor(partnerCards.map, partnerId);
  const presenceLabel = formatCardPresence(partnerCard);

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

  const viewpoint = useMemo(() => {
    return createLearnerViewpoint({
      native: nativeLang,
      learning: learningLang,
      displayMode: mode,
    });
  }, [nativeLang, learningLang, mode]);

  /** Who is "sender" and who is "receiver" for a message, in language terms. */
  const asymmetricFor = useCallback(
    (
      msg: SourceMessage,
      langs: { native: string; learning: string; partnerLearning: string }
    ): AsymmetricLanguageContext => {
      const mine = isChatSelf(user, msg.authorId);
      const receiverId = mine
        ? ((conversation && otherParticipantId(conversation, selfIds)) ?? LEARNING_BOT_USER_ID)
        : (chatUserId ?? user?.id ?? '');
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
      if (translationRetry.has(msg.id)) return;
      translationRetry.add(msg.id);
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
          });
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
        if (messageForRetry.sourceLang !== msg.sourceLang) {
          const retagged = { ...msg, sourceLang: messageForRetry.sourceLang };
          await chat.appendMessage(retagged).catch(() => undefined);
          setMessages((prev) =>
            prev.map((item) => (item.id === msg.id ? { ...item, sourceLang: retagged.sourceLang } : item))
          );
        }
        const merged = next;
        await chat.saveTranslations(msg.id, merged);
        setTranslations((prev) => ({ ...prev, [msg.id]: merged }));
      } catch {
        // Keep source visible; Retry stays if the pair is still empty/mismatched.
      } finally {
        translationRetry.remove(msg.id);
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
      ).filter((msg) => shouldTranslateMessage(msg) && !birkenRetry.has(msg.id));
      if (pending.length === 0) return;
      const pendingForSourceLang = pending.map((m) => {
        const mine = isChatSelf(user, m.authorId);
        if (mine) return { ...m, sourceLang: nativeLang };
        if (m.authorId === LEARNING_BOT_USER_ID || m.kind === 'ai') {
          return { ...m, sourceLang: learningLang };
        }
        return m;
      });
      for (const msg of pending) birkenRetry.add(msg.id);
      try {
        const { translationsByMessage, errors } = await recalculateBirkenbihlForThread({
          messages: pendingForSourceLang,
          translationsByMessage: translationsRef.current,
          asymmetric: (msg) =>
            asymmetricFor(msg, {
              native: nativeLang,
              learning: learningLang,
              partnerLearning: partnerLearningLang,
            }),
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
        for (const msg of pending) birkenRetry.remove(msg.id);
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
          asymmetricFor(msg, langs);
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

  const applySnapshot = (snapshot: ThreadSnapshot | undefined, mergePending: boolean) => {
    if (!snapshot || snapshot.redirectTo) {
      if (!mergePending) {
        setConversation(null);
        setMessages([]);
        setTranslations({});
        setHiddenIds(new Set());
      }
      return;
    }
    const conv = snapshot.conversation;
    setConversation(conv);
    setHiddenIds(new Set(snapshot.hiddenIds));
    setBotReplies(conv?.aiEnabled !== false);
    const participant = conv?.participants.find((p) => (user ? isChatSelf(user, p.userId) : false));
    const receiverId = conv && user ? otherParticipantId(conv, selfIds) : undefined;
    const receiver = conv?.participants.find((p) => p.userId === receiverId);
    if (participant) {
      setNativeLang(participant.nativeLang);
      setLearningLang(participant.learningLang);
    }
    if (receiver) setPartnerLearningLang(receiver.learningLang);
    setMessages((prev) => {
      if (!mergePending) return snapshot.messages;
      const pending = prev.filter(
        (item) =>
          inFlight.current.has(item.id) && !snapshot.messages.some((stored) => stored.id === item.id)
      );
      return upsertMessages(snapshot.messages, ...pending);
    });
    setTranslations((prev) =>
      mergePending ? mergeTranslationMaps(prev, snapshot.translations) : snapshot.translations
    );
  };

  if (boundId !== conversationId) {
    setBoundId(conversationId);
    translationRetry.clear();
    birkenRetry.clear();
    translating.clear();
    const cached =
      threadQuery.data && threadQuery.data.activeId === conversationId && !threadQuery.data.redirectTo
        ? threadQuery.data
        : queryClient.getQueryData<ThreadSnapshot>(queryKeys.thread(conversationId, threadUserId));
    applySnapshot(
      cached && cached.activeId === conversationId && !cached.redirectTo ? cached : undefined,
      false
    );
  }

  useEffect(() => {
    if (threadQuery.data?.redirectTo) {
      router.replace(chatHref(threadQuery.data.redirectTo));
    }
  }, [threadQuery.data?.redirectTo, router]);

  useEffect(() => {
    if (!threadQuery.isFetchedAfterMount) return;
    if (threadQuery.data?.hadUnread) bumpFriends();
  }, [
    threadQuery.dataUpdatedAt,
    threadQuery.isFetchedAfterMount,
    threadQuery.data?.hadUnread,
    bumpFriends,
  ]);

  useEffect(() => {
    const snapshot = threadQuery.data;
    if (!snapshot || snapshot.redirectTo) return;
    if (snapshot.activeId !== conversationId) return;
    applySnapshot(snapshot, true);
    // applySnapshot closes over inFlight / langs; dataUpdatedAt is the fetch signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadQuery.dataUpdatedAt, conversationId]);

  useEffect(() => {
    return chat.subscribe(conversationId, (next) => {
      setMessages((prev) => {
        const pending = prev.filter(
          (item) => inFlight.current.has(item.id) && !next.some((stored) => stored.id === item.id)
        );
        return upsertMessages(next, ...pending);
      });
      queryClient.setQueryData<ThreadSnapshot>(
        queryKeys.thread(conversationId, threadUserId),
        (old) => (old ? { ...old, messages: upsertMessages(next) } : old)
      );
      void (async () => {
        if (chatUserId) {
          await chat.markConversationRead(conversationId, selfIds.length > 0 ? selfIds : [chatUserId]);
          bumpFriends();
        }
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
  }, [chat, conversationId, chatUserId, selfIds, bumpFriends, queryClient, threadUserId]);

  /** The Bot answers in the learner's target language; the reply is stored like any other message. */
  const replyAsBot = async (threadId: string, learnerMessage: SourceMessage, learnerId: string) => {
    const saved = learnerMessage;
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
          receiverUserId: learnerId,
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
  };

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
    translating.add(optimistic.id);
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
      translating.remove(optimistic.id);
      return;
    }

    if (!thread) {
      thread = conversationId ? await chat.getConversation(conversationId) : null;
      threadId = thread?.id ?? conversationId;
    }
    if (!thread) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, receipt: 'failed' } : m))
      );
      setSendError("Couldn't open this chat.");
      inFlight.current.delete(optimistic.id);
      translating.remove(optimistic.id);
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

      try {
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
      } finally {
        translating.remove(saved.id);
      }
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
            url: chatHref(threadId),
            data: { conversationId: threadId },
            tag: `send-fail:${threadId}`,
          });
        }
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      inFlight.current.delete(optimistic.id);
      translating.remove(optimistic.id);
      return;
    }

    if (
      shouldAutoReplyFromSendInput(input.type, {
        botReplies,
        talkingToBot: isLearningBotConversation(thread),
        isMediaMessage: isMediaMessage(saved),
      })
    ) {
      await replyAsBot(threadId, saved, chatUserId ?? user.id);
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

  const removeMessage = async (scope: 'me' | 'everyone') => {
    const target = deleteTarget;
    if (!target || !chatUserId) return;
    setDeleteTarget(null);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // web / missing haptics
    }
    if (scope === 'me') {
      setHiddenIds((prev) => new Set(prev).add(target.id));
    } else {
      setMessages((prev) =>
        prev.map((item) => (item.id === target.id ? tombstoneMessage(item) : item))
      );
    }
    try {
      const result = await chat.deleteMessage({
        messageId: target.id,
        conversationId,
        actorId: chatUserId,
        scope,
        viewerIds: selfIds,
      });
      if (scope === 'everyone' && result) {
        setMessages((prev) => prev.map((item) => (item.id === result.id ? result : item)));
        const record = await historyStore.get(target.id);
        if (record) {
          await historyStore.save({ ...record, message: result });
        }
      }
    } catch (caught) {
      if (scope === 'me') {
        setHiddenIds((prev) => {
          const next = new Set(prev);
          next.delete(target.id);
          return next;
        });
      } else {
        setMessages((prev) => prev.map((item) => (item.id === target.id ? target : item)));
      }
      setSendError(caught instanceof Error ? caught.message : 'Could not delete message');
    }
  };

  const fetchingThread =
    !conversationId ||
    boundId !== conversationId ||
    (threadQuery.isLoading && !threadQuery.data);

  return {
    user,
    selfIds,
    partnerId,
    aiBackend,
    conversation,
    headerConversation,
    isBotChat,
    partnerCard,
    presenceLabel,
    pipelineLabel,
    fetchingThread,
    messages,
    visibleMessages,
    translations,
    viewpoint,
    mode,
    setMode,
    botReplies,
    setBotReplies,
    nativeLang,
    learningLang,
    partnerLearningLang,
    persistNative,
    persistLearning,
    persistPartner,
    streamingId,
    sendError,
    translatingIds,
    translationRetryIds,
    birkenRetryIds,
    birkenBusy: birkenRetryIds.length > 0,
    replyTo,
    setReplyTo,
    deleteTarget,
    setDeleteTarget,
    send,
    retryTranslation,
    runBirkenbihlRecalc,
    removeMessage,
  };
}
