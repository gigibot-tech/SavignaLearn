import { describe, expect, it } from 'vitest';
import { LEARNING_BOT_USER_ID, sourceMessageFromText } from './chat';
import { badgeLabel, shouldCountAsUnread, unreadRecipients, unreadTotal } from './unread';

describe('unread', () => {
  it('does not count your own messages or tombstones', () => {
    const mine = sourceMessageFromText({
      id: 'm1',
      conversationId: 'c1',
      authorId: 'me',
      sourceLang: 'en',
      sourceText: 'hi',
    });
    const gone = { ...mine, id: 'm2', authorId: 'them', deletedAt: '2026-09-04T00:00:00.000Z' };
    expect(shouldCountAsUnread(mine, ['me'])).toBe(false);
    expect(shouldCountAsUnread(gone, ['me'])).toBe(false);
  });

  it('counts bot replies and the other person’s messages', () => {
    expect(shouldCountAsUnread({ authorId: LEARNING_BOT_USER_ID }, ['me'])).toBe(true);
    expect(shouldCountAsUnread({ authorId: 'them' }, ['me'])).toBe(true);
  });

  it('increments humans other than the author, never the bot', () => {
    expect(unreadRecipients(['me', 'them', LEARNING_BOT_USER_ID], 'me')).toEqual(['them']);
    expect(unreadRecipients(['me', LEARNING_BOT_USER_ID], LEARNING_BOT_USER_ID)).toEqual(['me']);
  });

  it('sums unmuted unread and caps the badge', () => {
    expect(
      unreadTotal([
        { unreadCount: 2, muted: false },
        { unreadCount: 5, muted: true },
        { unreadCount: 1 },
      ])
    ).toBe(3);
    expect(badgeLabel(0)).toBeUndefined();
    expect(badgeLabel(3)).toBe('3');
    expect(badgeLabel(100)).toBe('99+');
  });
});
