import { describe, expect, it } from 'vitest';

import { supabaseAuthClientOptions, supabaseRealtimeTransport } from './supabaseClientOptions';

describe('supabaseAuthClientOptions', () => {
  it('always supplies a realtime transport so createClient can run on Node without WebSocket', () => {
    const options = supabaseAuthClientOptions('savignalearn.test.auth');
    expect(options.auth.storageKey).toBe('savignalearn.test.auth');
    expect(typeof options.realtime.transport).toBe('function');
    const Transport = supabaseRealtimeTransport();
    expect(() => new Transport('wss://example.test')).not.toThrow();
  });
});
