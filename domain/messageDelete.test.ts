import { describe, expect, it } from 'vitest';
import { DELETED_FOR_EVERYONE_COPY, sourceMessageFromText } from './chat';
import {
  DELETE_FOR_EVERYONE_WINDOW_MS,
  canDeleteForEveryone,
  canDeleteForMe,
  isDeletedForEveryone,
  messagesVisibleToViewer,
  previewAfterDelete,
  tombstoneMessage,
  viewerOwnsMessage,
} from './messageDelete';

const mine = sourceMessageFromText({
  id: 'm1',
  conversationId: 'c1',
  authorId: 'me',
  sourceLang: 'en',
  sourceText: 'hello',
  createdAt: new Date().toISOString(),
});

const theirs = sourceMessageFromText({
  id: 'm2',
  conversationId: 'c1',
  authorId: 'them',
  sourceLang: 'de',
  sourceText: 'hallo',
  createdAt: new Date().toISOString(),
});

describe('message delete (WhatsApp-like)', () => {
  it('lets anyone delete for me, and only the author delete for everyone', () => {
    expect(canDeleteForMe(mine)).toBe(true);
    expect(canDeleteForMe(theirs)).toBe(true);
    expect(canDeleteForEveryone(mine, ['me'])).toBe(true);
    expect(canDeleteForEveryone(theirs, ['me'])).toBe(false);
    expect(viewerOwnsMessage(mine.authorId, ['me', 'alias'])).toBe(true);
  });

  it('blocks delete for everyone after the WhatsApp-style window', () => {
    const old = {
      ...mine,
      createdAt: new Date(Date.now() - DELETE_FOR_EVERYONE_WINDOW_MS - 1000).toISOString(),
    };
    expect(canDeleteForEveryone(old, ['me'])).toBe(false);
  });

  it('tombstones content for everyone and hides rows for me', () => {
    const gone = tombstoneMessage(mine, '2026-09-04T00:00:00.000Z');
    expect(isDeletedForEveryone(gone)).toBe(true);
    expect(gone.sourceText).toBe('');
    expect(canDeleteForEveryone(gone, ['me'])).toBe(false);
    expect(messagesVisibleToViewer([mine, theirs], new Set(['m2'])).map((item) => item.id)).toEqual([
      'm1',
    ]);
    expect(
      previewAfterDelete([mine, theirs], new Set(['m2']), (item) => item.sourceText)
    ).toBe('hello');
  });

  it('keeps the public copy for a tombstone preview', () => {
    expect(DELETED_FOR_EVERYONE_COPY).toMatch(/deleted/i);
  });
});
