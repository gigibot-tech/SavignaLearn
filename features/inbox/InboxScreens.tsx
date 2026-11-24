/**
 * Chats home.
 *
 * - Phone: toolbar + grid of conversations (`InboxScreen`).
 * - Desktop: the chat list lives in the shell's persistent pane (see AppShell), so the
 *   home route only has to welcome you into a chat (`DesktopWelcome`).
 * - Brand-new account with no chats: a guided first-run instead of a blank grid (`InboxEmptyHome`).
 */

import React, { useCallback, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { LEARNING_BOT_DISPLAY_NAME, type InboxItem } from '@/domain';
import { ensureLearningBotChat } from '@/adapters/chat';
import { currentFriendShareUrl, publicHandleCopyValue, publicHandleForUser } from '@/adapters/friends';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { chatHref } from '@/adapters/postLogin';
import type { ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { SavignasBoiAvatar } from '@/features/chat/avatars';
import { GlassPanel, GradientCta, GradientScreen, SlayGif, useThemeColors } from '@/features/chat/chatUi';
import {
  ChatGrid,
  InboxFooter,
  InboxSkeleton,
  InboxToolbar,
  useInboxFilters,
  useInboxItems,
  useInboxLayout,
} from '@/features/inbox/InboxUi';
import { TippedVocabHome } from '@/features/vocabulary/vocabularyUi';
import { useDesktopShell } from '@/features/shell/AppShell';

/* ------------------------------------------------------------ shared bits */

/** Open (creating if needed) the learner's Bot chat. */
function useOpenBot(refresh: () => Promise<void>) {
  const { chat } = useServices();
  const { user } = useAuthState();
  return useCallback(async () => {
    if (!user) return;
    const id = await ensureLearningBotChat(chat, chatPersistenceUserId(user), chatActorIds(user));
    await refresh();
    router.push(chatHref(id));
  }, [chat, user, refresh]);
}

/** Copy-my-handle and share-invite-link, with the "Copied" confirmation. */
function useInvite() {
  const { user } = useAuthState();
  const [copied, setCopied] = useState(false);

  const handle = user ? publicHandleCopyValue(user) : 'SavignaLearner';
  const identityIsEmail = handle.includes('@');
  const inviteUrl =
    user && identityIsEmail
      ? currentFriendShareUrl(user.id)
      : `https://savignalearn.app/u/${encodeURIComponent(handle)}`;

  const copy = async () => {
    await Clipboard.setStringAsync(handle);
    setCopied(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 1600);
  };
  const share = () =>
    Share.share({
      message: `Practice languages with me on SavignaLearn — ${inviteUrl}`,
      url: inviteUrl,
    });

  return {
    label: user ? publicHandleForUser(user) : handle,
    kind: identityIsEmail ? ('email' as const) : ('username' as const),
    copied,
    copy,
    share,
  };
}

/* ----------------------------------------------------------------- screen */

export function InboxScreen() {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const desktop = useDesktopShell();
  const { width } = useWindowDimensions();
  const { items, loading, refresh } = useInboxItems();
  const [layout, setLayout] = useInboxLayout();
  const { query, setQuery, filter, setFilter, visible, unreadChats, filtering } = useInboxFilters(items);
  const openBot = useOpenBot(refresh);
  const invite = useInvite();

  // Chats can change while another screen is on top (new message, friend accepted).
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (desktop) return <DesktopWelcome colors={colors} onOpenBot={() => void openBot()} />;

  if (loading) {
    return (
      <GradientScreen scheme={scheme}>
        <InboxSkeleton colors={colors} width={width} />
      </GradientScreen>
    );
  }

  if (items.length === 0) {
    return (
      <GradientScreen scheme={scheme}>
        <InboxEmptyHome
          colors={colors}
          invite={invite}
          onOpenBot={() => void openBot()}
          onFindFriends={() => router.push('/friends')}
        />
      </GradientScreen>
    );
  }

  const openChat = (item: InboxItem) => router.push(chatHref(item.id));
  const findFriends = () => router.push('/friends');

  return (
    <GradientScreen scheme={scheme}>
      <InboxToolbar
        colors={colors}
        title="Chats"
        titleAccessory={<SlayGif size={30} />}
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={setFilter}
        unreadChats={unreadChats}
        layout={layout}
        onLayoutChange={setLayout}
        onNewChat={findFriends}
      />
      <ChatGrid
        items={visible}
        layout={layout}
        width={width}
        colors={colors}
        onOpen={openChat}
        emptyText={filtering ? 'No chats match.' : undefined}
        footer={filtering ? null : <InboxFooter colors={colors} onNewChat={findFriends} />}
      />
    </GradientScreen>
  );
}

/* --------------------------------------------------------- desktop welcome */

function DesktopWelcome({ colors, onOpenBot }: { colors: ThemeColors; onOpenBot: () => void }) {
  const scheme = useColorScheme();
  return (
    <GradientScreen scheme={scheme}>
      <View style={styles.welcome}>
        <View style={styles.welcomeArt}>
          <SlayGif size={72} />
          <SavignasBoiAvatar size={56} />
        </View>
        <Text style={[styles.welcomeTitle, { color: colors.text }]}>Pick a chat to start practising</Text>
        <Text style={[styles.welcomeBody, { color: colors.textMuted }]}>
          Your conversations stay on the left — switch any time, nothing closes.
        </Text>
        <View style={styles.welcomeCta}>
          <GradientCta label={`Chat with ${LEARNING_BOT_DISPLAY_NAME}`} onPress={onOpenBot} />
        </View>
        <Pressable onPress={() => router.push('/friends')} accessibilityRole="button" style={styles.welcomeLink}>
          <Text style={{ color: colors.accent, fontWeight: '800' }}>Find friends to practise with</Text>
        </Pressable>
      </View>
    </GradientScreen>
  );
}

/* ----------------------------------------------------------- first-run home */

/** A new account has no chats yet: invite someone, or practise with the Bot right away. */
function InboxEmptyHome({
  colors,
  invite,
  onOpenBot,
  onFindFriends,
}: {
  colors: ThemeColors;
  invite: ReturnType<typeof useInvite>;
  onOpenBot: () => void;
  onFindFriends: () => void;
}) {
  const identityName = invite.kind === 'email' ? 'Email' : 'Username';
  return (
    <View style={styles.emptyRoot}>
      <View style={styles.emptyTopBar}>
        <Text style={[styles.emptyBrand, { color: colors.text }]} accessibilityRole="header">
          SavignaLearn
        </Text>
        <Pressable
          onPress={onFindFriends}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Find friends"
          style={styles.emptyPlus}
        >
          <Ionicons name="add" size={28} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.emptyBody}>
        <Text style={[styles.emptyHeadline, { color: colors.text }]}>Start your first conversation</Text>
        <Text style={[styles.emptySubhead, { color: colors.textMuted }]}>
          {invite.kind === 'email'
            ? 'That username is shared — invite with your email, or chat in your languages line by line.'
            : 'Invite a partner with your username — chat in your languages, line by line.'}
        </Text>

        <Text style={[styles.emptyLabel, { color: colors.textMuted }]}>{identityName}</Text>
        <GlassPanel colors={colors} style={styles.usernameCard}>
          <Pressable
            onPress={() => void invite.copy()}
            accessibilityRole="button"
            accessibilityLabel={`${identityName} ${invite.label}. Tap to copy`}
            style={styles.usernamePress}
          >
            <Text style={[styles.username, { color: colors.text }]} numberOfLines={1}>
              {invite.label}
            </Text>
            <View style={[styles.copyPill, { backgroundColor: colors.accentSoft }]}>
              <Text style={[styles.copyPillText, { color: colors.accent }]}>
                {invite.copied ? 'Copied' : 'Tap to copy'}
              </Text>
            </View>
          </Pressable>
        </GlassPanel>

        <Pressable
          onPress={onOpenBot}
          accessibilityRole="button"
          accessibilityLabel={`Open ${LEARNING_BOT_DISPLAY_NAME}`}
        >
          <GlassPanel colors={colors} style={styles.botCard}>
            <View style={styles.botCopy}>
              <Text style={[styles.botTitle, { color: colors.text }]}>{LEARNING_BOT_DISPLAY_NAME}</Text>
              <Text style={[styles.botPreview, { color: colors.textMuted }]} numberOfLines={2}>
                Practice anytime — I reply in your learning language, line by line.
              </Text>
            </View>
            <View style={styles.botArt}>
              <SlayGif size={64} />
              <SavignasBoiAvatar size={56} />
            </View>
          </GlassPanel>
        </Pressable>
        <View style={styles.emptyVocab}>
          <TippedVocabHome colors={colors} />
        </View>
      </View>

      <View style={styles.emptyFooter}>
        <GradientCta label="Share invite link" onPress={() => void invite.share()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  welcomeArt: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  welcomeTitle: { fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  welcomeBody: { marginTop: 8, textAlign: 'center', maxWidth: 380, fontSize: 15, lineHeight: 22 },
  welcomeCta: { marginTop: 24, width: 260 },
  welcomeLink: { marginTop: 14, paddingHorizontal: 16, paddingVertical: 10 },

  emptyRoot: { flex: 1 },
  emptyTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 4,
    minHeight: 48,
  },
  emptyBrand: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  emptyPlus: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  emptyBody: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  emptyHeadline: { fontSize: 26, fontWeight: '800', textAlign: 'center', lineHeight: 32, letterSpacing: -0.4 },
  emptySubhead: { marginTop: 10, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 8 },
  emptyLabel: { marginTop: 32, marginBottom: 8, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  usernameCard: { minHeight: 96 },
  usernamePress: { paddingVertical: 22, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  username: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  copyPill: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  copyPillText: { fontSize: 12, fontWeight: '700' },
  botCard: { marginTop: 18, padding: 16, flexDirection: 'row', alignItems: 'center', minHeight: 92 },
  botCopy: { flex: 1, paddingRight: 12 },
  botTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  botPreview: { fontSize: 13, lineHeight: 18 },
  botArt: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emptyVocab: { marginTop: 20 },
  emptyFooter: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8 },
});
