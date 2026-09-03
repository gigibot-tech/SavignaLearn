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
  DEMO_LEARNER_IDO_USER_ID,
  IDO_LEARN_EMAIL,
  IDO_LEARN_USER_ID,
  IDO_SAVINA_EMAIL,
  IDO_SAVINA_USER_ID,
  normalizeEmail,
  normalizeUsername,
  parseFriendIdentifier,
  uniqueProfilesByPerson,
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
  {
    id: DEMO_LEARNER_IDO_USER_ID,
    username: 'learner',
    displayName: 'Learner',
    email: DEMO_LEARNER_EMAIL,
  },
  {
    id: IDO_LEARN_USER_ID,
    username: 'learn',
    displayName: 'Learn',
    email: IDO_LEARN_EMAIL,
  },
  {
    id: IDO_SAVINA_USER_ID,
    username: 'savina',
    displayName: 'Learn',
    email: IDO_SAVINA_EMAIL,
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
    const email = profile.email ? normalizeEmail(profile.email) : '';
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

  async listByUsername(username: string): Promise<PublicProfile[]> {
    const needle = normalizeUsername(username);
    if (!needle) return [];
    return uniqueProfilesByPerson(
      [...this.profiles.values()].filter((item) => item.username === needle)
    );
  }

  async findByUsername(username: string): Promise<PublicProfile | null> {
    const hits = await this.listByUsername(username);
    return hits.length === 1 ? hits[0] : null;
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
    const hits = await this.listByUsername(username);
    return hits.length === 1 ? hits[0] : null;
  }

  async listByUsername(username: string): Promise<PublicProfile[]> {
    const all: PublicProfile[] = [];
    for (const dir of this.dirs) {
      all.push(...(await dir.listByUsername(username)));
    }
    return uniqueProfilesByPerson(all);
  }
}

function usernameForRow(row: {
  id: string;
  username?: string | null;
  display_name?: string | null;
}): string {
  if (row.id === IDO_SAVINA_USER_ID) return 'savina';
  if (row.id === IDO_LEARN_USER_ID) return 'learn';
  if (row.id === DEMO_LEARNER_IDO_USER_ID || row.id === DEMO_LEARNER_ID) return 'learner';
  return normalizeUsername(row.username || row.display_name || row.id.slice(0, 8));
}

function toPublicProfile(row: {
  id: string;
  username?: string | null;
  display_name?: string | null;
}): PublicProfile {
  const username = usernameForRow(row);
  const email =
    row.id === DEMO_LEARNER_IDO_USER_ID || username === 'learner'
      ? DEMO_LEARNER_EMAIL
      : row.id === IDO_LEARN_USER_ID || username === 'learn'
      ? IDO_LEARN_EMAIL
      : row.id === IDO_SAVINA_USER_ID || username === 'savina'
        ? IDO_SAVINA_EMAIL
        : username === ICESTORM_USERNAME
          ? ICESTORM_EMAIL
          : '';
  return {
    id: row.id,
    username,
    displayName: row.display_name || username,
    email,
  };
}

/** Read-only iDO `profiles` lookup. Failures resolve to null (caller falls through). */
export class IdoProfilesDirectory implements UserDirectoryPort {
  async findByEmail(email: string): Promise<PublicProfile | null> {
    const normalized = normalizeEmail(email);
    if (normalized === DEMO_LEARNER_EMAIL) {
      return (await this.findById(DEMO_LEARNER_IDO_USER_ID)) ?? this.findByUsername('learner');
    }
    if (normalized === IDO_LEARN_EMAIL) {
      return (await this.findById(IDO_LEARN_USER_ID)) ?? this.findByUsername('learn');
    }
    if (normalized === IDO_SAVINA_EMAIL) {
      return (await this.findById(IDO_SAVINA_USER_ID)) ?? this.findByUsername('savina');
    }
    const local = normalizeUsername(normalized.split('@')[0] ?? '');
    if (!local) return null;
    const hits = uniqueProfilesByPerson(await this.listByUsername(local));
    return hits.length === 1 ? hits[0] : null;
  }

  async findById(id: string): Promise<PublicProfile | null> {
    return this.queryOne('id', id);
  }

  async listByUsername(username: string): Promise<PublicProfile[]> {
    const needle = normalizeUsername(username);
    if (!needle) return [];
    return uniqueProfilesByPerson(await this.queryMany('username', needle));
  }

  async findByUsername(username: string): Promise<PublicProfile | null> {
    const hits = await this.listByUsername(username);
    return hits.length === 1 ? hits[0] : null;
  }

  private async queryOne(column: 'id' | 'username', value: string): Promise<PublicProfile | null> {
    const rows = await this.queryMany(column, value);
    return rows[0] ?? null;
  }

  private async queryMany(column: 'id' | 'username', value: string): Promise<PublicProfile[]> {
    if (!isIdoAiConfigured()) return [];
    try {
      const { data, error } = await getIdoSupabase()
        .from('profiles')
        .select('id, username, display_name')
        .eq(column, value)
        .limit(25);
      if (error || !data?.length) return [];
      return (
        data as Array<{ id: string; username?: string | null; display_name?: string | null }>
      ).map(toPublicProfile);
    } catch {
      return [];
    }
  }
}

export async function lookupInDirectory(
  dir: UserDirectoryPort,
  parsed: ParsedFriendIdentifier
): Promise<PublicProfile | null> {
  if (parsed.kind === 'email') {
    const hit = await dir.findByEmail(parsed.email);
    return hit ? { ...hit, email: parsed.email } : null;
  }
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
