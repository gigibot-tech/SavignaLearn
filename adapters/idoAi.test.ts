import { describe, expect, it } from 'vitest';
import { idoAssistProbeFromSession } from './idoAi';

describe('iDO ai-assist probe', () => {
  it('stays off when iDO is not configured', () => {
    expect(idoAssistProbeFromSession(false, 'jwt')).toEqual({
      ok: false,
      detail: 'not configured',
    });
  });

  it('asks for sign-in when there is no session', () => {
    expect(idoAssistProbeFromSession(true, undefined)).toEqual({
      ok: false,
      detail: 'sign in to enable',
    });
  });

  it('treats a session JWT as signed in without calling ai-assist', () => {
    expect(idoAssistProbeFromSession(true, 'jwt')).toEqual({
      ok: true,
      detail: 'signed in',
    });
  });
});
