import { describe, expect, it } from 'vitest';
import {
  collapseDuplicateDirectChats,
  directConversationId,
  humanDirectPairKey,
  isHumanDirectChat,
  LEARNING_BOT_USER_ID,
  mergeMessageTimelines,
  sourceMessageFromText,
  type Conversation,
} from './chat';
import {
  canonicalChatActorId,
  ICESTORM_IDO_USER_ID,
  ICESTORM_PROFILE_ID,
} from './friends';

const langs = [
  { userId: 'a', nativeLang: 'en', learningLang: 'de' },
  { userId: 'b', nativeLang: 'de', learningLang: 'en' },
];

function conv(id: string, participantIds: string[], updatedAt: string, preview?: string): Conversation {
  return {
    id,
    participantIds,
    participants: langs.map((item, index) => ({ ...item, userId: participantIds[index] ?? item.userId })),
    aiEnabled: true,
    updatedAt,
    unreadCount: 0,
    lastMessagePreview: preview,
  };
}

describe('directConversationId', () => {
  it('is stable regardless of who opens the DM', () => {
    expect(directConversationId('ice', 'learn')).toBe(directConversationId('learn', 'ice'));
    expect(directConversationId('ice', 'learn')).toBe('dm:ice:learn');
  });

  it('maps the icestorm stub onto the live iDO id', () => {
    expect(canonicalChatActorId(ICESTORM_PROFILE_ID)).toBe(ICESTORM_IDO_USER_ID);
    expect(
      directConversationId(canonicalChatActorId(ICESTORM_PROFILE_ID), 'learn-id')
    ).toBe(directConversationId(ICESTORM_IDO_USER_ID, 'learn-id'));
  });
});

describe('collapseDuplicateDirectChats', () => {
  it('keeps one row per pair and prefers the shared dm: id', () => {
    const collapsed = collapseDuplicateDirectChats(
      [
        conv('c-old', ['learn', ICESTORM_PROFILE_ID], '2026-09-03T10:00:00.000Z', 'hi'),
        conv(
          directConversationId(canonicalChatActorId('learn'), canonicalChatActorId(ICESTORM_PROFILE_ID)),
          ['learn', ICESTORM_IDO_USER_ID],
          '2026-09-03T09:00:00.000Z',
          'older'
        ),
        conv('bot', ['learn', LEARNING_BOT_USER_ID], '2026-09-03T11:00:00.000Z', 'bot'),
      ],
      canonicalChatActorId
    );
    const dms = collapsed.filter((item) => isHumanDirectChat(item.participantIds));
    expect(dms).toHaveLength(1);
    expect(dms[0].id.startsWith('dm:')).toBe(true);
    expect(dms[0].lastMessagePreview).toBe('hi');
    expect(collapsed.some((item) => item.id === 'bot')).toBe(true);
  });
});

describe('mergeMessageTimelines', () => {
  it('sorts by createdAt and drops same author+text within 2s', () => {
    const first = sourceMessageFromText({
      id: 'local-1',
      conversationId: 'c-1',
      authorId: 'learn',
      sourceLang: 'en',
      sourceText: 'hey',
      createdAt: '2026-09-03T12:00:00.000Z',
      receipt: 'pending',
    });
    const copy = sourceMessageFromText({
      id: 'cloud-1',
      conversationId: 'dm:ice:learn',
      authorId: 'learn',
      sourceLang: 'en',
      sourceText: 'hey',
      createdAt: '2026-09-03T12:00:01.400Z',
      receipt: 'sent',
    });
    const later = sourceMessageFromText({
      id: 'local-2',
      conversationId: 'c-1',
      authorId: 'ice',
      sourceLang: 'en',
      sourceText: 'hi back',
      createdAt: '2026-09-03T12:00:05.000Z',
      receipt: 'sent',
    });
    const merged = mergeMessageTimelines([later, first], [copy]);
    expect(merged.map((item) => item.sourceText)).toEqual(['hey', 'hi back']);
    expect(merged[0].receipt).toBe('sent');
    expect(merged[0].id).toBe('local-1');
  });

  it('keeps a tombstone instead of restoring deleted text from the other copy', () => {
    const live = sourceMessageFromText({
      id: 'm-1',
      conversationId: 'c-1',
      authorId: 'learn',
      sourceLang: 'en',
      sourceText: 'secret',
      createdAt: '2026-09-03T12:00:00.000Z',
    });
    const gone = {
      ...live,
      deletedAt: '2026-09-03T12:01:00.000Z',
      sourceText: '',
      lines: [{ content: '' }],
    };
    const merged = mergeMessageTimelines([live], [gone]);
    expect(merged).toHaveLength(1);
    expect(merged[0].deletedAt).toBe('2026-09-03T12:01:00.000Z');
    expect(merged[0].sourceText).toBe('');
  });
});

describe('humanDirectPairKey', () => {
  it('treats stub and live ice as the same person', () => {
    expect(humanDirectPairKey(['learn', ICESTORM_PROFILE_ID], canonicalChatActorId)).toBe(
      humanDirectPairKey(['learn', ICESTORM_IDO_USER_ID], canonicalChatActorId)
    );
  });
});
