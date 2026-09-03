import { describe, expect, it } from 'vitest';
import { LEARNING_BOT_DISPLAY_NAME, LEARNING_BOT_USER_ID } from './chat';
import {
  DEMO_LEARNER_ID,
  ICESTORM_EMAIL,
  ICESTORM_PROFILE_ID,
  IDO_LEARN_EMAIL,
  IDO_LEARN_USER_ID,
  IDO_SAVINA_EMAIL,
  IDO_SAVINA_USER_ID,
  ambiguousUsernames,
  dualDirectoryError,
  existingIncomingFrom,
  friendIdentitySubtitle,
  friendRequestErrorMessage,
  friendSharePath,
  friendShareUrl,
  friendshipPairKey,
  inboxPartnerTitle,
  isDemoLearnerIdentity,
  kindForViewer,
  listFriendRows,
  normalizeUsername,
  parseFriendIdentifier,
  parseFriendShareInput,
  profileEmail,
  publicIdentityCopyValue,
  publicIdentityLabel,
  seedMutualAccepted,
  friendInconsistency,
  friendInconsistencyMessage,
  isDeletedPair,
  usernameFromEmail,
  validateFriendRequest,
  type Friendship,
  type PublicProfile,
} from './friends';

const alex: PublicProfile = { id: 'alex', username: 'alex', displayName: 'Alex', email: 'alex@savigna.local' };
const mira: PublicProfile = { id: 'mira', username: 'mira', displayName: 'Mira', email: 'mira@savigna.local' };
const ice: PublicProfile = {
  id: ICESTORM_PROFILE_ID,
  username: 'icestormfroste',
  displayName: 'icestormfroste',
  email: ICESTORM_EMAIL,
};
const me = 'learner-1';

function pending(from: string, to: string, id = 'f1'): Friendship {
  return {
    id,
    requesterId: from,
    addresseeId: to,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('normalizeUsername', () => {
  it('strips @ and case', () => {
    expect(normalizeUsername('  @Alex ')).toBe('alex');
  });
});

describe('friendshipPairKey', () => {
  it('is order-independent', () => {
    expect(friendshipPairKey('a', 'b')).toBe(friendshipPairKey('b', 'a'));
  });
});

describe('parseFriendIdentifier', () => {
  it('parses email, user id, username, and share link', () => {
    expect(parseFriendIdentifier('  icestormfroste@gmail.com ')).toEqual({
      kind: 'email',
      email: 'icestormfroste@gmail.com',
    });
    expect(parseFriendIdentifier('16e1c5d7-2908-44be-b53a-b7c0f0a00001')).toEqual({
      kind: 'user_id',
      userId: '16e1c5d7-2908-44be-b53a-b7c0f0a00001',
    });
    expect(parseFriendIdentifier('@Jordan')).toEqual({ kind: 'username', username: 'jordan' });
    expect(parseFriendIdentifier('https://savignalearn.app/friends?add=friend-alex')).toEqual({
      kind: 'user_id',
      userId: 'friend-alex',
    });
    expect(parseFriendIdentifier('/friends?add=demo-user')).toEqual({
      kind: 'user_id',
      userId: 'demo-user',
    });
  });

  it('rejects empty and malformed links', () => {
    expect(parseFriendIdentifier('   ')).toEqual({ kind: 'empty' });
    expect(parseFriendIdentifier('https://savignalearn.app/friends?foo=bar')).toEqual({ kind: 'malformed' });
    expect(parseFriendIdentifier('/friends?add=')).toEqual({ kind: 'malformed' });
  });
});

describe('parseFriendShareInput / friendShareUrl', () => {
  it('builds a copy-pastable /friends?add= link', () => {
    expect(friendSharePath('abc')).toBe('/friends?add=abc');
    expect(friendShareUrl('abc')).toBe('https://savignalearn.app/friends?add=abc');
    expect(parseFriendShareInput(friendShareUrl(ice.id))).toEqual({ kind: 'user_id', userId: ice.id });
  });
});

describe('validateFriendRequest', () => {
  it('cannot request an unknown email — never invent a target', () => {
    expect(parseFriendIdentifier('ghost-not-real@nowhere.invalid')).toEqual({
      kind: 'email',
      email: 'ghost-not-real@nowhere.invalid',
    });
    expect(validateFriendRequest({ viewerId: me, target: null, existing: [] })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('rejects missing, self, duplicate pending, and accepted', () => {
    expect(validateFriendRequest({ viewerId: me, target: null, existing: [] })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(
      validateFriendRequest({
        viewerId: alex.id,
        target: alex,
        existing: [],
      })
    ).toEqual({ ok: false, error: 'self' });
    expect(
      validateFriendRequest({
        viewerId: me,
        target: alex,
        existing: [pending(me, alex.id)],
      })
    ).toEqual({ ok: false, error: 'already_requested' });
    expect(
      validateFriendRequest({
        viewerId: me,
        target: alex,
        existing: [{ ...pending(me, alex.id), status: 'accepted' }],
      })
    ).toEqual({ ok: false, error: 'already_friends' });
    expect(validateFriendRequest({ viewerId: me, target: mira, existing: [] })).toEqual({
      ok: true,
    });
  });

  it('rejects a request by email that resolves to self', () => {
    const learner: PublicProfile = {
      id: DEMO_LEARNER_ID,
      username: 'learner',
      displayName: 'Learner',
      email: 'learner@savigna.local',
    };
    expect(validateFriendRequest({ viewerId: DEMO_LEARNER_ID, target: learner, existing: [] })).toEqual({
      ok: false,
      error: 'self',
    });
  });

  it('never friends SavignasBoi', () => {
    expect(
      validateFriendRequest({
        viewerId: me,
        target: {
          id: LEARNING_BOT_USER_ID,
          username: 'savigna',
          displayName: LEARNING_BOT_DISPLAY_NAME,
          email: 'bot@savigna.local',
        },
        existing: [],
      })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('rejects a target with no email — never insert a ghost', () => {
    expect(
      validateFriendRequest({
        viewerId: me,
        target: { id: 'ghost', username: 'ghost', displayName: 'Ghost', email: '' },
        existing: [],
      })
    ).toEqual({ ok: false, error: 'missing_email' });
  });
});

describe('dualDirectoryError', () => {
  it('rejects unknown identifiers and missing SavignaLearn or iDO hits', () => {
    expect(dualDirectoryError({ savigna: null, ido: null, idoConfigured: false })).toBe('not_found');
    expect(dualDirectoryError({ savigna: null, ido: null, idoConfigured: true })).toBe('not_found');
    expect(dualDirectoryError({ savigna: null, ido: ice, idoConfigured: true })).toBe('not_found_savigna');
    expect(dualDirectoryError({ savigna: ice, ido: null, idoConfigured: true })).toBe('not_found_ido');
    expect(dualDirectoryError({ savigna: ice, ido: ice, idoConfigured: true })).toBeNull();
    expect(dualDirectoryError({ savigna: ice, ido: null, idoConfigured: false })).toBeNull();
  });
});

describe('existingIncomingFrom', () => {
  it('finds a reverse pending request so add can accept instead', () => {
    const rows = [pending(alex.id, me, 'in')];
    expect(existingIncomingFrom(rows, me, alex.id)?.id).toBe('in');
    expect(existingIncomingFrom(rows, me, mira.id)).toBeUndefined();
  });
});

describe('accept is symmetric', () => {
  it('shows accepted to both people on the same pair key', () => {
    const row: Friendship = {
      id: 'ok',
      requesterId: DEMO_LEARNER_ID,
      addresseeId: ICESTORM_PROFILE_ID,
      status: 'accepted',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(kindForViewer(row, DEMO_LEARNER_ID)).toBe('accepted');
    expect(kindForViewer(row, ICESTORM_PROFILE_ID)).toBe('accepted');
    expect(friendshipPairKey(DEMO_LEARNER_ID, ICESTORM_PROFILE_ID)).toBe(
      friendshipPairKey(ICESTORM_PROFILE_ID, DEMO_LEARNER_ID)
    );
  });
});

describe('seedMutualAccepted learner ↔ icestormfroste', () => {
  it('inserts a symmetric accepted friendship and skips the bot', () => {
    const rows: Friendship[] = [];
    const seeded = seedMutualAccepted(rows, DEMO_LEARNER_ID, ICESTORM_PROFILE_ID, '2026-01-01T00:00:00.000Z');
    expect(seeded?.status).toBe('accepted');
    expect(rows).toHaveLength(1);
    expect(seedMutualAccepted(rows, ICESTORM_PROFILE_ID, DEMO_LEARNER_ID, '2026-01-01T00:00:00.000Z')).toBeNull();
    expect(rows).toHaveLength(1);
    expect(seedMutualAccepted(rows, DEMO_LEARNER_ID, LEARNING_BOT_USER_ID, '2026-01-01T00:00:00.000Z')).toBeNull();
  });

  it('treats the iDO learn@savigna.local user as the demo learner', () => {
    expect(isDemoLearnerIdentity({ email: IDO_LEARN_EMAIL })).toBe(true);
    expect(isDemoLearnerIdentity({ id: IDO_LEARN_USER_ID })).toBe(true);
    expect(isDemoLearnerIdentity({ email: 'learn@savina.special' })).toBe(true);
  });
});

describe('listFriendRows', () => {
  it('groups incoming, outgoing, then accepted', () => {
    const rows = listFriendRows(
      [
        { ...pending(alex.id, me, 'in'), status: 'pending' },
        pending(me, mira.id, 'out'),
        {
          id: 'ok',
          requesterId: me,
          addresseeId: 'jordan',
          status: 'accepted',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'no',
          requesterId: me,
          addresseeId: 'x',
          status: 'declined',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      [
        alex,
        mira,
        { id: 'jordan', username: 'jordan', displayName: 'Jordan', email: 'jordan@savigna.local' },
      ],
      me
    );
    expect(rows.map((r) => r.kind)).toEqual(['incoming', 'outgoing', 'accepted']);
    expect(rows.every((r) => r.email.includes('@'))).toBe(true);
    expect(rows.find((r) => r.username === 'mira')?.handleLabel).toMatch(/@mira/);
    expect(rows.find((r) => r.username === 'jordan')?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(kindForViewer(pending(alex.id, me), me)).toBe('incoming');
  });

  it('marks a missing directory account as inconsistent', () => {
    const rows = listFriendRows(
      [
        {
          id: 'gone',
          requesterId: me,
          addresseeId: 'deleted-user',
          status: 'accepted',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      [],
      me
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].inconsistent).toBe(true);
    expect(rows[0].inconsistency).toBe('not_found');
  });
});

describe('deleted pairs are not re-seeded', () => {
  it('skips seed when the pair was deleted', () => {
    const rows: Friendship[] = [];
    const deleted = [friendshipPairKey(DEMO_LEARNER_ID, ICESTORM_PROFILE_ID)];
    expect(isDeletedPair(deleted, DEMO_LEARNER_ID, ICESTORM_PROFILE_ID)).toBe(true);
    expect(
      seedMutualAccepted(rows, DEMO_LEARNER_ID, ICESTORM_PROFILE_ID, '2026-01-01T00:00:00.000Z', deleted)
    ).toBeNull();
    expect(rows).toHaveLength(0);
  });
});

describe('profileEmail', () => {
  it('requires a real email', () => {
    expect(profileEmail(alex)).toBe('alex@savigna.local');
    expect(profileEmail({ ...alex, email: '' })).toBeNull();
    expect(friendInconsistencyMessage('not_found')).toMatch(/no longer found/i);
  });
});

describe('friendRequestErrorMessage', () => {
  it('has copy for each error', () => {
    expect(friendRequestErrorMessage('not_found')).toMatch(/email|user id/i);
    expect(friendRequestErrorMessage('not_found_savigna')).toMatch(/SavignaLearn/i);
    expect(friendRequestErrorMessage('not_found_ido')).toMatch(/iDO/i);
    expect(friendRequestErrorMessage('malformed_link')).toMatch(/link/i);
    expect(friendRequestErrorMessage('empty')).toMatch(/email/i);
    expect(friendRequestErrorMessage('missing_email')).toMatch(/email/i);
    expect(friendRequestErrorMessage('self')).toMatch(/you/i);
    expect(friendRequestErrorMessage('username_ambiguous')).toMatch(/email/i);
  });
});

describe('duplicate usernames fall back to email', () => {
  const learn: PublicProfile = {
    id: IDO_LEARN_USER_ID,
    username: 'learn',
    displayName: 'Learn',
    email: IDO_LEARN_EMAIL,
  };
  const savinaAsLearn: PublicProfile = {
    id: IDO_SAVINA_USER_ID,
    username: 'learn',
    displayName: 'Learn',
    email: IDO_SAVINA_EMAIL,
  };
  const savina: PublicProfile = {
    id: IDO_SAVINA_USER_ID,
    username: 'savina',
    displayName: 'Learn',
    email: IDO_SAVINA_EMAIL,
  };

  it('treats same-email stub and live ids as one person', () => {
    expect(
      ambiguousUsernames([
        { id: 'stub', username: 'learner', displayName: 'Learner', email: 'learner@savigna.local' },
        { id: 'live', username: 'learner', displayName: 'Learner', email: 'learner@savigna.local' },
      ]).has('learner')
    ).toBe(false);
  });

  it('flags @learn when two emails share it', () => {
    expect(ambiguousUsernames([learn, savinaAsLearn]).has('learn')).toBe(true);
    expect(friendIdentitySubtitle(savinaAsLearn, [learn, savinaAsLearn])).toBe(IDO_SAVINA_EMAIL);
    expect(publicIdentityLabel(learn, [learn, savinaAsLearn])).toBe(IDO_LEARN_EMAIL);
    expect(publicIdentityCopyValue(learn, [learn, savinaAsLearn])).toBe(IDO_LEARN_EMAIL);
    expect(inboxPartnerTitle(savinaAsLearn, [learn, savinaAsLearn])).toBe(IDO_SAVINA_EMAIL);
  });

  it('uses email as the inbox title when display names collide', () => {
    expect(inboxPartnerTitle(savina, [learn, savina])).toBe(IDO_SAVINA_EMAIL);
    expect(friendIdentitySubtitle(savina, [learn, savina])).toMatch(/@savina/);
  });

  it('keeps documented handles for known emails', () => {
    expect(usernameFromEmail(IDO_SAVINA_EMAIL)).toBe('savina');
    expect(usernameFromEmail(IDO_LEARN_EMAIL)).toBe('learn');
  });

  it('labels friend rows with email when the handle is shared', () => {
    const rows = listFriendRows(
      [
        {
          id: 'a',
          requesterId: me,
          addresseeId: learn.id,
          status: 'accepted',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'b',
          requesterId: me,
          addresseeId: savinaAsLearn.id,
          status: 'accepted',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      [learn, savinaAsLearn],
      me
    );
    expect(rows.map((row) => row.handleLabel).sort()).toEqual([IDO_LEARN_EMAIL, IDO_SAVINA_EMAIL].sort());
    expect(rows.map((row) => row.inboxTitle).sort()).toEqual([IDO_LEARN_EMAIL, IDO_SAVINA_EMAIL].sort());
  });
});
