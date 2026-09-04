/**
 * Friend / Bot profile: identity, chat stats, delete friend.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  conversationProfileStats,
  friendInconsistencyMessage,
  LEARNING_BOT_DISPLAY_NAME,
  LEARNING_BOT_USER_ID,
  isLearningBotConversation,
  type Conversation,
  type FriendRow,
  type PublicProfile,
  type SourceMessage,
} from '@/domain';
import { canonicalChatActorId } from '@/domain/friends';
import { findOrCreateDirectChat } from '@/adapters/friends';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { learningBotHref, routeParam } from '@/adapters/postLogin';
import { ensureLearningBotChat } from '@/adapters/chat';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { useFriendsQuery, useInboxQuery } from '@/features/query/useChatQueries';
import {
  GlassPanel,
  GradientCta,
  GradientScreen,
  SavignasBoiAvatar,
  useThemeColors,
} from '@/features/chat/chatUi';
import { useAppearance } from '@/features/shell/AppearanceProvider';

function formatDay(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ProfileScreen() {
  const rawId = useLocalSearchParams<{ id?: string | string[]; chat?: string | string[] }>();
  const userId = decodeURIComponent(routeParam(rawId.id, ''));
  const chatParam = rawId.chat ? routeParam(rawId.chat, '') : '';
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { pack } = useAppearance();
  const router = useRouter();
  const { chat, friends, learningItems, bumpFriends } = useServices();
  const { user } = useAuthState();
  const inboxQuery = useInboxQuery();
  const friendsQuery = useFriendsQuery();
  const selfIds = useMemo(() => (user ? chatActorIds(user) : []), [user?.id, user?.idoUserId]);
  const chatUserId = user ? chatPersistenceUserId(user) : undefined;

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [friend, setFriend] = useState<FriendRow | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<SourceMessage[]>([]);
  const [vocabCount, setVocabCount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const isBot = userId === LEARNING_BOT_USER_ID;

  const load = useCallback(async () => {
    if (!user || !chatUserId || !userId) return;
    if (friendsQuery.isLoading || inboxQuery.isLoading) return;
    const ids = [userId, canonicalChatActorId(userId)];
    const listed = await friends.listProfiles([...new Set(ids)]);
    const rows = friendsQuery.data ?? [];
    const row =
      rows.find(
        (item) => item.userId === userId || canonicalChatActorId(item.userId) === canonicalChatActorId(userId)
      ) ?? null;
    setFriend(row);
    setProfile(
      listed[0] ??
        (row
          ? {
              id: row.userId,
              username: row.username,
              displayName: row.displayName,
              email: row.email,
            }
          : isBot
            ? {
                id: LEARNING_BOT_USER_ID,
                username: 'bot',
                displayName: LEARNING_BOT_DISPLAY_NAME,
                email: '',
              }
            : null)
    );

    let conv: Conversation | null = chatParam ? await chat.getConversation(chatParam) : null;
    if (!conv && isBot) {
      const botId = await ensureLearningBotChat(chat, chatUserId, selfIds);
      conv = await chat.getConversation(botId);
    }
    if (!conv && row && !row.inconsistent) {
      conv = await findOrCreateDirectChat(
        chat,
        { id: chatUserId },
        { id: row.userId, username: row.username, displayName: row.displayName, email: row.email }
      );
    }
    if (!conv) {
      const inbox = inboxQuery.data ?? [];
      conv =
        inbox.find((item) =>
          isBot ? isLearningBotConversation(item) : item.participantIds.some((id) => ids.includes(id))
        ) ?? null;
    }
    setConversation(conv);
    const thread = conv ? await chat.listMessages(conv.id) : [];
    setMessages(thread);
    const vocab = await learningItems.listForUser(chatUserId);
    setVocabCount(
      conversationProfileStats({
        messages: thread,
        viewerIds: selfIds,
        conversationId: conv?.id ?? '',
        vocab,
      }).cards
    );
  }, [user, chatUserId, userId, chatParam, friends, chat, learningItems, selfIds, isBot, friendsQuery.data, friendsQuery.isLoading, inboxQuery.data, inboxQuery.isLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () =>
      conversationProfileStats({
        messages,
        viewerIds: selfIds,
        conversationId: conversation?.id ?? '',
        vocab: [],
      }),
    [messages, selfIds, conversation?.id]
  );

  const title = profile?.displayName ?? (isBot ? LEARNING_BOT_DISPLAY_NAME : 'Profile');
  const handle = isBot ? 'Practice partner' : friend?.handleLabel ?? profile?.email ?? '';
  const email = profile?.email ?? '';
  const showEmail = Boolean(email) && !isBot && !handle.includes(email);
  const canMessage = Boolean(conversation) && !friend?.inconsistent;
  const canDelete = friend?.kind === 'accepted' && !isBot;

  const openChat = () => {
    if (!conversation) return;
    router.push(learningBotHref(conversation.id));
  };

  const removeFriend = async () => {
    if (!user || !friend) return;
    setBusy(true);
    try {
      await friends.remove(user.id, friend.friendshipId);
      bumpFriends();
      setConfirmDelete(false);
      router.replace('/friends');
    } finally {
      setBusy(false);
    }
  };

  return (
    <GradientScreen scheme={scheme} edges={['top', 'left', 'right', 'bottom']}>
      <View style={[styles.top, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.accent} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>
          Profile
        </Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.hero}>
          {isBot ? (
            <SavignasBoiAvatar size={88} />
          ) : (
            <LinearGradient colors={[...pack.gradients.ctaSoft]} style={styles.avatar}>
              <Text style={[styles.avatarLetter, { color: colors.onSoft }]}>{title.slice(0, 1).toUpperCase()}</Text>
            </LinearGradient>
          )}
          <Text style={[styles.name, { color: colors.text }]}>{title}</Text>
          {handle ? <Text style={{ color: colors.textMuted, marginTop: 4 }}>{handle}</Text> : null}
          {showEmail ? (
            <Text style={{ color: colors.textMuted, marginTop: 2, fontSize: 13 }}>{email}</Text>
          ) : null}
          {friend?.inconsistent ? (
            <Text style={{ color: colors.danger, marginTop: 8, fontWeight: '700' }}>
              Inconsistent · {friendInconsistencyMessage(friend.inconsistency ?? 'not_found')}
            </Text>
          ) : null}
        </View>

        <View style={styles.stats}>
          <Stat colors={colors} label="Messages" value={String(stats.messageCount)} />
          <Stat colors={colors} label={isBot ? 'Bot replies' : 'From them'} value={String(stats.fromThem)} />
          <Stat colors={colors} label="Your messages" value={String(stats.fromYou)} />
          <Stat colors={colors} label="Photos" value={String(stats.photos)} />
          <Stat colors={colors} label="Vocab cards" value={String(vocabCount)} />
          <Stat
            colors={colors}
            label={isBot ? 'First practice' : 'Friends since'}
            value={formatDay(isBot ? stats.startedAt : friend?.createdAt ?? stats.startedAt)}
          />
        </View>

        {canMessage ? (
          <View style={{ marginTop: 8 }}>
            <GradientCta label="Message" onPress={openChat} />
          </View>
        ) : null}

        {canDelete ? (
          <Pressable
            onPress={() => setConfirmDelete(true)}
            accessibilityRole="button"
            accessibilityLabel={`Delete friend ${title}`}
            style={[styles.deleteBtn, { borderColor: colors.danger }]}
          >
            <Text style={{ color: colors.danger, fontWeight: '800' }}>Delete friend</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <Pressable style={styles.backdrop} onPress={() => setConfirmDelete(false)} accessibilityLabel="Close">
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation?.()}
          >
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Delete {title}?</Text>
            <Text style={{ color: colors.textMuted, paddingHorizontal: 16, lineHeight: 20 }}>
              You’ll unfriend them on both sides. The chat stays on this device until you hide it.
            </Text>
            <Pressable
              onPress={() => void removeFriend()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Confirm delete friend"
              style={styles.option}
            >
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 16 }}>
                {busy ? 'Deleting…' : 'Delete friend'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setConfirmDelete(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={styles.option}
            >
              <Text style={{ color: colors.textMuted, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </GradientScreen>
  );
}

function Stat({
  colors,
  label,
  value,
}: {
  colors: ReturnType<typeof useThemeColors>;
  label: string;
  value: string;
}) {
  return (
    <GlassPanel colors={colors} style={styles.statCard}>
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 6 }}>{value}</Text>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: { fontSize: 16, fontWeight: '800' },
  hero: { alignItems: 'center', paddingVertical: 12 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontWeight: '800', fontSize: 36 },
  name: { fontSize: 26, fontWeight: '800', marginTop: 14, letterSpacing: -0.4 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20, marginBottom: 16 },
  statCard: { width: '47%', flexGrow: 1, padding: 14 },
  deleteBtn: {
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  sheetTitle: { fontSize: 17, fontWeight: '800', paddingHorizontal: 16, marginBottom: 8 },
  option: { paddingHorizontal: 16, paddingVertical: 14, minHeight: 48, justifyContent: 'center' },
});
