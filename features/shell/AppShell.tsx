/**
 * App shell.
 *
 * Phone (< 768px): children fill the screen; the tab bar is the navigation.
 * Desktop / tablet (>= 768px), the same layout WhatsApp Web uses:
 *
 *   [ nav rail ][ chat list pane ][ open chat / friends / settings ]
 *
 * The rail and the chat pane never collapse, so switching chats is one click and the
 * conversation you are in stays highlighted. The pane only shows for the Chats section.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { publicHandleForUser } from '@/adapters/friends';
import { chatHref } from '@/adapters/postLogin';
import { badgeLabel } from '@/domain/inbox';
import type { ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState } from '@/features/chat/AppProviders';
import { PersonAvatar } from '@/features/chat/avatars';
import { SlayGif, useThemeColors } from '@/features/chat/chatUi';
import {
  ChatGrid,
  InboxFooter,
  InboxSkeleton,
  InboxToolbar,
  useInboxFilters,
  useInboxItems,
  useInboxLayout,
} from '@/features/inbox/InboxUi';
import { useOwnProfileQuery } from '@/features/query/useChatQueries';
import { useInboxLists } from '@/features/shell/useInboxLists';

export const DESKTOP_BREAKPOINT = 768;
/** Thread header shows chat settings inline from here up (the pane is already visible at 768). */
export const WIDE_CHAT_BREAKPOINT = 1024;

const RAIL_WIDTH = 76;
const PANE_MIN_WIDTH = 320;
const PANE_MAX_WIDTH = 460;

export function useDesktopShell() {
  const { width } = useWindowDimensions();
  return width >= DESKTOP_BREAKPOINT;
}

export function useWideChatChrome() {
  const { width } = useWindowDimensions();
  return width >= WIDE_CHAT_BREAKPOINT;
}

/** The pane takes about a third of the window, clamped so two tiles always fit and the chat keeps room. */
export function chatPaneWidth(windowWidth: number): number {
  return Math.min(PANE_MAX_WIDTH, Math.max(PANE_MIN_WIDTH, Math.round(windowWidth * 0.3)));
}

export type ShellSection = 'chats' | 'friends' | 'settings';

type ShellContextValue = {
  desktop: boolean;
  section: ShellSection;
  unread: number;
  incoming: number;
};

const ShellContext = createContext<ShellContextValue>({
  desktop: false,
  section: 'chats',
  unread: 0,
  incoming: 0,
});

export function useAppShell() {
  return useContext(ShellContext);
}

function sectionFromPath(pathname: string): ShellSection {
  if (pathname.includes('settings')) return 'settings';
  if (pathname.includes('friends')) return 'friends';
  return 'chats';
}

/** `/chat/abc` → `abc`; anything else → undefined. */
export function chatIdFromPath(pathname: string): string | undefined {
  const match = /^\/chat\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const desktop = useDesktopShell();
  const pathname = usePathname();
  const section = sectionFromPath(pathname);
  const lists = useInboxLists();

  const value = useMemo(
    () => ({ desktop, section, unread: lists.unread, incoming: lists.incoming }),
    [desktop, section, lists.unread, lists.incoming]
  );

  if (!desktop) {
    return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
  }

  return (
    <ShellContext.Provider value={value}>
      <View style={styles.row}>
        <NavRail section={section} unread={lists.unread} incoming={lists.incoming} />
        {section === 'chats' ? <ChatListPane activeId={chatIdFromPath(pathname)} /> : null}
        <View style={styles.main}>{children}</View>
      </View>
    </ShellContext.Provider>
  );
}

/* -------------------------------------------------------------- nav rail */

function NavRail({
  section,
  unread,
  incoming,
}: {
  section: ShellSection;
  unread: number;
  incoming: number;
}) {
  const colors = useThemeColors(useColorScheme());
  const insets = useSafeAreaInsets();
  const { user } = useAuthState();
  const ownProfile = useOwnProfileQuery();
  const handle = user ? publicHandleForUser(user) : 'You';

  return (
    <View
      style={[
        styles.rail,
        { paddingTop: Math.max(insets.top, 16), borderColor: colors.border, backgroundColor: colors.headerGlass },
      ]}
    >
      <View style={styles.railBrand}>
        <SlayGif size={44} />
      </View>
      <RailItem
        icon="chatbubbles"
        label="Chats"
        active={section === 'chats'}
        badge={unread}
        colors={colors}
        onPress={() => router.push('/')}
      />
      <RailItem
        icon="people"
        label="Friends"
        active={section === 'friends'}
        badge={incoming}
        colors={colors}
        onPress={() => router.push('/friends')}
      />
      <RailItem
        icon="settings"
        label="Settings"
        active={section === 'settings'}
        colors={colors}
        onPress={() => router.push('/settings')}
      />
      <View style={styles.railSpacer} />
      <Pressable
        onPress={() => router.push('/settings')}
        accessibilityRole="button"
        accessibilityLabel={`${handle} — open profile settings`}
        style={styles.railAvatar}
      >
        <PersonAvatar size={36} name={handle.replace(/^@/, '')} photoUrl={ownProfile.data?.photoUrl} online showPresence />
      </Pressable>
    </View>
  );
}

function RailItem({
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
  const count = badgeLabel(badge ?? 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count ? `${label}, ${count} new` : label}
      style={[styles.railItem, active && { backgroundColor: colors.accentSoft }]}
    >
      <View>
        <Ionicons name={icon} size={22} color={active ? colors.accent : colors.textMuted} />
        {count ? (
          <View style={[styles.railBadge, { backgroundColor: colors.unread }]}>
            <Text style={[styles.railBadgeText, { color: colors.onAccent }]}>{count}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.railLabel, { color: active ? colors.accent : colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------- chat pane */

function ChatListPane({ activeId }: { activeId?: string }) {
  const colors = useThemeColors(useColorScheme());
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const width = chatPaneWidth(windowWidth);
  const { items, loading } = useInboxItems();
  const [layout, setLayout] = useInboxLayout();
  const { query, setQuery, filter, setFilter, visible, unreadChats, filtering } = useInboxFilters(items);

  const openChat = (id: string) => {
    // Already inside a chat: swap it in place so the back stack does not grow with every click.
    if (activeId) router.replace(chatHref(id));
    else router.push(chatHref(id));
  };
  const findFriends = () => router.push('/friends');

  return (
    <View
      style={[
        styles.pane,
        { width, paddingTop: Math.max(insets.top, 8), borderColor: colors.border, backgroundColor: colors.headerGlass },
      ]}
    >
      <InboxToolbar
        colors={colors}
        title="Chats"
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={setFilter}
        unreadChats={unreadChats}
        layout={layout}
        onLayoutChange={setLayout}
        onNewChat={findFriends}
      />
      {loading ? (
        <InboxSkeleton colors={colors} width={width} />
      ) : (
        <ChatGrid
          items={visible}
          layout={layout}
          width={width}
          colors={colors}
          activeId={activeId}
          onOpen={(item) => openChat(item.id)}
          emptyText={filtering ? 'No chats match.' : undefined}
          footer={filtering ? null : <InboxFooter colors={colors} onNewChat={findFriends} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },

  rail: {
    width: RAIL_WIDTH,
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    paddingBottom: 16,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  railBrand: { marginBottom: 10, borderRadius: 12, overflow: 'hidden' },
  railItem: {
    width: 60,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 8,
    borderRadius: 14,
  },
  railLabel: { fontSize: 11, fontWeight: '700' },
  railBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBadgeText: { fontSize: 10, fontWeight: '800' },
  railSpacer: { flex: 1 },
  railAvatar: { padding: 4 },

  pane: {
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});
