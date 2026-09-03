/**
 * In-memory friends graph. Demo directory ships Alex / Mira / Jordan plus
 * mutual learner@ ↔ icestormfroste@gmail.com. Meetups are not modeled here.
 */

import { LEARNING_BOT_USER_ID } from '@/domain/chat';
import {
  DEMO_LEARNER_EMAIL,
  DEMO_LEARNER_ID,
  FriendRequestFailed,
  FRIEND_SHARE_ORIGIN,
  ICESTORM_EMAIL,
  ICESTORM_PROFILE_ID,
  ICESTORM_USERNAME,
  dualDirectoryError,
  existingIncomingFrom,
  friendshipPairKey,
  isDeletedPair,
  isDemoLearnerIdentity,
  isIcestormIdentity,
  listFriendRows,
  normalizeEmail,
  normalizeUsername,
  parseFriendIdentifier,
  friendShareUrl,
  profileEmail,
  seedMutualAccepted,
  validateFriendRequest,
  type DirectoryPresence,
  type Friendship,
  type FriendRow,
  type PublicProfile,
} from '@/domain/friends';
import type { FriendsRepository, UserDirectoryPort } from '@/ports/ports';
import type { Conversation } from '@/domain/chat';
import type { ChatRepository } from '@/ports/ports';
import {
  DEMO_DIRECTORY_PROFILES,
  InMemoryUserDirectory,
  createIdoUserDirectory,
  lookupInDirectory,
} from '@/adapters/userDirectory';
import { isIdoAiConfigured } from '@/adapters/idoAi';

export const DEMO_FRIEND_PROFILES: PublicProfile[] = DEMO_DIRECTORY_PROFILES.filter(
  (profile) => profile.id !== DEMO_LEARNER_ID
);

export type FriendsRepoOptions = {
  seed?: boolean;
  /** When true, the addressee must also resolve in `idoDirectory`. */
  idoConfigured?: boolean;
  idoDirectory?: UserDirectoryPort;
};

export class InMemoryFriendsRepository implements FriendsRepository {
  profiles = new Map<string, PublicProfile>();
  friendships: Friendship[] = [];
  deletedPairs = new Set<string>();
  idoConfigured: boolean | undefined;
  idoDirectory: UserDirectoryPort;

  constructor(seedOrOptions: boolean | FriendsRepoOptions = true) {
    const options =
      typeof seedOrOptions === 'boolean' ? { seed: seedOrOptions } : seedOrOptions;
    this.idoConfigured = options.idoConfigured;
    this.idoDirectory = options.idoDirectory ?? new InMemoryUserDirectory(DEMO_DIRECTORY_PROFILES);
    if (options.seed !== false) {
      for (const profile of DEMO_DIRECTORY_PROFILES) {
        this.putProfile(profile);
      }
    }
  }

  private putProfile(profile: PublicProfile) {
    const email = profileEmail(profile);
    if (!email) return;
    const username = normalizeUsername(profile.username);
    this.profiles.set(profile.id, { ...profile, username, email });
  }

  private savignaDirectory(): InMemoryUserDirectory {
    const dir = new InMemoryUserDirectory();
    dir.profiles = this.profiles;
    return dir;
  }

  private shouldCheckIdo(): boolean {
    return this.idoConfigured ?? isIdoAiConfigured();
  }

  private profileByEmail(email: string): PublicProfile | undefined {
    const needle = normalizeEmail(email);
    return [...this.profiles.values()].find((item) => item.email === needle);
  }

  private rebindProfile(fromId: string, into: PublicProfile) {
    if (fromId === into.id) {
      this.putProfile(into);
      return;
    }
    const previous = this.profiles.get(fromId);
    this.putProfile({
      ...previous,
      ...into,
      username: into.username || previous?.username || normalizeUsername(into.displayName),
      email: into.email || previous?.email,
    });
    if (fromId !== into.id) this.profiles.delete(fromId);
    for (const row of this.friendships) {
      if (row.requesterId === fromId) row.requesterId = into.id;
      if (row.addresseeId === fromId) row.addresseeId = into.id;
    }
  }

  async registerProfile(profile: PublicProfile): Promise<void> {
    const email = profile.email ? normalizeEmail(profile.email) : undefined;
    const byEmail = email ? this.profileByEmail(email) : undefined;
    if (byEmail && byEmail.id !== profile.id) {
      this.rebindProfile(byEmail.id, { ...profile, email });
      return;
    }
    if (isIcestormIdentity(profile) && this.profiles.has(ICESTORM_PROFILE_ID) && profile.id !== ICESTORM_PROFILE_ID) {
      this.rebindProfile(ICESTORM_PROFILE_ID, { ...profile, email: email ?? ICESTORM_EMAIL });
      return;
    }
    this.putProfile(profile);
  }

  async findByUsername(username: string): Promise<PublicProfile | null> {
    const needle = normalizeUsername(username);
    if (!needle) return null;
    return [...this.profiles.values()].find((item) => item.username === needle) ?? null;
  }

  async listFor(viewerId: string): Promise<Friendship[]> {
    return this.friendships.filter(
      (row) => row.requesterId === viewerId || row.addresseeId === viewerId
    );
  }

  async listProfiles(ids: string[]): Promise<PublicProfile[]> {
    return ids.map((id) => this.profiles.get(id)).filter((item): item is PublicProfile => Boolean(item));
  }

  async request(viewerId: string, identifier: string): Promise<Friendship> {
    const parsed = parseFriendIdentifier(identifier);
    if (parsed.kind === 'empty') throw new FriendRequestFailed('empty');
    if (parsed.kind === 'malformed') throw new FriendRequestFailed('malformed_link');

    const savigna = await lookupInDirectory(this.savignaDirectory(), parsed);
    const idoConfigured = this.shouldCheckIdo();
    const ido = idoConfigured ? await lookupInDirectory(this.idoDirectory, parsed) : savigna;
    const dirError = dualDirectoryError({ savigna, ido, idoConfigured });
    if (dirError) throw new FriendRequestFailed(dirError);

    const target = savigna!;
    if (target.id === LEARNING_BOT_USER_ID) throw new FriendRequestFailed('not_found');
    const email = profileEmail(target) ?? (parsed.kind === 'email' ? parsed.email : null);
    if (!email) throw new FriendRequestFailed('missing_email');
    const resolved: PublicProfile = { ...target, email };

    const existing = await this.listFor(viewerId);
    const incoming = existingIncomingFrom(existing, viewerId, resolved.id);
    if (incoming) {
      incoming.status = 'accepted';
      return incoming;
    }
    const check = validateFriendRequest({ viewerId, target: resolved, existing });
    if (!check.ok) throw new FriendRequestFailed(check.error);
    const row: Friendship = {
      id: `fr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      requesterId: viewerId,
      addresseeId: resolved.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.friendships.push(row);
    return row;
  }

  async accept(viewerId: string, friendshipId: string): Promise<void> {
    const row = this.friendships.find((item) => item.id === friendshipId);
    if (!row || row.addresseeId !== viewerId) throw new FriendRequestFailed('not_found');
    const rows = await this.reconcile(viewerId);
    const view = rows.find((item) => item.friendshipId === friendshipId);
    if (view?.inconsistent) {
      throw new FriendRequestFailed(view.inconsistency === 'missing_email' ? 'missing_email' : 'not_found');
    }
    row.status = 'accepted';
  }

  async decline(viewerId: string, friendshipId: string): Promise<void> {
    const row = this.friendships.find((item) => item.id === friendshipId);
    if (!row || row.addresseeId !== viewerId) throw new FriendRequestFailed('not_found');
    row.status = 'declined';
  }

  async remove(viewerId: string, friendshipId: string): Promise<void> {
    const row = this.friendships.find((item) => item.id === friendshipId);
    if (!row) throw new FriendRequestFailed('not_found');
    if (row.requesterId !== viewerId && row.addresseeId !== viewerId) {
      throw new FriendRequestFailed('not_found');
    }
    this.deletedPairs.add(friendshipPairKey(row.requesterId, row.addresseeId));
    this.friendships = this.friendships.filter((item) => item.id !== friendshipId);
  }

  async reconcile(viewerId: string): Promise<FriendRow[]> {
    const list = await this.listFor(viewerId);
    const ids = [
      ...new Set(list.flatMap((row) => [row.requesterId, row.addresseeId])),
    ].filter((id) => id !== viewerId);
    const presence = new Map<string, DirectoryPresence>();
    const profiles: PublicProfile[] = [];
    const idoConfigured = this.shouldCheckIdo();
    for (const id of ids) {
      const stored = this.profiles.get(id) ?? null;
      const parsed = stored?.email
        ? parseFriendIdentifier(stored.email)
        : ({ kind: 'user_id', userId: id } as const);
      const savigna =
        stored ?? (await lookupInDirectory(this.savignaDirectory(), parsed));
      const ido = idoConfigured
        ? await lookupInDirectory(this.idoDirectory, parsed)
        : savigna;
      presence.set(id, { savigna, ido, idoConfigured });
      if (savigna) profiles.push(savigna);
    }
    return listFriendRows(list, profiles, viewerId, presence);
  }

  /**
   * Demo inbox: Mira is a friend, Alex sent a request.
   * learner@ and icestormfroste@gmail.com always share a mutual accepted pair.
   */
  seedForViewer(viewerId: string, viewer?: { id?: string; email?: string }) {
    const email = viewer?.email ? normalizeEmail(viewer.email) : undefined;
    const identity = { id: viewerId, email };

    if (isIcestormIdentity(identity) && viewerId !== ICESTORM_PROFILE_ID) {
      const existing = this.profiles.get(ICESTORM_PROFILE_ID);
      if (existing) {
        this.rebindProfile(ICESTORM_PROFILE_ID, {
          ...existing,
          id: viewerId,
          email: ICESTORM_EMAIL,
          username: ICESTORM_USERNAME,
          displayName: existing.displayName || ICESTORM_USERNAME,
        });
      } else {
        this.putProfile({
          id: viewerId,
          username: ICESTORM_USERNAME,
          displayName: ICESTORM_USERNAME,
          email: ICESTORM_EMAIL,
        });
      }
    }

    const mira = this.profiles.get('friend-mira');
    const alex = this.profiles.get('friend-alex');
    const hasPair = (otherId: string) =>
      this.friendships.some(
        (row) =>
          friendshipPairKey(row.requesterId, row.addresseeId) === friendshipPairKey(viewerId, otherId)
      ) || isDeletedPair(this.deletedPairs, viewerId, otherId);
    if (mira && !hasPair(mira.id)) {
      this.friendships.push({
        id: `seed-mira-${viewerId}`,
        requesterId: viewerId,
        addresseeId: mira.id,
        status: 'accepted',
        createdAt: new Date().toISOString(),
      });
    }
    if (alex && !hasPair(alex.id)) {
      this.friendships.push({
        id: `seed-alex-${viewerId}`,
        requesterId: alex.id,
        addresseeId: viewerId,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }

    const learnerProfile =
      this.profiles.get(DEMO_LEARNER_ID) ??
      this.profileByEmail(DEMO_LEARNER_EMAIL) ??
      ({
        id: DEMO_LEARNER_ID,
        username: 'learner',
        displayName: 'Learner',
        email: DEMO_LEARNER_EMAIL,
      } satisfies PublicProfile);
    if (!this.profiles.has(learnerProfile.id)) this.putProfile(learnerProfile);

    const iceProfile =
      this.profileByEmail(ICESTORM_EMAIL) ??
      this.profiles.get(ICESTORM_PROFILE_ID) ??
      ({
        id: ICESTORM_PROFILE_ID,
        username: ICESTORM_USERNAME,
        displayName: ICESTORM_USERNAME,
        email: ICESTORM_EMAIL,
      } satisfies PublicProfile);
    if (!this.profiles.has(iceProfile.id)) this.putProfile(iceProfile);

    const viewerIsLearner = isDemoLearnerIdentity(identity);
    const viewerIsIce = isIcestormIdentity(identity);
    if (viewerIsLearner || viewerIsIce) {
      const learnerId = learnerProfile.id;
      const iceId = iceProfile.id;
      seedMutualAccepted(
        this.friendships,
        learnerId,
        iceId,
        new Date().toISOString(),
        this.deletedPairs
      );
    }
  }
}

export const memoryFriends = new InMemoryFriendsRepository();

export function createFriendsRepository(): FriendsRepository {
  memoryFriends.idoDirectory = createIdoUserDirectory();
  return memoryFriends;
}

export function usernameFromUser(user: { id: string; email?: string; displayName?: string }): string {
  if (user.displayName && !user.displayName.includes('@')) {
    return normalizeUsername(user.displayName.replace(/\s+/g, ''));
  }
  const local = user.email?.split('@')[0];
  if (local) return normalizeUsername(local);
  return `savigna${user.id.slice(-4)}`;
}

export function currentFriendShareUrl(userId: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : FRIEND_SHARE_ORIGIN;
  return friendShareUrl(userId, origin);
}

export async function findOrCreateDirectChat(
  chat: ChatRepository,
  viewer: { id: string; nativeLang?: string; learningLang?: string },
  other: PublicProfile
): Promise<Conversation> {
  const existing = await chat.listConversations(viewer.id);
  const found = existing.find((item) => {
    if (item.participantIds.includes(LEARNING_BOT_USER_ID)) return false;
    return (
      item.participantIds.includes(viewer.id) && item.participantIds.includes(other.id)
    );
  });
  if (found) return found;
  return chat.createConversation({
    participantIds: [viewer.id, other.id],
    participants: [
      {
        userId: viewer.id,
        nativeLang: viewer.nativeLang ?? 'en',
        learningLang: viewer.learningLang ?? 'de',
      },
      {
        userId: other.id,
        nativeLang: 'de',
        learningLang: 'en',
      },
    ],
    aiEnabled: true,
    title: other.displayName,
  });
}
