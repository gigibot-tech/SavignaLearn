import { describe, expect, it } from 'vitest';
import {
  defaultAiBackend,
  isAiBackendId,
  messagesToFourSomeQuery,
  isFourSomeUserId,
  resolveFourSomeUserId,
  foursomeWsUrl,
  labelForAiBackend,
} from './aiBackend';

describe('switchable AI backends', () => {
  it('accepts known backend ids', () => {
    expect(isAiBackendId('onprem')).toBe(true);
    expect(isAiBackendId('foursome')).toBe(true);
    expect(isAiBackendId('ido')).toBe(true);
    expect(isAiBackendId('openai')).toBe(true);
    expect(isAiBackendId('demo')).toBe(true);
    expect(isAiBackendId('northflank')).toBe(false);
  });

  it('defaults to demo unless env selects another backend', () => {
    expect(['demo', 'foursome', 'ido', 'openai', 'onprem']).toContain(defaultAiBackend());
    expect(labelForAiBackend('onprem')).toBe('On-prem');
    expect(labelForAiBackend('foursome')).toBe('fourSome');
    expect(labelForAiBackend('ido')).toBe('iDO');
  });

  it('turns fourSome HTTP chat URL into the live WebSocket path', () => {
    expect(foursomeWsUrl('https://p01--four-some-backend--yjfqr8lcxqgg.code.run/chat/')).toBe(
      'wss://p01--four-some-backend--yjfqr8lcxqgg.code.run/ws'
    );
  });

  it('only accepts a real fourSome UUID — never mints one from demo-user', () => {
    expect(isFourSomeUserId('16e1c5d7-2908-44be-b53a-b7c0f0a00001')).toBe(true);
    expect(isFourSomeUserId('savigna-learn')).toBe(false);
    expect(isFourSomeUserId('demo-user')).toBe(false);
    expect(
      resolveFourSomeUserId('demo-user', ' 16E1C5D7-2908-44BE-B53A-B7C0F0A00001 ', 'other')
    ).toBe('16e1c5d7-2908-44be-b53a-b7c0f0a00001');
    expect(resolveFourSomeUserId('savigna-learn', 'demo-user')).toBeNull();
  });

  it('joins system + last user message for the fourSome WS payload', () => {
    expect(
      messagesToFourSomeQuery([
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'Hallo' },
      ])
    ).toBe('Be brief\n\nHallo');
  });
});
