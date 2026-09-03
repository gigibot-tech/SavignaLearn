/**
 * Friends graph — add by email, user id, or share link; pending requests; accepted DMs.
 * Meetups are out of scope (SavignaLearn is chat + friends only).
 */

import { LEARNING_BOT_USER_ID } from './chat';

export type FriendshipStatus = 'pending' | 'accepted' | 'declined';

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  /** Required — never store or friend a profile without a real email. */
  email: string;
}

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: string;
}

export type FriendRowKind = 'accepted' | 'incoming' | 'outgoing';

export type FriendInconsistency = 'not_found' | 'not_found_savigna' | 'not_found_ido' | 'missing_email';

export interface FriendRow {
  friendshipId: string;
  userId: string;
  username: string;
  displayName: string;
  email: string;
  kind: FriendRowKind;
  inconsistent: boolean;
  inconsistency: FriendInconsistency | null;
}

export type DirectoryPresence = {
  savigna: PublicProfile | null;
  ido: PublicProfile | null;
  idoConfigured: boolean;
};

export const DEMO_LEARNER_ID = 'demo-user';
export const DEMO_LEARNER_EMAIL = 'learner@savigna.local';
export const ICESTORM_PROFILE_ID = 'friend-icestormfroste';
export const ICESTORM_EMAIL = 'icestormfroste@gmail.com';
export const ICESTORM_USERNAME = 'icestormfroste';

/** Canonical share path: `/friends?add=<userId>`. */
export const FRIEND_SHARE_ORIGIN = 'https://savignalearn.app';
export const FRIEND_SHARE_QUERY = 'add';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function friendshipPairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export function otherFriendId(row: Friendship, viewerId: string): string {
  return row.requesterId === viewerId ? row.addresseeId : row.requesterId;
}

export function kindForViewer(row: Friendship, viewerId: string): FriendRowKind | null {
  if (row.status === 'declined') return null;
  if (row.status === 'accepted') return 'accepted';
  if (row.requesterId === viewerId) return 'outgoing';
  if (row.addresseeId === viewerId) return 'incoming';
  return null;
}

export type FriendRequestError =
  | 'empty'
  | 'self'
  | 'not_found'
  | 'not_found_savigna'
  | 'not_found_ido'
  | 'malformed_link'
  | 'missing_email'
  | 'already_friends'
  | 'already_requested';

export class FriendRequestFailed extends Error {
  readonly error: FriendRequestError;

  constructor(error: FriendRequestError) {
    super(error);
    this.name = 'FriendRequestFailed';
    this.error = error;
  }
}

export type ParsedFriendIdentifier =
  | { kind: 'empty' }
  | { kind: 'malformed' }
  | { kind: 'email'; email: string }
  | { kind: 'user_id'; userId: string }
  | { kind: 'username'; username: string };

export function friendSharePath(userId: string): string {
  return `/friends?${FRIEND_SHARE_QUERY}=${encodeURIComponent(userId)}`;
}

export function friendShareUrl(userId: string, origin = FRIEND_SHARE_ORIGIN): string {
  return `${origin.replace(/\/$/, '')}${friendSharePath(userId)}`;
}

export function parseFriendShareInput(
  raw: string
): { kind: 'user_id'; userId: string } | { kind: 'malformed' } | { kind: 'not_link' } {
  const trimmed = raw.trim();
  const looksLikeLink =
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith('/friends') ||
    /^friends\?/i.test(trimmed) ||
    /\/friends\?/i.test(trimmed);

  if (!looksLikeLink) return { kind: 'not_link' };

  try {
    const absolute = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://savignalearn.app${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
    const url = new URL(absolute);
    const isFriendsPath = url.pathname.replace(/\/$/, '') === '/friends';
    const add = url.searchParams.get(FRIEND_SHARE_QUERY)?.trim() ?? '';
    if (isFriendsPath && add) return { kind: 'user_id', userId: add };
    return { kind: 'malformed' };
  } catch {
    return { kind: 'malformed' };
  }
}

export function parseFriendIdentifier(raw: string): ParsedFriendIdentifier {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  const fromLink = parseFriendShareInput(trimmed);
  if (fromLink.kind === 'malformed') return { kind: 'malformed' };
  if (fromLink.kind === 'user_id') return fromLink;

  if (EMAIL_RE.test(trimmed)) {
    return { kind: 'email', email: normalizeEmail(trimmed) };
  }
  if (trimmed.includes('@') && !trimmed.startsWith('@')) return { kind: 'malformed' };

  if (UUID_RE.test(trimmed)) return { kind: 'user_id', userId: trimmed.toLowerCase() };

  const username = normalizeUsername(trimmed);
  if (!username) return { kind: 'empty' };
  return { kind: 'username', username };
}

export function dualDirectoryError(input: {
  savigna: PublicProfile | null;
  ido: PublicProfile | null;
  idoConfigured: boolean;
}): FriendRequestError | null {
  if (input.idoConfigured) {
    if (!input.savigna && !input.ido) return 'not_found';
    if (!input.savigna) return 'not_found_savigna';
    if (!input.ido) return 'not_found_ido';
    return null;
  }
  if (!input.savigna) return 'not_found';
  return null;
}

export function profileEmail(profile: PublicProfile | null | undefined): string | null {
  if (!profile?.email) return null;
  const email = normalizeEmail(profile.email);
  return EMAIL_RE.test(email) ? email : null;
}

/** A friend is inconsistent when they vanished from a directory or lost their email. */
export function friendInconsistency(presence: DirectoryPresence): FriendInconsistency | null {
  const dir = dualDirectoryError(presence);
  if (dir === 'not_found' || dir === 'not_found_savigna' || dir === 'not_found_ido') return dir;
  const email = profileEmail(presence.savigna) ?? profileEmail(presence.ido);
  if (!email) return 'missing_email';
  return null;
}

export function isDeletedPair(deletedKeys: Iterable<string>, a: string, b: string): boolean {
  const key = friendshipPairKey(a, b);
  for (const item of deletedKeys) {
    if (item === key) return true;
  }
  return false;
}

export function validateFriendRequest(input: {
  viewerId: string;
  target: PublicProfile | null;
  existing: Friendship[];
}): { ok: true } | { ok: false; error: FriendRequestError } {
  if (!input.target) return { ok: false, error: 'not_found' };
  if (input.target.id === LEARNING_BOT_USER_ID) return { ok: false, error: 'not_found' };
  if (!profileEmail(input.target)) return { ok: false, error: 'missing_email' };
  if (input.target.id === input.viewerId) return { ok: false, error: 'self' };
  const pair = friendshipPairKey(input.viewerId, input.target.id);
  const found = input.existing.find(
    (row) => friendshipPairKey(row.requesterId, row.addresseeId) === pair && row.status !== 'declined'
  );
  if (!found) return { ok: true };
  if (found.status === 'accepted') return { ok: false, error: 'already_friends' };
  return { ok: false, error: 'already_requested' };
}

/** If the other person already requested us, accepting that pending row is the right move. */
export function existingIncomingFrom(
  existing: Friendship[],
  viewerId: string,
  targetId: string
): Friendship | undefined {
  return existing.find(
    (row) =>
      row.status === 'pending' && row.requesterId === targetId && row.addresseeId === viewerId
  );
}

export function listFriendRows(
  existing: Friendship[],
  profiles: PublicProfile[],
  viewerId: string,
  presenceByUserId?: Map<string, DirectoryPresence>
): FriendRow[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const rows: FriendRow[] = [];
  for (const item of existing) {
    const kind = kindForViewer(item, viewerId);
    if (!kind) continue;
    if (item.requesterId !== viewerId && item.addresseeId !== viewerId) continue;
    const otherId = otherFriendId(item, viewerId);
    if (otherId === LEARNING_BOT_USER_ID) continue;
    const profile = byId.get(otherId);
    const presence = presenceByUserId?.get(otherId) ?? {
      savigna: profile ?? null,
      ido: profile ?? null,
      idoConfigured: false,
    };
    const inconsistency = friendInconsistency(presence);
    const email = profileEmail(profile) ?? profileEmail(presence.savigna) ?? profileEmail(presence.ido) ?? '';
    rows.push({
      friendshipId: item.id,
      userId: otherId,
      username: profile?.username ?? otherId.slice(0, 8),
      displayName: profile?.displayName ?? profile?.username ?? 'Friend',
      email,
      kind,
      inconsistent: Boolean(inconsistency),
      inconsistency,
    });
  }
  const order: Record<FriendRowKind, number> = { incoming: 0, outgoing: 1, accepted: 2 };
  return rows.sort((a, b) => {
    if (a.inconsistent !== b.inconsistent) return a.inconsistent ? 1 : -1;
    return order[a.kind] - order[b.kind] || a.displayName.localeCompare(b.displayName);
  });
}

export function friendRequestErrorMessage(error: FriendRequestError): string {
  switch (error) {
    case 'empty':
      return 'Enter an email, user id, or friend link';
    case 'self':
      return 'That’s you';
    case 'not_found':
      return 'No one with that email or user id in SavignaLearn or iDO';
    case 'not_found_savigna':
      return 'This person has an iDO account but isn’t on SavignaLearn yet. They need both.';
    case 'not_found_ido':
      return 'This person is on SavignaLearn but isn’t in the iDO directory. They need both.';
    case 'missing_email':
      return 'That account has no email, so it can’t be added as a friend';
    case 'malformed_link':
      return 'That friend link isn’t valid. Use a link like /friends?add=<user-id>.';
    case 'already_friends':
      return 'Already friends';
    case 'already_requested':
      return 'Request already sent';
  }
}

export function friendInconsistencyMessage(reason: FriendInconsistency): string {
  switch (reason) {
    case 'not_found':
      return 'Account no longer found in SavignaLearn or iDO';
    case 'not_found_savigna':
      return 'No longer on SavignaLearn';
    case 'not_found_ido':
      return 'No longer in the iDO directory';
    case 'missing_email':
      return 'This account has no email';
  }
}

export function isLearningBotId(id: string): boolean {
  return id === LEARNING_BOT_USER_ID;
}

export function isDemoLearnerIdentity(user: { id?: string; email?: string }): boolean {
  return user.id === DEMO_LEARNER_ID || normalizeEmail(user.email ?? '') === DEMO_LEARNER_EMAIL;
}

export function isIcestormIdentity(user: { id?: string; email?: string; username?: string }): boolean {
  return (
    user.id === ICESTORM_PROFILE_ID ||
    normalizeEmail(user.email ?? '') === ICESTORM_EMAIL ||
    normalizeUsername(user.username ?? '') === ICESTORM_USERNAME
  );
}

/** Insert or upgrade a mutual accepted pair. Never friends the learning bot. */
export function seedMutualAccepted(
  existing: Friendship[],
  a: string,
  b: string,
  createdAt: string,
  deletedKeys: Iterable<string> = []
): Friendship | null {
  if (!a || !b || a === b) return null;
  if (isLearningBotId(a) || isLearningBotId(b)) return null;
  if (isDeletedPair(deletedKeys, a, b)) return null;
  const pair = friendshipPairKey(a, b);
  const found = existing.find(
    (row) => friendshipPairKey(row.requesterId, row.addresseeId) === pair && row.status !== 'declined'
  );
  if (found) {
    if (found.status === 'accepted') return null;
    found.status = 'accepted';
    return found;
  }
  const row: Friendship = {
    id: `seed-${pair}`,
    requesterId: a,
    addresseeId: b,
    status: 'accepted',
    createdAt,
  };
  existing.push(row);
  return row;
}

export function profileFromEmailLocalPart(
  id: string,
  email: string,
  displayName?: string
): PublicProfile {
  const normalized = normalizeEmail(email);
  const username = normalizeUsername(normalized.split('@')[0] ?? id);
  return {
    id,
    email: normalized,
    username,
    displayName: displayName ?? username,
  };
}
