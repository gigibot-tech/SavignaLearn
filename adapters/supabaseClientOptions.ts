import type { SupabaseClientOptions } from '@supabase/supabase-js';

import { authStorage } from '@/adapters/authStorage';

/**
 * Expo `export -p web` statically renders routes on Node. Netlify's default
 * Node 20 has no global WebSocket, and @supabase/realtime-js throws during
 * createClient unless we pass a transport.
 */
class SsrNoopWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = SsrNoopWebSocket.CLOSED;
  constructor(_url: string) {}
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
}

export function supabaseRealtimeTransport(): typeof WebSocket {
  if (typeof WebSocket !== 'undefined') return WebSocket;
  return SsrNoopWebSocket as unknown as typeof WebSocket;
}

export function supabaseAuthClientOptions(storageKey: string): Pick<
  SupabaseClientOptions<'public'>,
  'auth' | 'realtime'
> {
  return {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey,
    },
    realtime: { transport: supabaseRealtimeTransport() },
  };
}
