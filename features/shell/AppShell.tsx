/**
 * Desktop shell: collapsible glass side column (chat + friends, no meetups).
 * Collapsed = icon rail; top-left expands the friend/chat list; selecting a
 * chat, friend, or Settings collapses again.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { learningBotHref, profileHref } from '@/adapters/postLogin';
import { conversationTitleFor, findOrCreateDirectChat, publicHandleForUser } from '@/adapters/friends';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { friendInconsistencyMessage, type FriendRow } from '@/domain/friends';
import type { Conversation } from '@/domain/chat';
import { badgeLabel } from '@/domain/unread';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { InboxRow, InboxSkeleton, SlayGif, useThemeColors } from '@/features/chat/chatUi';
import { WhatsAppImportControl } from '@/features/chat/WhatsAppImportModal';
import { isLearningBotConversation } from '@/domain';
import type { ThemeColors } from '@/constants/Colors';
import { useInboxLists } from '@/features/shell/useInboxLists';

export const DESKTOP_BREAKPOINT = 768;
/** Thread header inline chat settings (L/XL). Sidebar already visible at 768. */
export const WIDE_CHAT_BREAKPOINT = 1024;

const SIDEBAR_EXPANDED_WIDTH = 280;
const SIDEBAR_COLLAPSED_WIDTH = 64;

export function useDesktopShell() {
  const { width } = useWindowDimensions();
  return width >= DESKTOP_BREAKPOINT;
}

export function useWideChatChrome() {
  const { width } = useWindowDimensions();
  return width >= WIDE_CHAT_BREAKPOINT;
}

type ShellSection = 'chats' | 'friends' | 'settings';

type ShellContextValue = {
  desktop: boolean;
  section: ShellSection;
  sidebarExpanded: boolean;
  toggleSidebar: () => void;
  expandSidebar: () => void;
  collapseSidebar: () => void;
  unread: number;
  incoming: number;
};

const ShellContext = createContext<ShellContextValue>({
  desktop: false,
  section: 'chats',
  sidebarExpanded: false,
  toggleSidebar: () => {},
  expandSidebar: () => {},
  collapseSidebar: () => {},
  unread: 0,
  incoming: 0,
});

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
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const lists = useInboxLists();

  const toggleSidebar = useCallback(() => setSidebarExpanded((open) => !open), []);
  const expandSidebar = useCallback(() => setSidebarExpanded(true), []);
  const collapseSidebar = useCallback(() => setSidebarExpanded(false), []);

  const value = useMemo(
    () => ({
      desktop,
      section,
      sidebarExpanded,
      toggleSidebar,
      expandSidebar,
      collapseSidebar,
      unread: lists.unread,
      incoming: lists.incoming,
    }),
    [
      desktop,
      section,
      sidebarExpanded,
      toggleSidebar,
      expandSidebar,
      collapseSidebar,
      lists.unread,
      lists.incoming,
    ]
  );

  if (!desktop) {
    return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
  }

  return (
    <ShellContext.Provider value={value}>
      <View style={styles.row}>
        <FourSomeSidebar
          section={section}
          expanded={sidebarExpanded}
          conversations={lists.conversations}
          friendRows={lists.friendRows}
          unread={lists.unread}
          incoming={lists.incoming}
          loading={lists.loading}
          onToggle={toggleSidebar}
          onExpand={expandSidebar}
          onCollapse={collapseSidebar}
        />
        <View style={styles.main}>{children}</View>
      </View>
    </ShellContext.Provider>
  );
}

function FourSomeSidebar({
  section,
  expanded,
  conversations,
  friendRows,
  unread,
  incoming,
  loading,
  onToggle,
  onExpand,
  onCollapse,
}: {
  section: ShellSection;
  expanded: boolean;
  conversations: Conversation[];
  friendRows: FriendRow[];
  unread: number;
  incoming: number;
  loading?: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { auth, chat, friends, bumpFriends } = useServices();
  const { user } = useAuthState();

  const accepted = friendRows.filter((row) => row.kind === 'accepted');
  const username = user ? publicHandleForUser(user) : '';

  const openFriendChat = async (row: FriendRow) => {
    if (!user || row.inconsistent) return;
    const conv = await findOrCreateDirectChat(
      chat,
      { id: chatPersistenceUserId(user) },
      {
        id: row.userId,
        username: row.username,
        displayName: row.displayName,
        email: row.email,
      }
    );
    bumpFriends();
    onCollapse();
    router.push(learningBotHref(conv.id));
  };

  const openSection = (next: ShellSection, href: '/' | '/friends' | '/settings') => {
    if (next === 'settings') {
      onCollapse();
      router.push(href);
      return;
    }
    // Chats / Friends: expand the list panel so the user can pick a row.
    onExpand();
    router.push(href);
  };

  return (
    <View
      style={[
        styles.sidebar,
        {
          width: expanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
          borderColor: colors.border,
          backgroundColor: colors.headerGlass,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        accessibilityState={{ expanded }}
        style={styles.brandRow}
        hitSlop={8}
      >
        {expanded ? (
          <>
            <Text style={[styles.brand, { color: colors.text }]}>SavignaLearn</Text>
            <SlayGif size={32} />
            <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
          </>
        ) : (
          <View style={styles.collapsedToggle}>
            <Ionicons name="menu" size={22} color={colors.accent} />
          </View>
        )}
      </Pressable>

      {expanded ? (
        <Text style={{ color: colors.textMuted, fontSize: 12, paddingHorizontal: 16, marginBottom: 12 }}>
          Chat · Friends
        </Text>
      ) : null}

      <NavItem
        icon="chatbubbles-outline"
        label="Chats"
        active={section === 'chats'}
        badge={unread}
        collapsed={!expanded}
        colors={colors}
        onPress={() => openSection('chats', '/')}
      />
      <NavItem
        icon="people-outline"
        label="Friends"
        active={section === 'friends'}
        badge={incoming}
        collapsed={!expanded}
        colors={colors}
        onPress={() => openSection('friends', '/friends')}
      />
      <NavItem
        icon="settings-outline"
        label="Settings"
        active={section === 'settings'}
        collapsed={!expanded}
        colors={colors}
        onPress={() => openSection('settings', '/settings')}
      />

      {expanded ? (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {section === 'friends' ? (
            <ScrollView style={styles.list}>
              {accepted.length === 0 ? (
                <Text style={[styles.empty, { color: colors.textMuted }]}>
                  No friends yet — add someone by email or friend link.
                </Text>
              ) : (
                accepted.map((row) => (
                  <View key={row.friendshipId} style={[styles.friendHit, { borderColor: colors.border }]}>
                    <Pressable
                      onPress={() => {
                        onCollapse();
                        router.push(profileHref(row.userId));
                      }}
                      disabled={row.inconsistent}
                      style={{ flex: 1 }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        row.inconsistent ? `${row.displayName} inconsistent` : `Open ${row.displayName} profile`
                      }
                    >
                      <Text style={{ color: colors.text, fontWeight: '700' }}>{row.displayName}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{row.handleLabel}</Text>
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
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${row.displayName}`}
                      >
                        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>Delete</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => void openFriendChat(row)}
                        accessibilityRole="button"
                        accessibilityLabel={`Chat with ${row.displayName}`}
                      >
                        <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>Chat</Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          ) : (
            <ScrollView style={styles.list}>
              <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
                <WhatsAppImportControl colors={colors} label="Import WhatsApp" />
              </View>
              {loading && conversations.length === 0 ? (
                <InboxSkeleton colors={colors} />
              ) : (
                conversations.map((item) => (
                <InboxRow
                  key={item.id}
                  title={conversationTitleFor(item, user ? chatActorIds(user) : [], 'Chat')}
                  preview={item.lastMessagePreview}
                  time={relativeTime(item.updatedAt)}
                  unread={item.unreadCount}
                  muted={item.muted}
                  online
                  isBot={isLearningBotConversation(item)}
                  colors={colors}
                  onPress={() => {
                    onCollapse();
                    router.push(learningBotHref(item.id));
                  }}
                />
                ))
              )}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
              {username}
            </Text>
            <Pressable
              onPress={() => {
                onCollapse();
                router.replace('/');
                void auth.signOut();
              }}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>Sign out</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.collapsedSpacer} />
      )}
    </View>
  );
}

function NavItem({
  icon,
  label,
  active,
  badge,
  collapsed,
  colors,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  badge?: number;
  collapsed?: boolean;
  colors: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      style={[
        styles.navItem,
        collapsed && styles.navItemCollapsed,
        active && { backgroundColor: colors.accentSoft },
      ]}
    >
      <Ionicons name={icon} size={20} color={active ? colors.accent : colors.textMuted} />
      {collapsed ? null : (
        <Text style={{ color: colors.text, fontWeight: active ? '800' : '600', flex: 1 }}>{label}</Text>
      )}
      {!collapsed && badge ? (
        <View style={[styles.badge, { backgroundColor: colors.unread }]}>
          <Text style={styles.badgeText}>{badgeLabel(badge)}</Text>
        </View>
      ) : null}
      {collapsed && badge ? (
        <View style={[styles.collapsedBadge, { backgroundColor: colors.unread }]}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  sidebar: {
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: Platform.OS === 'web' ? 20 : 48,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  main: { flex: 1, minWidth: 0 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
    minHeight: 44,
  },
  collapsedToggle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  brand: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    flex: 1,
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
  navItemCollapsed: {
    marginHorizontal: 8,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10, marginHorizontal: 16 },
  list: { flex: 1, paddingHorizontal: 8 },
  empty: { paddingHorizontal: 12, paddingTop: 12, fontSize: 13, lineHeight: 18 },
  friendHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  collapsedSpacer: { flex: 1 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  collapsedBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
