import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/domain/chat';
import { LEARNING_BOT_USER_ID } from '@/domain/chat';
import {
  DEMO_LEARNER_ID,
  FriendRequestFailed,
  ICESTORM_EMAIL,
  ICESTORM_PROFILE_ID,
  ICESTORM_USERNAME,
} from '@/domain/friends';
import type { ChatRepository } from '@/ports/ports';
import {
  findOrCreateDirectChat,
  InMemoryFriendsRepository,
  usernameFromUser,
} from './friends';
import { InMemoryUserDirectory } from './userDirectory';

function fakeChat(seed: Conversation[] = []): ChatRepository {
  const conversations = [...seed];
  return {
    async listConversations() {
      return conversations;
    },
    async getConversation(id) {
      return conversations.find((item) => item.id === id) ?? null;
    },
    async createConversation(input) {
      const conversation: Conversation = {
        id: `c-${conversations.length}`,
        participantIds: input.participantIds,
        participants: input.participants,
        aiEnabled: input.aiEnabled,
        title: input.title,
        updatedAt: new Date().toISOString(),
        unreadCount: 0,
      };
      conversations.push(conversation);
      return conversation;
    },
    async listMessages() {
      return [];
    },
    async appendMessage(message) {
      return message;
    },
    async updateReceipt() {},
    async saveTranslations() {},
    async listTranslations() {
      return [];
    },
    async updateParticipants() {},
    subscribe() {
      return () => {};
    },
  };
}

describe('InMemoryFriendsRepository', () => {
  it('adds by username, auto-accepts reverse pending, and lists', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    await friends.registerProfile({
      id: 'me',
      username: 'learner',
      displayName: 'Learner',
      email: 'me@savigna.local',
    });
    const sent = await friends.request('me', 'Jordan');
    expect(sent.status).toBe('pending');
    await expect(friends.request('me', 'jordan')).rejects.toMatchObject({ error: 'already_requested' });
    await friends.accept('friend-jordan', sent.id);
    const after = await friends.listFor('me');
    expect(after.find((row) => row.id === sent.id)?.status).toBe('accepted');
    const forJordan = await friends.listFor('friend-jordan');
    expect(forJordan.find((row) => row.id === sent.id)?.status).toBe('accepted');
  });

  it('accepts an incoming request when you add the same person', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    friends.seedForViewer('me');
    const row = await friends.request('me', 'alex');
    expect(row.status).toBe('accepted');
  });

  it('sends a request by email against the SavignaLearn directory', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    await friends.registerProfile({
      id: 'me',
      username: 'learner',
      displayName: 'Learner',
      email: 'learner@savigna.local',
    });
    const sent = await friends.request('me', 'jordan@savigna.local');
    expect(sent.addresseeId).toBe('friend-jordan');
    expect(sent.status).toBe('pending');
  });

  it('sends a request by user id and by share link', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    await friends.registerProfile({ id: 'me', username: 'me', displayName: 'Me', email: 'me@savigna.local' });
    const byId = await friends.request('me', 'friend-jordan');
    expect(byId.addresseeId).toBe('friend-jordan');
    const friends2 = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    await friends2.registerProfile({ id: 'me', username: 'me', displayName: 'Me', email: 'me@savigna.local' });
    const byLink = await friends2.request('me', 'https://savignalearn.app/friends?add=friend-mira');
    expect(byLink.addresseeId).toBe('friend-mira');
  });

  it('rejects unknown email, unknown user id, malformed link, and self', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    await friends.registerProfile({
      id: DEMO_LEARNER_ID,
      username: 'learner',
      displayName: 'Learner',
      email: 'learner@savigna.local',
    });
    await expect(friends.request(DEMO_LEARNER_ID, 'nobody@example.com')).rejects.toBeInstanceOf(
      FriendRequestFailed
    );
    await expect(friends.request(DEMO_LEARNER_ID, 'nobody@example.com')).rejects.toMatchObject({
      error: 'not_found',
    });
    await expect(
      friends.request(DEMO_LEARNER_ID, '00000000-0000-4000-8000-000000000000')
    ).rejects.toMatchObject({ error: 'not_found' });
    await expect(friends.request(DEMO_LEARNER_ID, 'https://savignalearn.app/friends')).rejects.toMatchObject({
      error: 'malformed_link',
    });
    await expect(friends.request(DEMO_LEARNER_ID, 'learner@savigna.local')).rejects.toMatchObject({
      error: 'self',
    });
  });

  it('yields a typed error when missing in SavignaLearn and/or iDO', async () => {
    const savignaOnly = new InMemoryUserDirectory([
      { id: 's-only', username: 'sonly', displayName: 'Savigna only', email: 'savigna-only@example.com' },
    ]);
    const idoOnly = new InMemoryUserDirectory([
      { id: 'i-only', username: 'ionly', displayName: 'iDO only', email: 'ido-only@example.com' },
    ]);
    const both = new InMemoryUserDirectory([
      { id: 'both', username: 'both', displayName: 'Both', email: 'both@example.com' },
    ]);
    const friends = new InMemoryFriendsRepository({
      seed: false,
      idoConfigured: true,
      idoDirectory: new InMemoryUserDirectory([
        ...idoOnly.profiles.values(),
        ...both.profiles.values(),
      ]),
    });
    for (const profile of [...savignaOnly.profiles.values(), ...both.profiles.values()]) {
      await friends.registerProfile(profile);
    }
    await friends.registerProfile({ id: 'me', username: 'me', displayName: 'Me', email: 'me@example.com' });

    await expect(friends.request('me', 'ghost@example.com')).rejects.toMatchObject({ error: 'not_found' });
    await expect(friends.request('me', 'ido-only@example.com')).rejects.toMatchObject({
      error: 'not_found_savigna',
    });
    await expect(friends.request('me', 'savigna-only@example.com')).rejects.toMatchObject({
      error: 'not_found_ido',
    });
    const ok = await friends.request('me', 'both@example.com');
    expect(ok.addresseeId).toBe('both');
  });

  it('seeds mutual learner ↔ icestormfroste for either sign-in', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    friends.seedForViewer(DEMO_LEARNER_ID, { id: DEMO_LEARNER_ID, email: 'learner@savigna.local' });
    const forLearner = await friends.listFor(DEMO_LEARNER_ID);
    const pair = forLearner.find(
      (row) =>
        row.status === 'accepted' &&
        [row.requesterId, row.addresseeId].includes(ICESTORM_PROFILE_ID)
    );
    expect(pair).toBeTruthy();

    const asIce = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    const liveId = '16e1c5d7-2908-44be-b53a-b7c0f0a00099';
    await asIce.registerProfile({
      id: liveId,
      username: ICESTORM_USERNAME,
      displayName: ICESTORM_USERNAME,
      email: ICESTORM_EMAIL,
    });
    asIce.seedForViewer(liveId, { id: liveId, email: ICESTORM_EMAIL });
    const forIce = await asIce.listFor(liveId);
    expect(
      forIce.some(
        (row) =>
          row.status === 'accepted' && [row.requesterId, row.addresseeId].includes(DEMO_LEARNER_ID)
      )
    ).toBe(true);
    const forDemo = await asIce.listFor(DEMO_LEARNER_ID);
    expect(
      forDemo.some(
        (row) => row.status === 'accepted' && [row.requesterId, row.addresseeId].includes(liveId)
      )
    ).toBe(true);
  });

  it('does not insert a ghost when the email is unknown', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: true });
    await friends.registerProfile({
      id: 'me',
      username: 'me',
      displayName: 'Me',
      email: 'me@savigna.local',
    });
    const before = friends.friendships.length;
    await expect(friends.request('me', 'totally-fake@example.com')).rejects.toMatchObject({
      error: 'not_found',
    });
    expect(friends.friendships).toHaveLength(before);
    expect([...friends.profiles.values()].some((p) => p.email === 'totally-fake@example.com')).toBe(
      false
    );
  });

  it('delete removes the pair both directions', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    friends.seedForViewer(DEMO_LEARNER_ID, { id: DEMO_LEARNER_ID, email: 'learner@savigna.local' });
    const ice = (await friends.listFor(DEMO_LEARNER_ID)).find(
      (row) =>
        row.status === 'accepted' &&
        [row.requesterId, row.addresseeId].includes(ICESTORM_PROFILE_ID)
    );
    expect(ice).toBeTruthy();
    await friends.remove(DEMO_LEARNER_ID, ice!.id);
    expect(
      (await friends.listFor(DEMO_LEARNER_ID)).some((row) =>
        [row.requesterId, row.addresseeId].includes(ICESTORM_PROFILE_ID)
      )
    ).toBe(false);
    expect(
      (await friends.listFor(ICESTORM_PROFILE_ID)).some((row) =>
        [row.requesterId, row.addresseeId].includes(DEMO_LEARNER_ID)
      )
    ).toBe(false);
  });

  it('decline deletes the request both ways and seed does not recreate it', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    friends.seedForViewer('me', { id: 'me', email: 'me@savigna.local' });
    const alex = (await friends.listFor('me')).find(
      (row) => row.status === 'pending' && row.requesterId === 'friend-alex'
    );
    expect(alex).toBeTruthy();
    await friends.decline('me', alex!.id);
    expect((await friends.listFor('me')).some((row) => row.id === alex!.id)).toBe(false);
    expect((await friends.listFor('friend-alex')).some((row) => row.id === alex!.id)).toBe(false);
    friends.seedForViewer('me', { id: 'me', email: 'me@savigna.local' });
    expect(
      (await friends.listFor('me')).some(
        (row) => row.status === 'pending' && row.requesterId === 'friend-alex'
      )
    ).toBe(false);
  });

  it('marks a deleted account inconsistent and delete does not recreate it', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    friends.seedForViewer('me', { id: 'me', email: 'me@savigna.local' });
    await friends.registerProfile({
      id: 'me',
      username: 'me',
      displayName: 'Me',
      email: 'me@savigna.local',
    });
    const miraId = 'friend-mira';
    friends.profiles.delete(miraId);
    const rows = await friends.reconcile('me');
    const mira = rows.find((row) => row.userId === miraId);
    expect(mira?.inconsistent).toBe(true);
    expect(mira?.inconsistency).toBe('not_found');
    await friends.remove('me', mira!.friendshipId);
    expect((await friends.listFor('me')).some((row) => [row.requesterId, row.addresseeId].includes(miraId))).toBe(
      false
    );
    expect((await friends.listFor(miraId)).some((row) => [row.requesterId, row.addresseeId].includes('me'))).toBe(
      false
    );
    friends.seedForViewer('me', { id: 'me', email: 'me@savigna.local' });
    expect((await friends.listFor('me')).some((row) => [row.requesterId, row.addresseeId].includes(miraId))).toBe(
      false
    );
  });

  it('directory entries always expose an email', async () => {
    const friends = new InMemoryFriendsRepository({ seed: true, idoConfigured: false });
    const profiles = await friends.listProfiles(['friend-alex', 'friend-mira', 'friend-jordan', 'friend-icestormfroste', 'demo-user']);
    expect(profiles.length).toBeGreaterThan(3);
    expect(profiles.every((p) => p.email.includes('@'))).toBe(true);
  });
});

describe('usernameFromUser', () => {
  it('uses the email local-part', () => {
    expect(usernameFromUser({ id: 'x', email: 'learner@savigna.local' })).toBe('learner');
    expect(usernameFromUser({ id: 'y', email: ICESTORM_EMAIL })).toBe('icestormfroste');
  });
});

describe('findOrCreateDirectChat', () => {
  it('reuses an existing DM and skips the bot thread', async () => {
    const chat = fakeChat([
      {
        id: 'demo-1',
        participantIds: ['me', LEARNING_BOT_USER_ID],
        participants: [],
        aiEnabled: true,
        updatedAt: new Date().toISOString(),
        unreadCount: 0,
        title: 'SavignasBoi',
      },
    ]);
    const mira = {
      id: 'friend-mira',
      username: 'mira',
      displayName: 'Mira',
      email: 'mira@savigna.local',
    };
    const first = await findOrCreateDirectChat(chat, { id: 'me' }, mira);
    const second = await findOrCreateDirectChat(chat, { id: 'me' }, mira);
    expect(first.id).toBe(second.id);
    expect(first.title).toBe('Mira');
    expect(first.participantIds.includes(LEARNING_BOT_USER_ID)).toBe(false);
  });
});
