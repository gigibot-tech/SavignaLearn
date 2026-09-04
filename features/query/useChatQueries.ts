import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ensureLearningBotChat, listInboxConversations } from '@/adapters/chat';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { emptyProfileCard, indexProfileCards } from '@/domain/profileCard';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { fetchThreadSnapshot } from './fetchThread';
import { queryKeys } from './queryKeys';

export function useInboxQuery() {
  const { chat, friendsTick } = useServices();
  const { user, ready } = useAuthState();
  const queryClient = useQueryClient();
  const userId = user?.id ?? '';
  const skipTick = useRef(true);

  useEffect(() => {
    if (skipTick.current) {
      skipTick.current = false;
      return;
    }
    if (!userId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.inbox(userId) });
  }, [friendsTick, userId, queryClient]);

  return useQuery({
    queryKey: queryKeys.inbox(userId),
    enabled: Boolean(ready && user),
    queryFn: async () => {
      if (!user) return [];
      const ids = chatActorIds(user);
      await ensureLearningBotChat(chat, chatPersistenceUserId(user), ids);
      return listInboxConversations(chat, ids);
    },
  });
}

export function useFriendsQuery() {
  const { friends, friendsTick } = useServices();
  const { user, ready } = useAuthState();
  const queryClient = useQueryClient();
  const userId = user?.id ?? '';
  const skipTick = useRef(true);

  useEffect(() => {
    if (skipTick.current) {
      skipTick.current = false;
      return;
    }
    if (!userId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.friends(userId) });
  }, [friendsTick, userId, queryClient]);

  return useQuery({
    queryKey: queryKeys.friends(userId),
    enabled: Boolean(ready && user),
    queryFn: async () => {
      if (!user) return [];
      return friends.reconcile(user.id);
    },
  });
}

export function useThreadQuery(conversationId: string) {
  const { chat, historyStore, friendsTick } = useServices();
  const { user } = useAuthState();
  const queryClient = useQueryClient();
  const userId = user ? chatPersistenceUserId(user) : 'anon';
  const skipTick = useRef(true);

  useEffect(() => {
    if (skipTick.current) {
      skipTick.current = false;
      return;
    }
    if (!conversationId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.thread(conversationId, userId) });
  }, [friendsTick, conversationId, userId, queryClient]);

  return useQuery({
    queryKey: queryKeys.thread(conversationId, userId),
    enabled: Boolean(conversationId),
    queryFn: () =>
      fetchThreadSnapshot({
        chat,
        historyStore,
        conversationId,
        user,
      }),
  });
}

export function useProfileCardsQuery(userIds: string[]) {
  const { profiles } = useServices();
  const { ready } = useAuthState();
  const idKey = [...new Set(userIds.filter(Boolean))].sort().join('|');
  const ids = useMemo(() => (idKey ? idKey.split('|') : []), [idKey]);
  const query = useQuery({
    queryKey: queryKeys.profiles(ids),
    enabled: Boolean(ready && ids.length),
    queryFn: () => profiles.list(ids),
    refetchInterval: 20_000,
  });
  const map = useMemo(() => indexProfileCards(query.data ?? []), [query.data]);
  return { ...query, ids, map };
}

export function useOwnProfileQuery() {
  const { profiles } = useServices();
  const { user, ready } = useAuthState();
  const persistId = user ? chatPersistenceUserId(user) : '';
  return useQuery({
    queryKey: queryKeys.ownProfile(persistId),
    enabled: Boolean(ready && persistId),
    queryFn: async () => (await profiles.get(persistId)) ?? emptyProfileCard(persistId),
    refetchInterval: 20_000,
  });
}
