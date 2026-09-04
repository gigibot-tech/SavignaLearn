/** Stable TanStack Query keys for chat reads (inbox, friends, thread hydrate). */
export const queryKeys = {
  inbox: (userId: string) => ['chat', 'inbox', userId] as const,
  friends: (userId: string) => ['chat', 'friends', userId] as const,
  thread: (conversationId: string, userId: string) =>
    ['chat', 'thread', conversationId, userId] as const,
};
