import { describe, expect, it } from 'vitest';
import { shouldAutoReplyFromSendInput } from './chatAutoReply';

describe('shouldAutoReplyFromSendInput', () => {
  it('returns false for retry input', () => {
    expect(
      shouldAutoReplyFromSendInput('retry', {
        botReplies: true,
        talkingToBot: true,
        isMediaMessage: false,
      })
    ).toBe(false);
  });

  it('returns true for text input when conditions are met', () => {
    expect(
      shouldAutoReplyFromSendInput('text', {
        botReplies: true,
        talkingToBot: true,
        isMediaMessage: false,
      })
    ).toBe(true);
  });

  it('returns false when botReplies are disabled', () => {
    expect(
      shouldAutoReplyFromSendInput('text', {
        botReplies: false,
        talkingToBot: true,
        isMediaMessage: false,
      })
    ).toBe(false);
  });
});

