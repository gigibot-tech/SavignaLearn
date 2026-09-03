/**
 * User directories for friend requests: SavignaLearn in-memory store + optional iDO profiles.
 * Live iDO lookup is read-only (profiles by id / username). Email uses the local-part username
 * plus the demo overlay so local demo still works when iDO isn’t reachable.
 */

import { getIdoSupabase, isIdoAiConfigured } from '@/adapters/idoAi';
import {
  ICESTORM_EMAIL,
  ICESTORM_PROFILE_ID,
  ICESTORM_USERNAME,
  DEMO_LEARNER_EMAIL,
  DEMO_LEARNER_ID,
  normalizeEmail,
  normalizeUsername,
  parseFriendIdentifier,
  type ParsedFriendIdentifier,
  type PublicProfile,
} from '@/domain/friends';
import type { UserDirectoryPort } from '@/ports/ports';

export const DEMO_DIRECTORY_PROFILES: PublicProfile[] = [
  { id: 'friend-alex', username: 'alex', displayName: 'Alex', email: 'alex@savigna.local' },
  { id: 'friend-mira', username: 'mira', displayName: 'Mira', email: 'mira@savigna.local' },
  { id: 'friend-jordan', username: 'jordan', displayName: 'Jordan', email: 'jordan@savigna.local' },
  {
    id: ICESTORM_PROFILE_ID,
    username: ICESTORM_USERNAME,
    displayName: ICESTORM_USERNAME,
    email: ICESTORM_EMAIL,
  },
  {
    id: DEMO_LEARNER_ID,
    username: 'learner',
    displayName: 'Learner',
    email: DEMO_LEARNER_EMAIL,
  },
];

export class InMemoryUserDirectory implements UserDirectoryPort {
  profiles = new Map<string, PublicProfile>();

  constructor(seed: PublicProfile[] = []) {
    for (const profile of seed) {
      this.put(profile);
    }
  }

  put(profile: PublicProfile) {
    const username = normalizeUsername(profile.username);
    const email = profile.email ? normalizeEmail(profile.email) : undefined;
    this.profiles.set(profile.id, { ...profile, username, email });
  }

  async findByEmail(email: string): Promise<PublicProfile | null> {
    const needle = normalizeEmail(email);
    if (!needle) return null;
    return [...this.profiles.values()].find((item) => item.email === needle) ?? null;
  }

  async findById(id: string): Promise<PublicProfile | null> {
    return this.profiles.get(id) ?? null;
  }

  async findByUsername(username: string): Promise<PublicProfile | null> {
    const needle = normalizeUsername(username);
    if (!needle) return null;
    return [...this.profiles.values()].find((item) => item.username === needle) ?? null;
  }
}

/** First hit wins — live iDO then demo overlay, or Savigna then overlay. */
export class CompositeUserDirectory implements UserDirectoryPort {
  constructor(private readonly dirs: UserDirectoryPort[]) {}

  async findByEmail(email: string): Promise<PublicProfile | null> {
    for (const dir of this.dirs) {
      const hit = await dir.findByEmail(email);
      if (hit) return hit;
    }
    return null;
  }

  async findById(id: string): Promise<PublicProfile | null> {
    for (const dir of this.dirs) {
      const hit = await dir.findById(id);
      if (hit) return hit;
    }
    return null;
  }

  async findByUsername(username: string): Promise<PublicProfile | null> {
    for (const dir of this.dirs) {
      const hit = await dir.findByUsername(username);
      if (hit) return hit;
    }
    return null;
  }
}

function toPublicProfile(row: {
  id: string;
  username?: string | null;
  display_name?: string | null;
}): PublicProfile {
  const username = normalizeUsername(row.username || row.display_name || row.id.slice(0, 8));
  return {
    id: row.id,
    username,
    displayName: row.display_name || username,
  };
}

/** Read-only iDO `profiles` lookup. Failures resolve to null (caller falls through). */
export class IdoProfilesDirectory implements UserDirectoryPort {
  async findByEmail(email: string): Promise<PublicProfile | null> {
    const local = normalizeUsername(normalizeEmail(email).split('@')[0] ?? '');
    if (!local) return null;
    return this.findByUsername(local);
  }

  async findById(id: string): Promise<PublicProfile | null> {
    return this.query('id', id);
  }

  async findByUsername(username: string): Promise<PublicProfile | null> {
    const needle = normalizeUsername(username);
    if (!needle) return null;
    return this.query('username', needle);
  }

  private async query(column: 'id' | 'username', value: string): Promise<PublicProfile | null> {
    if (!isIdoAiConfigured()) return null;
    try {
      const { data, error } = await getIdoSupabase()
        .from('profiles')
        .select('id, username, display_name')
        .eq(column, value)
        .maybeSingle();
      if (error || !data) return null;
      return toPublicProfile(data as { id: string; username?: string | null; display_name?: string | null });
    } catch {
      return null;
    }
  }
}

export async function lookupInDirectory(
  dir: UserDirectoryPort,
  parsed: ParsedFriendIdentifier
): Promise<PublicProfile | null> {
  if (parsed.kind === 'email') return dir.findByEmail(parsed.email);
  if (parsed.kind === 'user_id') {
    return (await dir.findById(parsed.userId)) ?? dir.findByUsername(parsed.userId);
  }
  if (parsed.kind === 'username') {
    return (await dir.findByUsername(parsed.username)) ?? dir.findById(parsed.username);
  }
  return null;
}

export async function lookupIdentifier(
  dir: UserDirectoryPort,
  raw: string
): Promise<PublicProfile | null> {
  return lookupInDirectory(dir, parseFriendIdentifier(raw));
}

const demoIdoDirectory = new InMemoryUserDirectory(DEMO_DIRECTORY_PROFILES);

export function createDemoIdoDirectory(): InMemoryUserDirectory {
  return demoIdoDirectory;
}

export function createIdoUserDirectory(): UserDirectoryPort {
  const overlay = demoIdoDirectory;
  if (!isIdoAiConfigured()) return overlay;
  return new CompositeUserDirectory([new IdoProfilesDirectory(), overlay]);
}
