import type { AuthUser } from '@/ports/ports';
import { ICESTORM_IDO_USER_ID, ICESTORM_PROFILE_ID, canonicalChatActorId, isIcestormIdentity } from '@/domain/friends';

export type IdentityUser = {
  id: string;
  email?: string;
  displayName?: string;
};

/** Prefer the fourSome user id when both sessions exist (GiGi needs that UUID). */
export function mergeIdentitySessions(input: {
  fourSome: IdentityUser | null;
  ido: IdentityUser | null;
}): AuthUser | null {
  const { fourSome, ido } = input;
  if (!fourSome && !ido) return null;
  const primary = fourSome ?? ido!;
  return {
    id: primary.id,
    email: fourSome?.email ?? ido?.email,
    displayName: fourSome?.displayName ?? ido?.displayName ?? primary.email,
    fourSomeUserId: fourSome?.id ?? null,
    idoUserId: ido?.id ?? null,
  };
}

/** User id to store on iDO savigna_* rows (never the fourSome id). */
export function chatPersistenceUserId(user: Pick<AuthUser, 'id' | 'idoUserId'>): string {
  return user.idoUserId || user.id;
}

export function chatActorIds(user: Pick<AuthUser, 'id' | 'idoUserId'>): string[] {
  return [...new Set([chatPersistenceUserId(user), user.id].filter(Boolean))];
}

/** Extra local KV keys to load so stub friend ids still find DMs after a real login. */
export function chatHydrateAliasIds(
  user: Pick<AuthUser, 'id' | 'idoUserId' | 'email' | 'displayName'>
): string[] {
  const ids = new Set(chatActorIds(user));
  const hints = [
    { id: user.id, email: user.email, username: user.displayName },
    { id: user.idoUserId ?? undefined, email: user.email, username: user.displayName },
  ];
  if (hints.some((hint) => isIcestormIdentity(hint))) {
    ids.add(ICESTORM_PROFILE_ID);
    ids.add(ICESTORM_IDO_USER_ID);
  }
  return [...ids].filter(Boolean);
}

export function isChatSelf(
  user: Pick<AuthUser, 'id' | 'idoUserId' | 'email'> | null | undefined,
  actorId: string
): boolean {
  if (!user) return false;
  if (chatActorIds(user).includes(actorId)) return true;
  const mine = new Set(chatActorIds(user).map(canonicalChatActorId));
  if (isIcestormIdentity(user)) mine.add(ICESTORM_IDO_USER_ID);
  return mine.has(canonicalChatActorId(actorId));
}

export function identityFromSupabaseUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): IdentityUser {
  const displayName =
    typeof user.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name
      : undefined;
  return {
    id: user.id,
    email: user.email ?? undefined,
    displayName: displayName ?? user.email ?? undefined,
  };
}
