/**
 * Default chat-at-rest cipher: identity (plaintext).
 * Swap this adapter for AES-GCM later — Supabase columns already store enc_version / enc_alg.
 */

import { openSealedText, sealPlaintext, type SealedChatText } from '@/domain/chatCipher';
import type { ChatContentCipher } from '@/ports/ports';

export class PlaintextChatContentCipher implements ChatContentCipher {
  readonly version = 0;
  readonly alg = 'none';

  async seal(plaintext: string): Promise<SealedChatText> {
    return sealPlaintext(plaintext);
  }

  async open(input: {
    ciphertext: string;
    encVersion?: number | null;
    encAlg?: string | null;
  }): Promise<string> {
    return openSealedText(input);
  }
}

export function createChatContentCipher(): ChatContentCipher {
  return new PlaintextChatContentCipher();
}
