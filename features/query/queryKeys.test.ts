import { describe, expect, it } from 'vitest';
import { queryKeys } from './queryKeys';

describe('queryKeys', () => {
  it('keeps inbox / friends / thread identities distinct per user and chat', () => {
    expect(queryKeys.inbox('u1')).toEqual(['chat', 'inbox', 'u1']);
    expect(queryKeys.friends('u1')).not.toEqual(queryKeys.inbox('u1'));
    expect(queryKeys.thread('dm:a', 'u1')).not.toEqual(queryKeys.thread('dm:b', 'u1'));
    expect(queryKeys.thread('dm:a', 'u1')).not.toEqual(queryKeys.thread('dm:a', 'u2'));
    expect(queryKeys.profiles(['a', 'b'])).toEqual(['profile', 'cards', 'a', 'b']);
    expect(queryKeys.ownProfile('u1')[0]).toBe('profile');
  });
});
