/**
 * iDO AI — same path as ido-core: Supabase Edge Function `ai-assist`
 * (Vercel AI Gateway / OPENAI_API_KEY stay on the server).
 * Uses a separate Supabase client so SavignaLearn demo auth / in-memory chat stay intact.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAuthClientOptions } from '@/adapters/supabaseClientOptions';
import type { ChatCompleteOptions, ChatCompletionMessage, ChatCompletionPort } from '@/ports/ports';

const idoUrl =
  process.env.EXPO_PUBLIC_IDO_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const idoAnon =
  process.env.EXPO_PUBLIC_IDO_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let idoClient: SupabaseClient | null = null;

export function isIdoAiConfigured(): boolean {
  return idoUrl.startsWith('http') && idoAnon.length > 20;
}

export function getIdoSupabase(): SupabaseClient {
  if (!isIdoAiConfigured()) {
    throw new Error('iDO Supabase URL/anon key not configured');
  }
  if (!idoClient) {
    idoClient = createClient(idoUrl, idoAnon, supabaseAuthClientOptions('savignalearn.ido.auth.token'));
  }
  return idoClient;
}

export async function getIdoEmail(): Promise<string | null> {
  if (!isIdoAiConfigured()) return null;
  const { data } = await getIdoSupabase().auth.getSession();
  return data.session?.user.email ?? null;
}

export async function signInIdo(email: string, password: string): Promise<string> {
  const { data, error } = await getIdoSupabase().auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error('iDO sign-in failed');
  return data.user.email ?? email;
}

export async function signOutIdo(): Promise<void> {
  if (!isIdoAiConfigured()) return;
  await getIdoSupabase().auth.signOut();
}

async function readJson(response: Response): Promise<{ content?: string; error?: string }> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as { content?: string; error?: string };
  } catch {
    return { error: raw.slice(0, 180) || `${response.status}` };
  }
}

export function idoAssistProbeFromSession(
  configured: boolean,
  accessToken: string | undefined
): { ok: boolean; detail: string } {
  if (!configured) return { ok: false, detail: 'not configured' };
  if (!accessToken) return { ok: false, detail: 'sign in to enable' };
  return { ok: true, detail: 'signed in' };
}

/** iDO session JWT is enough to enable the chip. Do not POST an empty `ai-assist` body — that 400s. */
export async function probeIdoAssist(): Promise<{ ok: boolean; detail: string }> {
  if (!isIdoAiConfigured()) return idoAssistProbeFromSession(false, undefined);
  const { data } = await getIdoSupabase().auth.getSession();
  return idoAssistProbeFromSession(true, data.session?.access_token);
}

export class IdoCoreChatCompletionAdapter implements ChatCompletionPort {
  isAvailable(): boolean {
    return isIdoAiConfigured();
  }

  async complete(
    messages: ChatCompletionMessage[],
    options?: ChatCompleteOptions
  ): Promise<string> {
    const client = getIdoSupabase();
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error('Sign in with an iDO account to use the iDO AI backend');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${idoUrl.replace(/\/$/, '')}/functions/v1/ai-assist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: idoAnon,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feature: options?.feature ?? 'generic',
          json: options?.json === true,
          messages,
        }),
        signal: controller.signal,
      });
      const parsed = await readJson(response);
      if (!response.ok) {
        throw new Error(parsed.error || `iDO ai-assist ${response.status}`);
      }
      const content = parsed.content?.trim();
      if (!content) throw new Error(parsed.error || 'iDO ai-assist returned no content');
      return content;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('iDO ai-assist timed out');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
