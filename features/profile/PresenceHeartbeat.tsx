/**
 * Heartbeat while signed in so friends see “online” / last seen.
 */

import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chatPersistenceUserId } from '@/adapters/identity';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { queryKeys } from '@/features/query/queryKeys';

const BEAT_MS = 45_000;

export function PresenceHeartbeat() {
  const { profiles } = useServices();
  const { user } = useAuthState();
  const queryClient = useQueryClient();
  const persistId = user ? chatPersistenceUserId(user) : '';

  const beat = useCallback(async () => {
    if (!persistId) return;
    await profiles.heartbeat(persistId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.profileRoot });
  }, [persistId, profiles, queryClient]);

  useEffect(() => {
    if (!persistId) return;
    void beat();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void beat();
    }, BEAT_MS);
    const onVis = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void beat();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis);
    }
    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVis);
      }
    };
  }, [beat, persistId]);

  return null;
}
