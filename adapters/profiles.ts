/**
 * Profile cards: local KV always, savigna_profiles when iDO Auth is on.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getIdoSupabase, isIdoAiConfigured } from '@/adapters/idoAi';
import { authStorage } from '@/adapters/authStorage';
import { LEARNING_BOT_USER_ID } from '@/domain/chat';
import {
  botProfileCard,
  clampProfileBio,
  emptyProfileCard,
  mergeProfileCards,
  profileLookupIds,
  type ProfileCard,
} from '@/domain/profileCard';
import type { ProfileRepository } from '@/ports/ports';

export const PROFILE_CARDS_KEY = 'savigna.profileCards.v1';

export type ProfileKv = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

type StoredMap = Record<string, ProfileCard>;

function parseMap(raw: string | null): StoredMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StoredMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function asCard(row: Partial<ProfileCard> & { userId: string }): ProfileCard {
  return {
    userId: row.userId,
    photoUrl: row.photoUrl ?? null,
    bio: typeof row.bio === 'string' ? row.bio : '',
    lastSeenAt: row.lastSeenAt ?? null,
    presenceOptIn: row.presenceOptIn !== false,
  };
}

export class LocalProfileRepository implements ProfileRepository {
  constructor(private readonly kv: ProfileKv) {}

  private async load(): Promise<StoredMap> {
    return parseMap(await this.kv.getItem(PROFILE_CARDS_KEY));
  }

  private async save(map: StoredMap): Promise<void> {
    await this.kv.setItem(PROFILE_CARDS_KEY, JSON.stringify(map));
  }

  private lookup(map: StoredMap, userId: string): ProfileCard | null {
    for (const key of profileLookupIds(userId)) {
      if (map[key]) return asCard(map[key]);
    }
    return null;
  }

  async get(userId: string): Promise<ProfileCard | null> {
    if (userId === LEARNING_BOT_USER_ID) return botProfileCard();
    return this.lookup(await this.load(), userId);
  }

  async list(userIds: string[]): Promise<ProfileCard[]> {
    const map = await this.load();
    const seen = new Set<string>();
    const out: ProfileCard[] = [];
    for (const id of userIds) {
      if (id === LEARNING_BOT_USER_ID) {
        if (!seen.has(LEARNING_BOT_USER_ID)) {
          seen.add(LEARNING_BOT_USER_ID);
          out.push(botProfileCard());
        }
        continue;
      }
      const card = this.lookup(map, id);
      if (!card || seen.has(card.userId)) continue;
      seen.add(card.userId);
      out.push(card);
    }
    return out;
  }

  async upsertOwn(
    userId: string,
    patch: { photoUrl?: string | null; bio?: string; presenceOptIn?: boolean }
  ): Promise<ProfileCard> {
    const map = await this.load();
    const current = this.lookup(map, userId) ?? emptyProfileCard(userId);
    const next: ProfileCard = {
      ...current,
      userId,
      photoUrl: patch.photoUrl !== undefined ? patch.photoUrl : current.photoUrl,
      bio: patch.bio !== undefined ? clampProfileBio(patch.bio) : current.bio,
      presenceOptIn: patch.presenceOptIn ?? current.presenceOptIn,
    };
    for (const key of profileLookupIds(userId)) {
      delete map[key];
    }
    map[userId] = next;
    await this.save(map);
    return next;
  }

  async heartbeat(userId: string): Promise<void> {
    if (!userId || userId === LEARNING_BOT_USER_ID) return;
    const map = await this.load();
    const current = this.lookup(map, userId) ?? emptyProfileCard(userId);
    const next: ProfileCard = {
      ...current,
      userId,
      lastSeenAt: new Date().toISOString(),
    };
    for (const key of profileLookupIds(userId)) {
      delete map[key];
    }
    map[userId] = next;
    await this.save(map);
  }
}

type CloudRow = {
  user_id: string;
  bio?: string | null;
  photo_url?: string | null;
  last_seen_at?: string | null;
  presence_opt_in?: boolean | null;
};

function rowToCard(row: CloudRow): ProfileCard {
  return {
    userId: row.user_id,
    photoUrl: row.photo_url ?? null,
    bio: row.bio ?? '',
    lastSeenAt: row.last_seen_at ?? null,
    presenceOptIn: row.presence_opt_in !== false,
  };
}

export class SavignaCloudProfileRepository implements ProfileRepository {
  constructor(private readonly clientOf: () => SupabaseClient) {}

  private client(): SupabaseClient {
    return this.clientOf();
  }

  async get(userId: string): Promise<ProfileCard | null> {
    const rows = await this.list([userId]);
    return rows[0] ?? null;
  }

  async list(userIds: string[]): Promise<ProfileCard[]> {
    const ids = [...new Set(userIds.flatMap(profileLookupIds))].filter(
      (id) => id && id !== LEARNING_BOT_USER_ID
    );
    if (!ids.length) {
      return userIds.includes(LEARNING_BOT_USER_ID) ? [botProfileCard()] : [];
    }
    try {
      const { data, error } = await this.client()
        .from('savigna_profiles')
        .select('user_id, bio, photo_url, last_seen_at, presence_opt_in')
        .in('user_id', ids);
      if (error || !data) {
        return userIds.includes(LEARNING_BOT_USER_ID) ? [botProfileCard()] : [];
      }
      const cards = (data as CloudRow[]).map(rowToCard);
      if (userIds.includes(LEARNING_BOT_USER_ID)) cards.push(botProfileCard());
      return cards;
    } catch {
      return userIds.includes(LEARNING_BOT_USER_ID) ? [botProfileCard()] : [];
    }
  }

  async upsertOwn(
    userId: string,
    patch: { photoUrl?: string | null; bio?: string; presenceOptIn?: boolean }
  ): Promise<ProfileCard> {
    const current = (await this.get(userId)) ?? emptyProfileCard(userId);
    const next: ProfileCard = {
      ...current,
      userId,
      photoUrl: patch.photoUrl !== undefined ? patch.photoUrl : current.photoUrl,
      bio: patch.bio !== undefined ? clampProfileBio(patch.bio) : current.bio,
      presenceOptIn: patch.presenceOptIn ?? current.presenceOptIn,
    };
    const { error } = await this.client().from('savigna_profiles').upsert(
      {
        user_id: userId,
        bio: next.bio,
        photo_url: next.photoUrl,
        presence_opt_in: next.presenceOptIn,
        last_seen_at: next.lastSeenAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
    return next;
  }

  async heartbeat(userId: string): Promise<void> {
    if (!userId || userId === LEARNING_BOT_USER_ID) return;
    const now = new Date().toISOString();
    const existing = await this.get(userId);
    if (existing) {
      const { error } = await this.client()
        .from('savigna_profiles')
        .update({ last_seen_at: now, updated_at: now })
        .eq('user_id', userId);
      if (error) throw error;
      return;
    }
    const { error } = await this.client().from('savigna_profiles').insert({
      user_id: userId,
      last_seen_at: now,
      updated_at: now,
    });
    if (error) throw error;
  }
}

export class CompositeProfileRepository implements ProfileRepository {
  constructor(
    private readonly local: ProfileRepository,
    private readonly cloudOf: () => ProfileRepository | null
  ) {}

  private cloud(): ProfileRepository | null {
    try {
      return this.cloudOf();
    } catch {
      return null;
    }
  }

  async get(userId: string): Promise<ProfileCard | null> {
    const [local, cloud] = await Promise.all([
      this.local.get(userId),
      this.cloud()?.get(userId) ?? Promise.resolve(null),
    ]);
    if (userId === LEARNING_BOT_USER_ID) return botProfileCard();
    return mergeProfileCards(local, cloud);
  }

  async list(userIds: string[]): Promise<ProfileCard[]> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return [];
    const [localRows, cloudRows] = await Promise.all([
      this.local.list(unique),
      this.cloud()?.list(unique) ?? Promise.resolve([]),
    ]);
    const localMap = new Map(localRows.map((row) => [row.userId, row]));
    const cloudMap = new Map(cloudRows.map((row) => [row.userId, row]));
    const out: ProfileCard[] = [];
    const seen = new Set<string>();
    for (const id of unique) {
      if (id === LEARNING_BOT_USER_ID) {
        if (!seen.has(LEARNING_BOT_USER_ID)) {
          seen.add(LEARNING_BOT_USER_ID);
          out.push(botProfileCard());
        }
        continue;
      }
      const merged =
        mergeProfileCards(
          this.pick(localMap, id),
          this.pick(cloudMap, id)
        ) ?? null;
      if (!merged || seen.has(merged.userId)) continue;
      seen.add(merged.userId);
      out.push(merged);
    }
    return out;
  }

  private pick(map: Map<string, ProfileCard>, id: string): ProfileCard | null {
    for (const key of profileLookupIds(id)) {
      const hit = map.get(key);
      if (hit) return hit;
    }
    return null;
  }

  async upsertOwn(
    userId: string,
    patch: { photoUrl?: string | null; bio?: string; presenceOptIn?: boolean }
  ): Promise<ProfileCard> {
    const local = await this.local.upsertOwn(userId, patch);
    const cloud = this.cloud();
    if (!cloud) return local;
    try {
      const remote = await cloud.upsertOwn(userId, patch);
      return mergeProfileCards(local, remote) ?? local;
    } catch {
      return local;
    }
  }

  async heartbeat(userId: string): Promise<void> {
    await this.local.heartbeat(userId);
    const cloud = this.cloud();
    if (!cloud) return;
    try {
      await cloud.heartbeat(userId);
    } catch {
      // Local last-seen still advances when iDO is briefly unreachable.
    }
  }
}

let singleton: ProfileRepository | null = null;

export function createProfileRepository(): ProfileRepository {
  if (!singleton) {
    const local = new LocalProfileRepository(authStorage);
    singleton = new CompositeProfileRepository(local, () =>
      isIdoAiConfigured() ? new SavignaCloudProfileRepository(() => getIdoSupabase()) : null
    );
  }
  return singleton;
}

export function memoryProfileKv(): ProfileKv {
  const map = new Map<string, string>();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
  };
}
