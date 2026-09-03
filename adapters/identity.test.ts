import { describe, expect, it } from 'vitest';
import { chatActorIds, chatPersistenceUserId, isChatSelf, mergeIdentitySessions } from './identity';

describe('mixed fourSome + iDO identity', () => {
  it('requires at least one provider session', () => {
    expect(mergeIdentitySessions({ fourSome: null, ido: null })).toBeNull();
  });

  it('lets iDO-only sign-in into the app without a fourSome UUID', () => {
    const user = mergeIdentitySessions({
      fourSome: null,
      ido: { id: 'ido-1', email: 'a@ido.test', displayName: 'A' },
    });
    expect(user?.id).toBe('ido-1');
    expect(user?.idoUserId).toBe('ido-1');
    expect(user?.fourSomeUserId).toBeNull();
  });

  it('prefers the fourSome UUID when both sessions exist', () => {
    const user = mergeIdentitySessions({
      fourSome: { id: '16e1c5d7-2908-44be-b53a-b7c0f0a00001', email: 'a@fs.test' },
      ido: { id: 'ido-1', email: 'a@ido.test' },
    });
    expect(user?.id).toBe('16e1c5d7-2908-44be-b53a-b7c0f0a00001');
    expect(user?.fourSomeUserId).toBe('16e1c5d7-2908-44be-b53a-b7c0f0a00001');
    expect(user?.idoUserId).toBe('ido-1');
    expect(user?.email).toBe('a@fs.test');
    expect(chatPersistenceUserId(user!)).toBe('ido-1');
    expect(chatActorIds(user!)).toEqual(['ido-1', '16e1c5d7-2908-44be-b53a-b7c0f0a00001']);
    expect(isChatSelf(user, 'ido-1')).toBe(true);
    expect(isChatSelf(user, '16e1c5d7-2908-44be-b53a-b7c0f0a00001')).toBe(true);
  });
});
