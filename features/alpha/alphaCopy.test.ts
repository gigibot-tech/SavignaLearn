import { describe, expect, it } from 'vitest';
import { ALPHA_NOTICE_A11Y, ALPHA_NOTICE_BODY, ALPHA_NOTICE_LABEL } from './alphaCopy';

describe('alpha screenshot notice', () => {
  it('tells every learner the app is alpha and to screenshot chats', () => {
    expect(ALPHA_NOTICE_LABEL).toBe('Alpha');
    expect(ALPHA_NOTICE_BODY.toLowerCase()).toContain('screenshot');
    expect(ALPHA_NOTICE_BODY.toLowerCase()).toContain('chats');
    expect(ALPHA_NOTICE_BODY.toLowerCase()).toContain('alpha');
    expect(ALPHA_NOTICE_A11Y).toContain(ALPHA_NOTICE_LABEL);
    expect(ALPHA_NOTICE_A11Y).toContain(ALPHA_NOTICE_BODY);
  });
});
