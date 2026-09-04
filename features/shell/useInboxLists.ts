import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { unreadTotal } from '@/domain/unread';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { useFriendsQuery, useInboxQuery } from '@/features/query/useChatQueries';
import { queryKeys } from '@/features/query/queryKeys';
import { setInboxAppBadge } from '@/features/shell/appBadge';

export function useInboxLists() {
  const { chat, bumpFriends } = useServices();
  const { user } = useAuthState();
  const queryClient = useQueryClient();
  const inboxQuery = useInboxQuery();
  const friendsQuery = useFriendsQuery();
  const conversations = inboxQuery.data ?? [];
  const friendRows = friendsQuery.data ?? [];

  useEffect(() => {
    if (!user) {
      void setInboxAppBadge(0);
      return;
    }
    void setInboxAppBadge(unreadTotal(conversations));
  }, [user, conversations]);

  useEffect(() => {
    if (!user || conversations.length === 0) return;
    const unsubs: Array<() => void> = [];
    let pushTimer: ReturnType<typeof setTimeout> | undefined;
    const userId = user.id;

    for (const conversation of conversations) {
      unsubs.push(
        chat.subscribe(conversation.id, () => {
          clearTimeout(pushTimer);
          pushTimer = setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.inbox(userId) });
            bumpFriends();
          }, 80);
        })
      );
    }

    return () => {
      clearTimeout(pushTimer);
      for (const unsub of unsubs) unsub();
    };
  }, [chat, user, conversations, queryClient, bumpFriends]);

  const loading =
    Boolean(user) &&
    ((inboxQuery.isLoading && inboxQuery.data === undefined) ||
      (friendsQuery.isLoading && friendsQuery.data === undefined));

  return {
    conversations,
    friendRows,
    loading,
    unread: unreadTotal(conversations),
    incoming: friendRows.filter((row) => row.kind === 'incoming').length,
  };
}
