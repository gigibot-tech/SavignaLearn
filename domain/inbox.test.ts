import { describe, expect, it } from 'vitest';
import { LEARNING_BOT_USER_ID, sourceMessageFromText } from './chat';
import {
  badgeLabel,
  filterInboxItems,
  chatDayLabel,
  inboxGridColumns,
  inboxTimestamp,
  messageClockTime,
  sameChatDay,
  shouldCountAsUnread,
  unreadRecipients,
  unreadTotal,
  type InboxItem,
} from './inbox';

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

const item = (over: Partial<InboxItem>): InboxItem => ({
  id: 'c',
  title: 'Mira',
  updatedAt: '2026-11-24T10:00:00.000Z',
  unread: 0,
  muted: false,
  isBot: false,
  online: false,
  ...over,
});

describe('filterInboxItems', () => {
  const items = [
    item({ id: 'a', title: 'Mira', preview: 'Guten Morgen', unread: 2, online: true }),
    item({ id: 'b', title: 'Alex', preview: 'See you soon' }),
    item({ id: 'c', title: 'Bot', preview: 'Ready when you are', isBot: true, online: true }),
  ];

  it('returns everything for an empty query on All', () => {
    expect(filterInboxItems(items, { query: '  ', filter: 'all' })).toHaveLength(3);
  });

  it('searches the visible name and preview, case-insensitively', () => {
    expect(filterInboxItems(items, { query: 'MIRA', filter: 'all' }).map((i) => i.id)).toEqual(['a']);
    expect(filterInboxItems(items, { query: 'soon', filter: 'all' }).map((i) => i.id)).toEqual(['b']);
  });

  it('narrows by unread and online, and combines with search', () => {
    expect(filterInboxItems(items, { query: '', filter: 'unread' }).map((i) => i.id)).toEqual(['a']);
    expect(filterInboxItems(items, { query: '', filter: 'online' }).map((i) => i.id)).toEqual(['a', 'c']);
    expect(filterInboxItems(items, { query: 'bot', filter: 'online' }).map((i) => i.id)).toEqual(['c']);
  });
});

describe('inboxTimestamp', () => {
  const now = new Date(2026, 10, 24, 15, 0);
  const at = (day: number, hour = 9, minute = 5) => new Date(2026, 10, day, hour, minute).toISOString();

  it('shows the clock time for today', () => {
    expect(inboxTimestamp(at(24), now, 'en-GB')).toBe('09:05');
  });

  it('says Yesterday, then the weekday, then a date', () => {
    expect(inboxTimestamp(at(23), now, 'en-GB')).toBe('Yesterday');
    expect(inboxTimestamp(at(20), now, 'en-GB')).toBe('Fri');
    expect(inboxTimestamp(at(10), now, 'en-GB')).toBe('10/11/26');
  });

  it('is empty for an unparseable date', () => {
    expect(inboxTimestamp('not a date', now)).toBe('');
  });
});

describe('inboxGridColumns', () => {
  it('fits two tiles on phones and narrow panes', () => {
    expect(inboxGridColumns(320)).toBe(2);
    expect(inboxGridColumns(375)).toBe(2);
  });

  it('adds columns as width grows', () => {
    expect(inboxGridColumns(488)).toBe(3);
    expect(inboxGridColumns(1000)).toBe(6);
  });
});

describe('thread day helpers', () => {
  const now = new Date(2026, 10, 24, 15, 0);
  const at = (day: number, hour = 9) => new Date(2026, 10, day, hour, 5).toISOString();

  it('formats the clock time for a bubble', () => {
    expect(messageClockTime(at(24, 9), 'en-GB')).toBe('09:05');
    expect(messageClockTime('nope')).toBe('');
  });

  it('knows when two messages are on the same day', () => {
    expect(sameChatDay(at(24, 1), at(24, 23))).toBe(true);
    expect(sameChatDay(at(23, 23), at(24, 0))).toBe(false);
  });

  it('labels days like WhatsApp', () => {
    expect(chatDayLabel(at(24), now, 'en-GB')).toBe('Today');
    expect(chatDayLabel(at(23), now, 'en-GB')).toBe('Yesterday');
    expect(chatDayLabel(at(20), now, 'en-GB')).toBe('Friday');
    expect(chatDayLabel(at(3), now, 'en-GB')).toBe('3 November 2026');
  });
});
