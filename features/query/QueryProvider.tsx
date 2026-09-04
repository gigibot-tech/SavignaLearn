import React, { useEffect, useRef, useState } from 'react';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useAuthState } from '@/features/chat/AppProviders';
import { createAppQueryClient } from './createQueryClient';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createAppQueryClient());
  return (
    <QueryClientProvider client={client}>
      <QueryCacheReset>{children}</QueryCacheReset>
    </QueryClientProvider>
  );
}

/** Drop cached inbox/thread rows when the signed-in person changes. */
function QueryCacheReset({ children }: { children: React.ReactNode }) {
  const { user } = useAuthState();
  const queryClient = useQueryClient();
  const lastUser = useRef<string | null>(null);

  useEffect(() => {
    const id = user?.id ?? null;
    if (lastUser.current && lastUser.current !== id) {
      queryClient.clear();
    }
    lastUser.current = id;
  }, [user?.id, queryClient]);

  return children;
}
