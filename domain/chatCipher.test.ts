import { describe, expect, it } from 'vitest';
import {
  CHAT_PLAINTEXT_ALG,
  CHAT_PLAINTEXT_VERSION,
  openJson,
  openSealedText,
  sealJson,
  sealPlaintext,
} from './chatCipher';

describe('chat content envelope', () => {
  it('round-trips plaintext as version 0 / none', () => {
    const sealed = sealPlaintext('Hallo Welt');
    expect(sealed.encVersion).toBe(CHAT_PLAINTEXT_VERSION);
    expect(sealed.encAlg).toBe(CHAT_PLAINTEXT_ALG);
    expect(openSealedText(sealed)).toBe('Hallo Welt');
  });

  it('treats missing enc columns as plaintext (legacy rows)', () => {
    expect(openSealedText({ ciphertext: 'Guten Morgen' })).toBe('Guten Morgen');
  });

  it('round-trips JSON lines through the same envelope', () => {
    const sealed = sealJson([{ content: 'hi' }]);
    expect(openJson<Array<{ content: string }>>(sealed)).toEqual([{ content: 'hi' }]);
  });

  it('rejects unknown cipher versions so a future AES adapter cannot be skipped', () => {
    expect(() =>
      openSealedText({ ciphertext: 'deadbeef', encVersion: 1, encAlg: 'aes-gcm-v1' })
    ).toThrow(/Unsupported chat cipher/);
  });
});
