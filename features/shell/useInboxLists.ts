import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
import { ensureLearningBotChat, listInboxConversations } from '@/adapters/chat';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import type { Conversation } from '@/domain/chat';
import type { FriendRow } from '@/domain/friends';
import { unreadTotal } from '@/domain/unread';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { setInboxAppBadge } from '@/features/shell/appBadge';

export function useInboxLists() {
  const { chat, friends, friendsTick, bumpFriends } = useServices();
  const { user } = useAuthState();
  const pathname = usePathname();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friendRows, setFriendRows] = useState<FriendRow[]>([]);
  const skipTickRefresh = useRef(false);
  const skipFirstTick = useRef(true);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setFriendRows([]);
      void setInboxAppBadge(0);
      return;
    }

    let cancelled = false;
    const unsubs: Array<() => void> = [];
    let pushTimer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async (reason: 'load' | 'push') => {
      const ids = chatActorIds(user);
      await ensureLearningBotChat(chat, chatPersistenceUserId(user), ids);
      const [nextConversations, nextRows] = await Promise.all([
        listInboxConversations(chat, ids),
        friends.reconcile(user.id),
      ]);
      if (cancelled) return nextConversations;
      setConversations(nextConversations);
      setFriendRows(nextRows);
      void setInboxAppBadge(unreadTotal(nextConversations));
      if (reason === 'push') {
        skipTickRefresh.current = true;
        bumpFriends();
      }
      return nextConversations;
    };

    void (async () => {
      const listed = await refresh('load');
      if (cancelled || !listed) return;
      for (const conversation of listed) {
        unsubs.push(
          chat.subscribe(conversation.id, () => {
            clearTimeout(pushTimer);
            pushTimer = setTimeout(() => {
              void refresh('push');
            }, 80);
          })
        );
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(pushTimer);
      for (const unsub of unsubs) unsub();
    };
  }, [chat, friends, user, pathname, bumpFriends]);

  useEffect(() => {
    if (skipFirstTick.current) {
      skipFirstTick.current = false;
      return;
    }
    if (skipTickRefresh.current) {
      skipTickRefresh.current = false;
      return;
    }
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const ids = chatActorIds(user);
      const [nextConversations, nextRows] = await Promise.all([
        listInboxConversations(chat, ids),
        friends.reconcile(user.id),
      ]);
      if (cancelled) return;
      setConversations(nextConversations);
      setFriendRows(nextRows);
      void setInboxAppBadge(unreadTotal(nextConversations));
    })();
    return () => {
      cancelled = true;
    };
  }, [friendsTick, user, chat, friends]);

  return {
    conversations,
    friendRows,
    unread: unreadTotal(conversations),
    incoming: friendRows.filter((row) => row.kind === 'incoming').length,
  };
}
