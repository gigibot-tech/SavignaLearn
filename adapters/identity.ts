import type { AuthUser } from '@/ports/ports';

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
