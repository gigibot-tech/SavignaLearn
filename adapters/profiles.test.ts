import { describe, expect, it } from 'vitest';
import { LEARNING_BOT_USER_ID } from '@/domain/chat';
import { LocalProfileRepository, memoryProfileKv } from './profiles';

describe('LocalProfileRepository', () => {
  it('stores photo, about, and last seen for the same person', async () => {
    const profiles = new LocalProfileRepository(memoryProfileKv());
    await profiles.upsertOwn('u1', { photoUrl: 'data:image/png;base64,aa', bio: 'Hey there!' });
    await profiles.heartbeat('u1');
    const card = await profiles.get('u1');
    expect(card?.photoUrl).toBe('data:image/png;base64,aa');
    expect(card?.bio).toBe('Hey there!');
    expect(card?.lastSeenAt).toBeTruthy();
    expect(card?.presenceOptIn).toBe(true);
  });

  it('returns the bundled bot card without persisting it', async () => {
    const profiles = new LocalProfileRepository(memoryProfileKv());
    const card = await profiles.get(LEARNING_BOT_USER_ID);
    expect(card?.userId).toBe(LEARNING_BOT_USER_ID);
    expect(card?.bio.length).toBeGreaterThan(0);
    const listed = await profiles.list([LEARNING_BOT_USER_ID, 'nobody']);
    expect(listed).toHaveLength(1);
  });

  it('can hide last seen', async () => {
    const profiles = new LocalProfileRepository(memoryProfileKv());
    await profiles.upsertOwn('u1', { presenceOptIn: false });
    expect((await profiles.get('u1'))?.presenceOptIn).toBe(false);
  });
});
