/**
 * Inbox presentation shared by the phone screen and the desktop chat pane:
 * - `useInboxItems`   turns raw conversations into what the inbox shows (name, photo, presence)
 * - `ChatGrid`        multi-column tiles (default) or the classic one-per-row list
 * - `InboxToolbar`    title, search, filter chips, grid/list switch, new chat
 * - `InboxFooter`     secondary actions that used to crowd the top of the screen
 *
 * Nothing here knows about routing or the shell — screens pass `onOpen` in.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  INBOX_FILTERS,
  badgeLabel,
  cardIsOnline,
  conversationPartnerIds,
  filterInboxItems,
  inboxGridColumns,
  inboxTimestamp,
  isLearningBotConversation,
  LEARNING_BOT_USER_ID,
  otherParticipantId,
  profileCardFor,
  type Conversation,
  type InboxFilter,
  type InboxItem,
  type ProfileCard,
} from '@/domain';
import { conversationTitleFor } from '@/adapters/friends';
import { chatActorIds } from '@/adapters/identity';
import type { ThemeColors } from '@/constants/Colors';
import { PersonAvatar } from '@/features/chat/avatars';
import { SkeletonBar, useSkeletonPulse } from '@/features/chat/chatUi';
import { WhatsAppImportControl } from '@/features/chat/WhatsAppImportModal';
import { useAuthState } from '@/features/chat/AppProviders';
import { queryKeys } from '@/features/query/queryKeys';
import { useInboxQuery, useProfileCardsQuery } from '@/features/query/useChatQueries';
import { TippedVocabHome } from '@/features/vocabulary/vocabularyUi';

export const GRID_GAP = 8;
export const GRID_PADDING = 12;

/* ------------------------------------------------------------------ data */

export function toInboxItem(
  conversation: Conversation,
  selfIds: string[],
  cards: Map<string, ProfileCard>
): InboxItem {
  const isBot = isLearningBotConversation(conversation);
  const partnerId = isBot ? LEARNING_BOT_USER_ID : otherParticipantId(conversation, selfIds);
  const card = profileCardFor(cards, partnerId);
  return {
    id: conversation.id,
    title: conversationTitleFor(conversation, selfIds, 'Chat'),
    preview: conversation.lastMessagePreview,
    updatedAt: conversation.updatedAt,
    unread: conversation.unreadCount,
    muted: Boolean(conversation.muted),
    isBot,
    online: cardIsOnline(card),
    photoUrl: card?.photoUrl,
  };
}

/** The signed-in user's chats, resolved for display. One place, used by every inbox surface. */
export function useInboxItems() {
  const { user, ready } = useAuthState();
  const queryClient = useQueryClient();
  const inboxQuery = useInboxQuery();
  const conversations = inboxQuery.data;
  const selfIds = useMemo(() => (user ? chatActorIds(user) : []), [user?.id, user?.idoUserId]);
  const partnerIds = useMemo(
    () => conversationPartnerIds(conversations ?? [], selfIds),
    [conversations, selfIds]
  );
  const cards = useProfileCardsQuery(partnerIds);

  const items = useMemo(
    () => (conversations ?? []).map((conversation) => toInboxItem(conversation, selfIds, cards.map)),
    [conversations, selfIds, cards.map]
  );
  const refresh = useCallback(async () => {
    if (user) await queryClient.invalidateQueries({ queryKey: queryKeys.inbox(user.id) });
  }, [queryClient, user]);

  return {
    items,
    loading: !ready || (Boolean(user) && inboxQuery.isLoading && conversations === undefined),
    refresh,
  };
}

export type InboxLayout = 'grid' | 'list';
const LAYOUT_STORAGE_KEY = 'savignalearn.inbox.layout';

/** Grid by default; the user's choice sticks across launches. */
export function useInboxLayout(): [InboxLayout, (next: InboxLayout) => void] {
  const [layout, setLayout] = useState<InboxLayout>('grid');

  useEffect(() => {
    AsyncStorage.getItem(LAYOUT_STORAGE_KEY)
      .then((saved) => {
        if (saved === 'grid' || saved === 'list') setLayout(saved);
      })
      .catch(() => undefined);
  }, []);

  const choose = useCallback((next: InboxLayout) => {
    setLayout(next);
    AsyncStorage.setItem(LAYOUT_STORAGE_KEY, next).catch(() => undefined);
  }, []);

  return [layout, choose];
}

/** Search + chip state, with the filtering applied. */
export function useInboxFilters(items: InboxItem[]) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const visible = useMemo(
    () => filterInboxItems(items, { query: debounced, filter }),
    [items, debounced, filter]
  );
  const unreadChats = useMemo(() => items.filter((item) => item.unread > 0).length, [items]);

  return { query, setQuery, filter, setFilter, visible, unreadChats, filtering: Boolean(debounced.trim()) || filter !== 'all' };
}

/* --------------------------------------------------------------- toolbar */

export function InboxToolbar({
  colors,
  title,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  unreadChats,
  layout,
  onLayoutChange,
  onNewChat,
  titleAccessory,
}: {
  colors: ThemeColors;
  title: string;
  query: string;
  onQueryChange: (value: string) => void;
  filter: InboxFilter;
  onFilterChange: (value: InboxFilter) => void;
  unreadChats: number;
  layout: InboxLayout;
  onLayoutChange: (value: InboxLayout) => void;
  onNewChat: () => void;
  titleAccessory?: React.ReactNode;
}) {
  return (
    <View style={styles.toolbar}>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {title}
          </Text>
          {titleAccessory}
        </View>
        <View style={styles.titleActions}>
          <IconButton
            colors={colors}
            icon={layout === 'grid' ? 'list-outline' : 'grid-outline'}
            label={layout === 'grid' ? 'Show chats as a list' : 'Show chats as a grid'}
            onPress={() => onLayoutChange(layout === 'grid' ? 'list' : 'grid')}
          />
          <IconButton colors={colors} icon="add" label="New chat" filled onPress={onNewChat} />
        </View>
      </View>

      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search chats"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search conversations"
          style={[styles.searchInput, { color: colors.text }]}
        />
        {query ? (
          <Pressable onPress={() => onQueryChange('')} accessibilityLabel="Clear search" hitSlop={10}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.chips}>
        {INBOX_FILTERS.map(({ id, label }) => {
          const selected = filter === id;
          const count = id === 'unread' && unreadChats > 0 ? ` ${unreadChats}` : '';
          return (
            <Pressable
              key={id}
              onPress={() => onFilterChange(id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.accent : colors.surface,
                  borderColor: selected ? colors.accent : colors.border,
                },
              ]}
            >
              <Text style={{ color: selected ? colors.onAccent : colors.text, fontWeight: '700', fontSize: 13 }}>
                {label}
                {count}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function IconButton({
  colors,
  icon,
  label,
  onPress,
  filled,
}: {
  colors: ThemeColors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  filled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={[
        styles.iconButton,
        { backgroundColor: filled ? colors.accent : colors.surface, borderColor: filled ? colors.accent : colors.border },
      ]}
    >
      <Ionicons name={icon} size={filled ? 22 : 18} color={filled ? colors.onAccent : colors.accent} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ grid */

export function ChatGrid({
  items,
  layout,
  width,
  colors,
  activeId,
  onOpen,
  header,
  footer,
  emptyText,
}: {
  items: InboxItem[];
  layout: InboxLayout;
  /** Width available to the grid, so tiles can be sized exactly (FlatList rows do not stretch). */
  width: number;
  colors: ThemeColors;
  activeId?: string;
  onOpen: (item: InboxItem) => void;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  emptyText?: string;
}) {
  const columns = layout === 'grid' ? inboxGridColumns(width, { gap: GRID_GAP, padding: GRID_PADDING }) : 1;
  const tileWidth = Math.floor((width - GRID_PADDING * 2 - GRID_GAP * (columns - 1)) / columns);

  return (
    <FlatList
      // numColumns cannot change on a mounted FlatList, so a new layout/column count is a new list.
      key={`${layout}-${columns}`}
      data={items}
      numColumns={columns}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
      contentContainerStyle={layout === 'list' ? styles.listContent : styles.gridContent}
      ItemSeparatorComponent={layout === 'grid' ? GridRowGap : undefined}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        emptyText ? <Text style={[styles.empty, { color: colors.textMuted }]}>{emptyText}</Text> : null
      }
      renderItem={({ item }) =>
        layout === 'grid' ? (
          <ConversationTile
            item={item}
            colors={colors}
            width={tileWidth}
            active={item.id === activeId}
            onPress={() => onOpen(item)}
          />
        ) : (
          <ConversationRow item={item} colors={colors} active={item.id === activeId} onPress={() => onOpen(item)} />
        )
      }
    />
  );
}

function GridRowGap() {
  return <View style={{ height: GRID_GAP }} />;
}

function itemLabel(item: InboxItem): string {
  return `${item.title}${item.unread ? `, ${item.unread} unread` : ''}`;
}

/** Avatar-first card: you can scan many people at a glance. */
export function ConversationTile({
  item,
  colors,
  width,
  active,
  onPress,
}: {
  item: InboxItem;
  colors: ThemeColors;
  width: number;
  active?: boolean;
  onPress: () => void;
}) {
  const hasUnread = item.unread > 0;
  const highlighted = hasUnread || active;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={itemLabel(item)}
      accessibilityState={{ selected: Boolean(active) }}
      style={({ pressed }) => [
        styles.tile,
        {
          width,
          backgroundColor: active ? colors.accentSoft : colors.surface,
          borderColor: highlighted ? colors.accent : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.tileHead}>
        <PersonAvatar
          size={40}
          name={item.title}
          photoUrl={item.photoUrl}
          isBot={item.isBot}
          online={item.online}
          showPresence={item.online}
        />
        <View style={styles.tileTitles}>
          <Text
            style={[styles.tileName, { color: colors.text, fontWeight: hasUnread ? '700' : '600' }]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={[styles.time, { color: hasUnread ? colors.accent : colors.textMuted }]}>
            {inboxTimestamp(item.updatedAt)}
          </Text>
        </View>
        <UnreadMark item={item} colors={colors} />
      </View>
      <Text
        style={[styles.tilePreview, { color: hasUnread ? colors.text : colors.textMuted }]}
        numberOfLines={2}
      >
        {item.preview ?? ' '}
      </Text>
    </Pressable>
  );
}

/** The classic one-chat-per-row layout, kept for people who prefer it. */
export function ConversationRow({
  item,
  colors,
  active,
  onPress,
}: {
  item: InboxItem;
  colors: ThemeColors;
  active?: boolean;
  onPress: () => void;
}) {
  const hasUnread = item.unread > 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={itemLabel(item)}
      accessibilityState={{ selected: Boolean(active) }}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, backgroundColor: active ? colors.accentSoft : 'transparent', opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <PersonAvatar
        size={48}
        name={item.title}
        photoUrl={item.photoUrl}
        isBot={item.isBot}
        online={item.online}
        showPresence={item.online}
      />
      <View style={styles.rowBody}>
        <View style={styles.rowLine}>
          <Text
            style={[styles.rowName, { color: colors.text, fontWeight: hasUnread ? '700' : '600' }]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={[styles.time, { color: hasUnread ? colors.accent : colors.textMuted }]}>
            {inboxTimestamp(item.updatedAt)}
          </Text>
        </View>
        <View style={styles.rowLine}>
          <Text style={[styles.rowPreview, { color: colors.textMuted }]} numberOfLines={1}>
            {item.preview ?? ' '}
          </Text>
          <UnreadMark item={item} colors={colors} />
        </View>
      </View>
    </Pressable>
  );
}

function UnreadMark({ item, colors }: { item: InboxItem; colors: ThemeColors }) {
  if (item.unread > 0 && !item.muted) {
    return (
      <View style={[styles.badge, { backgroundColor: colors.unread }]}>
        <Text style={[styles.badgeText, { color: colors.onAccent }]}>{badgeLabel(item.unread)}</Text>
      </View>
    );
  }
  return item.muted ? <Ionicons name="notifications-off" size={14} color={colors.textMuted} /> : null;
}

/* ---------------------------------------------------------------- footer */

/** Secondary actions + tipped words. They follow the chats instead of pushing them off-screen. */
export function InboxFooter({
  colors,
  onNewChat,
  style,
}: {
  colors: ThemeColors;
  onNewChat: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.footer, style]}>
      <View style={styles.footerActions}>
        <Pressable
          onPress={onNewChat}
          accessibilityRole="button"
          accessibilityLabel="Find friends to chat with"
          style={[styles.footerButton, { borderColor: colors.border, backgroundColor: colors.accentSoft }]}
        >
          <Ionicons name="person-add-outline" size={15} color={colors.text} />
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Find friends</Text>
        </Pressable>
        <WhatsAppImportControl colors={colors} />
      </View>
      <TippedVocabHome colors={colors} />
    </View>
  );
}

/* -------------------------------------------------------------- skeleton */

/** Placeholder tiles while the inbox loads — same geometry as the real thing, so nothing jumps. */
export function InboxSkeleton({ colors, width }: { colors: ThemeColors; width: number }) {
  const opacity = useSkeletonPulse();
  const columns = inboxGridColumns(width, { gap: GRID_GAP, padding: GRID_PADDING });
  const tileWidth = Math.floor((width - GRID_PADDING * 2 - GRID_GAP * (columns - 1)) / columns);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Loading chats"
      accessibilityState={{ busy: true }}
      style={styles.skeletonGrid}
    >
      {Array.from({ length: columns * 3 }, (_, index) => (
        <View
          key={index}
          style={[styles.tile, { width: tileWidth, backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.tileHead}>
            <View style={[styles.skeletonAvatar, { backgroundColor: colors.accentSoft }]} />
            <View style={styles.skeletonTitles}>
              <SkeletonBar colors={colors} opacity={opacity} width="70%" height={12} />
              <SkeletonBar colors={colors} opacity={opacity} width="40%" height={10} />
            </View>
          </View>
          <SkeletonBar colors={colors} opacity={opacity} width="92%" height={10} />
          <SkeletonBar colors={colors} opacity={opacity} width="64%" height={10} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: GRID_PADDING + 4, paddingTop: 6, paddingBottom: 4, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingHorizontal: 14,
    minHeight: 38,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 7,
    // Web only: the pill around the input is the focus affordance, not the browser outline.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },

  gridContent: { paddingTop: 4, paddingBottom: 24 },
  gridRow: { gap: GRID_GAP, paddingHorizontal: GRID_PADDING },
  listContent: { paddingBottom: 24 },
  empty: { textAlign: 'center', paddingVertical: 32, fontSize: 14 },

  // Avatar, then name over time, then the badge; the preview gets the full tile width below.
  tile: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9, gap: 6 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tileTitles: { flex: 1, minWidth: 0, gap: 1 },
  tileName: { fontSize: 15, lineHeight: 20 },
  tilePreview: { fontSize: 13, lineHeight: 17, minHeight: 34, fontWeight: '400' },
  time: { fontSize: 12, lineHeight: 16, fontWeight: '400' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: GRID_PADDING + 4,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowName: { flex: 1, fontSize: 16, lineHeight: 21 },
  rowPreview: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '400' },

  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '700' },

  footer: { paddingHorizontal: GRID_PADDING + 4, paddingTop: 20, gap: 14 },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },

  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: GRID_PADDING,
    paddingTop: 12,
  },
  skeletonAvatar: { width: 40, height: 40, borderRadius: 20 },
  skeletonTitles: { flex: 1, gap: 6 },
});
