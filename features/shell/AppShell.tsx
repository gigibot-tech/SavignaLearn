/**
 * Desktop shell copied from fourSome web: 280px glass side column, ember gradient.
 * Chat + Friends only — no meetups.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { learningBotHref } from '@/adapters/postLogin';
import { ensureLearningBotChat } from '@/adapters/chat';
import { findOrCreateDirectChat, usernameFromUser } from '@/adapters/friends';
import { friendInconsistencyMessage, type FriendRow } from '@/domain/friends';
import type { Conversation } from '@/domain/chat';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { InboxRow, SlayGif, useThemeColors } from '@/features/chat/chatUi';
import { isLearningBotConversation } from '@/domain';
import type { ThemeColors } from '@/constants/Colors';

export const DESKTOP_BREAKPOINT = 768;
/** Thread header inline chat settings (L/XL). Sidebar already visible at 768. */
export const WIDE_CHAT_BREAKPOINT = 1024;

export function useDesktopShell() {
  const { width } = useWindowDimensions();
  return width >= DESKTOP_BREAKPOINT;
}

export function useWideChatChrome() {
  const { width } = useWindowDimensions();
  return width >= WIDE_CHAT_BREAKPOINT;
}

type ShellSection = 'chats' | 'friends' | 'settings';

const ShellContext = createContext({ desktop: false, section: 'chats' as ShellSection });

export function useAppShell() {
  return useContext(ShellContext);
}

export function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(delta / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function sectionFromPath(pathname: string): ShellSection {
  if (pathname.includes('settings')) return 'settings';
  if (pathname.includes('friends')) return 'friends';
  return 'chats';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const desktop = useDesktopShell();
  const pathname = usePathname();
  const section = sectionFromPath(pathname);
  const value = useMemo(() => ({ desktop, section }), [desktop, section]);

  if (!desktop) {
    return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
  }

  return (
    <ShellContext.Provider value={value}>
      <View style={styles.row}>
        <FourSomeSidebar section={section} pathname={pathname} />
        <View style={styles.main}>{children}</View>
      </View>
    </ShellContext.Provider>
  );
}

function FourSomeSidebar({ section, pathname }: { section: ShellSection; pathname: string }) {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { auth, chat, friends, friendsTick, bumpFriends } = useServices();
  const { user } = useAuthState();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friendRows, setFriendRows] = useState<FriendRow[]>([]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await ensureLearningBotChat(chat, user.id);
      setConversations(await chat.listConversations(user.id));
    })();
  }, [chat, user, pathname, friendsTick]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setFriendRows(await friends.reconcile(user.id));
    })();
  }, [friends, user, friendsTick, pathname]);

  const incoming = friendRows.filter((row) => row.kind === 'incoming').length;
  const accepted = friendRows.filter((row) => row.kind === 'accepted');
  const username = user ? usernameFromUser(user) : '';

  const openFriendChat = async (row: FriendRow) => {
    if (!user || row.inconsistent) return;
    const conv = await findOrCreateDirectChat(chat, { id: user.id }, {
      id: row.userId,
      username: row.username,
      displayName: row.displayName,
      email: row.email,
    });
    bumpFriends();
    router.push(learningBotHref(conv.id));
  };

  return (
    <View style={[styles.sidebar, { borderColor: colors.border, backgroundColor: colors.headerGlass }]}>
      <View style={styles.brandRow}>
        <Text style={[styles.brand, { color: colors.text }]}>SavignaLearn</Text>
        <SlayGif size={32} />
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 12, paddingHorizontal: 16, marginBottom: 12 }}>
        Chat · Friends
      </Text>

      <NavItem
        icon="chatbubbles-outline"
        label="Chats"
        active={section === 'chats'}
        colors={colors}
        onPress={() => router.push('/')}
      />
      <NavItem
        icon="people-outline"
        label="Friends"
        active={section === 'friends'}
        badge={incoming}
        colors={colors}
        onPress={() => router.push('/friends')}
      />
      <NavItem
        icon="settings-outline"
        label="Settings"
        active={section === 'settings'}
        colors={colors}
        onPress={() => router.push('/settings')}
      />

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {section === 'friends' ? (
        <ScrollView style={styles.list}>
          {accepted.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>No friends yet — add someone by email or friend link.</Text>
          ) : (
            accepted.map((row) => (
              <View
                key={row.friendshipId}
                style={[styles.friendHit, { borderColor: colors.border }]}
              >
                <Pressable
                  onPress={() => void openFriendChat(row)}
                  disabled={row.inconsistent}
                  accessibilityRole="button"
                  accessibilityLabel={
                    row.inconsistent ? `${row.displayName} inconsistent` : `Chat with ${row.displayName}`
                  }
                >
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{row.displayName}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>@{row.username}</Text>
                  {row.email ? (
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>{row.email}</Text>
                  ) : null}
                  {row.inconsistent ? (
                    <Text style={{ color: colors.danger, fontSize: 11, marginTop: 4, fontWeight: '700' }}>
                      Inconsistent · {friendInconsistencyMessage(row.inconsistency ?? 'not_found')}
                    </Text>
                  ) : null}
                </Pressable>
                {row.inconsistent ? (
                  <Pressable
                    onPress={() =>
                      void friends.remove(user!.id, row.friendshipId).then(() => bumpFriends())
                    }
                    style={{ marginTop: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${row.displayName}`}
                  >
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>Delete</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      ) : (
        <ScrollView style={styles.list}>
          {conversations.map((item) => (
            <InboxRow
              key={item.id}
              title={item.title ?? 'Chat'}
              preview={item.lastMessagePreview}
              time={relativeTime(item.updatedAt)}
              unread={item.unreadCount}
              muted={item.muted}
              online
              isBot={isLearningBotConversation(item)}
              colors={colors}
              onPress={() => router.push(learningBotHref(item.id))}
            />
          ))}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
          @{username}
        </Text>
        <Pressable
          onPress={() => {
            router.replace('/');
            void auth.signOut();
          }}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NavItem({
  icon,
  label,
  active,
  badge,
  colors,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  badge?: number;
  colors: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge ? `${label}, ${badge} requests` : label}
      style={[
        styles.navItem,
        active && { backgroundColor: colors.accentSoft },
      ]}
    >
      <Ionicons name={icon} size={20} color={active ? colors.accent : colors.textMuted} />
      <Text style={{ color: colors.text, fontWeight: active ? '800' : '600', flex: 1 }}>{label}</Text>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.unread }]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  sidebar: {
    width: 280,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: Platform.OS === 'web' ? 20 : 48,
    paddingBottom: 16,
  },
  main: { flex: 1, minWidth: 0 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 16,
    marginBottom: 4,
  },
  brand: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10, marginHorizontal: 16 },
  list: { flex: 1, paddingHorizontal: 8 },
  empty: { paddingHorizontal: 12, paddingTop: 12, fontSize: 13, lineHeight: 18 },
  friendHit: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 6,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
