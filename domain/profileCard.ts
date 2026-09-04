/**
 * Public profile card (photo, about, last-seen heartbeat) — separate from
 * friend-directory identity (PublicProfile).
 */

import {
  isLearningBotConversation,
  LEARNING_BOT_USER_ID,
  type Conversation,
} from './chat';
import { canonicalChatActorId } from './friends';

/** WhatsApp about-field length. */
export const PROFILE_BIO_MAX = 139;

export const LEARNING_BOT_BIO = 'Practice partner. Always here.';

export type ProfileCard = {
  userId: string;
  photoUrl: string | null;
  bio: string;
  lastSeenAt: string | null;
  presenceOptIn: boolean;
};

export function clampProfileBio(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, PROFILE_BIO_MAX);
}

export function emptyProfileCard(userId: string): ProfileCard {
  return {
    userId,
    photoUrl: null,
    bio: '',
    lastSeenAt: null,
    presenceOptIn: true,
  };
}

export function botProfileCard(): ProfileCard {
  return {
    userId: LEARNING_BOT_USER_ID,
    photoUrl: null,
    bio: LEARNING_BOT_BIO,
    lastSeenAt: new Date().toISOString(),
    presenceOptIn: true,
  };
}

export function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Cloud wins for photo/bio/opt-in; last seen is the later heartbeat. */
export function mergeProfileCards(local: ProfileCard | null, cloud: ProfileCard | null): ProfileCard | null {
  if (!cloud) return local;
  if (!local) return cloud;
  return {
    userId: cloud.userId || local.userId,
    photoUrl: cloud.photoUrl ?? local.photoUrl,
    bio: cloud.bio,
    lastSeenAt: laterIso(cloud.lastSeenAt, local.lastSeenAt),
    presenceOptIn: cloud.presenceOptIn,
  };
}

export function profileLookupIds(id: string): string[] {
  if (!id) return [];
  return [...new Set([id, canonicalChatActorId(id)])];
}

export function indexProfileCards(cards: ProfileCard[]): Map<string, ProfileCard> {
  const map = new Map<string, ProfileCard>();
  for (const card of cards) {
    for (const key of profileLookupIds(card.userId)) {
      map.set(key, card);
    }
  }
  return map;
}

export function profileCardFor(
  map: Map<string, ProfileCard>,
  userId: string | undefined | null
): ProfileCard | undefined {
  if (!userId) return undefined;
  return map.get(userId) ?? map.get(canonicalChatActorId(userId));
}

export function conversationPartnerIds(
  conversations: Array<Pick<Conversation, 'participantIds' | 'title'>>,
  selfIds: string[]
): string[] {
  const ids = new Set<string>();
  for (const conversation of conversations) {
    if (isLearningBotConversation(conversation)) {
      ids.add(LEARNING_BOT_USER_ID);
      continue;
    }
    const other = conversation.participantIds.find((id) => !selfIds.includes(id));
    if (other) ids.add(other);
  }
  return [...ids];
}
