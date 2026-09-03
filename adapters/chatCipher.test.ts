import { describe, expect, it } from 'vitest';
import { PlaintextChatContentCipher } from './chatCipher';
import { CHAT_PLAINTEXT_ALG, CHAT_PLAINTEXT_VERSION } from '@/domain/chatCipher';

describe('PlaintextChatContentCipher', () => {
  it('is the v0 identity adapter so AES can replace it later', async () => {
    const cipher = new PlaintextChatContentCipher();
    const sealed = await cipher.seal('Hallo');
    expect(cipher.version).toBe(CHAT_PLAINTEXT_VERSION);
    expect(cipher.alg).toBe(CHAT_PLAINTEXT_ALG);
    expect(sealed.ciphertext).toBe('Hallo');
    expect(await cipher.open(sealed)).toBe('Hallo');
  });
});
