import { describe, expect, it } from 'vitest';
import { LEARNING_BOT_USER_ID } from './chat';
import { ICESTORM_IDO_USER_ID, ICESTORM_PROFILE_ID } from './friends';
import {
  cardIsOnline,
  formatPresenceLabel,
  isOnlineNow,
  ONLINE_WINDOW_MS,
  presenceKind,
} from './presence';
import {
  botProfileCard,
  clampProfileBio,
  conversationPartnerIds,
  indexProfileCards,
  mergeProfileCards,
  PROFILE_BIO_MAX,
  profileCardFor,
  profileLookupIds,
  type ProfileCard,
} from './profileCard';

/** Local calendar noon so “today / yesterday” does not depend on the runner TZ. */
const noon = new Date(2026, 8, 4, 15, 0, 0).getTime();

function card(over: Partial<ProfileCard> = {}): ProfileCard {
  return {
    userId: 'u1',
    photoUrl: null,
    bio: '',
    lastSeenAt: new Date(noon).toISOString(),
    presenceOptIn: true,
    ...over,
  };
}

describe('presence', () => {
  it('is online within the heartbeat window', () => {
    expect(
      isOnlineNow({
        lastSeenAt: new Date(noon - ONLINE_WINDOW_MS + 1_000).toISOString(),
        presenceOptIn: true,
        now: noon,
      })
    ).toBe(true);
    expect(
      isOnlineNow({
        lastSeenAt: new Date(noon - ONLINE_WINDOW_MS - 1_000).toISOString(),
        presenceOptIn: true,
        now: noon,
      })
    ).toBe(false);
  });

  it('hides last seen when the person opted out', () => {
    expect(
      presenceKind({
        lastSeenAt: new Date(noon).toISOString(),
        presenceOptIn: false,
        now: noon,
      })
    ).toBe('hidden');
    expect(
      formatPresenceLabel({
        lastSeenAt: new Date(noon - 10 * 60_000).toISOString(),
        presenceOptIn: false,
        now: noon,
      })
    ).toBe('');
  });

  it('shows WhatsApp-style last seen copy', () => {
    expect(
      formatPresenceLabel({
        lastSeenAt: new Date(noon - 60_000).toISOString(),
        presenceOptIn: true,
        now: noon,
      })
    ).toBe('online');
    expect(
      formatPresenceLabel({
        lastSeenAt: new Date(noon - 20 * 60_000).toISOString(),
        presenceOptIn: true,
        now: noon,
      })
    ).toMatch(/^last seen today at /);
    expect(
      formatPresenceLabel({
        lastSeenAt: new Date(2026, 8, 3, 15, 0, 0).toISOString(),
        presenceOptIn: true,
        now: noon,
      })
    ).toMatch(/^last seen yesterday at /);
    expect(
      formatPresenceLabel({
        lastSeenAt: new Date(2026, 7, 30, 15, 0, 0).toISOString(),
        presenceOptIn: true,
        now: noon,
      })
    ).toMatch(/^last seen /);
  });

  it('treats the learning bot as always online', () => {
    expect(
      formatPresenceLabel({
        lastSeenAt: null,
        presenceOptIn: false,
        isBot: true,
        now: noon,
      })
    ).toBe('online');
    expect(cardIsOnline(botProfileCard(), noon)).toBe(true);
    expect(botProfileCard().userId).toBe(LEARNING_BOT_USER_ID);
  });
});

describe('profile card', () => {
  it('clamps about text to WhatsApp length', () => {
    expect(clampProfileBio(`  hello   world  `)).toBe('hello world');
    expect(clampProfileBio('x'.repeat(PROFILE_BIO_MAX + 8))).toHaveLength(PROFILE_BIO_MAX);
  });

  it('merges cloud identity with the later heartbeat', () => {
    const local = card({
      photoUrl: 'data:image/png;base64,aa',
      bio: 'old',
      lastSeenAt: new Date(noon).toISOString(),
    });
    const cloud = card({
      photoUrl: null,
      bio: 'Hey there! I am using SavignaLearn.',
      lastSeenAt: new Date(noon - 60_000).toISOString(),
      presenceOptIn: true,
    });
    const merged = mergeProfileCards(local, cloud);
    expect(merged?.bio).toBe('Hey there! I am using SavignaLearn.');
    expect(merged?.photoUrl).toBe('data:image/png;base64,aa');
    expect(merged?.lastSeenAt).toBe(local.lastSeenAt);
  });

  it('resolves ice stub ids to the live actor', () => {
    expect(profileLookupIds(ICESTORM_PROFILE_ID)).toContain(ICESTORM_IDO_USER_ID);
    const map = indexProfileCards([card({ userId: ICESTORM_IDO_USER_ID })]);
    expect(profileCardFor(map, ICESTORM_PROFILE_ID)?.userId).toBe(ICESTORM_IDO_USER_ID);
  });

  it('collects inbox partner ids including the bot', () => {
    expect(
      conversationPartnerIds(
        [
          { participantIds: ['me', LEARNING_BOT_USER_ID], title: 'Bot' },
          { participantIds: ['me', 'ice'], title: 'Ice' },
        ],
        ['me']
      ).sort()
    ).toEqual(['ice', LEARNING_BOT_USER_ID].sort());
  });
});
