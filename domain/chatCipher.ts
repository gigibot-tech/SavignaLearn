/**
 * Envelope for chat payloads at rest.
 * Version 0 / alg `none` is plaintext. A later ChatContentCipher adapter can
 * emit v1+ (e.g. AES-GCM) without changing table names — only enc_version/enc_alg.
 */

export const CHAT_PLAINTEXT_VERSION = 0;
export const CHAT_PLAINTEXT_ALG = 'none';

export type SealedChatText = {
  ciphertext: string;
  encVersion: number;
  encAlg: string;
};

export function sealPlaintext(plaintext: string): SealedChatText {
  return {
    ciphertext: plaintext,
    encVersion: CHAT_PLAINTEXT_VERSION,
    encAlg: CHAT_PLAINTEXT_ALG,
  };
}

export function openSealedText(input: {
  ciphertext: string;
  encVersion?: number | null;
  encAlg?: string | null;
}): string {
  const version = input.encVersion ?? CHAT_PLAINTEXT_VERSION;
  const alg = input.encAlg ?? CHAT_PLAINTEXT_ALG;
  if (version === CHAT_PLAINTEXT_VERSION && alg === CHAT_PLAINTEXT_ALG) {
    return input.ciphertext;
  }
  throw new Error(`Unsupported chat cipher ${alg} v${version}`);
}

export function sealJson(value: unknown): SealedChatText {
  return sealPlaintext(JSON.stringify(value));
}

export function openJson<T>(input: {
  ciphertext: string;
  encVersion?: number | null;
  encAlg?: string | null;
}): T {
  return JSON.parse(openSealedText(input)) as T;
}
