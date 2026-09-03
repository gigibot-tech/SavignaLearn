/**
 * fourSome identity — same Supabase Auth project as the fourSome app.
 * Does not touch fourSome chat tables; SavignaLearn chat stays in-memory unless
 * EXPO_PUBLIC_SUPABASE_URL points at savigna_* tables.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAuthClientOptions } from '@/adapters/supabaseClientOptions';
import { identityFromSupabaseUser, type IdentityUser } from '@/adapters/identity';

const url = (process.env.EXPO_PUBLIC_FOURSOME_SUPABASE_URL || '').replace(/\/$/, '');
const anon = process.env.EXPO_PUBLIC_FOURSOME_SUPABASE_ANON_KEY || '';

let client: SupabaseClient | null = null;

export function isFourSomeAuthConfigured(): boolean {
  return url.startsWith('http') && anon.length > 20;
}

export function getFourSomeSupabase(): SupabaseClient {
  if (!isFourSomeAuthConfigured()) {
    throw new Error('fourSome Supabase URL/anon key not configured');
  }
  if (!client) {
    client = createClient(url, anon, supabaseAuthClientOptions('savignalearn.foursome.auth.token'));
  }
  return client;
}

export async function getFourSomeIdentity(): Promise<IdentityUser | null> {
  if (!isFourSomeAuthConfigured()) return null;
  const { data } = await getFourSomeSupabase().auth.getSession();
  return data.session?.user ? identityFromSupabaseUser(data.session.user) : null;
}

export async function getFourSomeEmail(): Promise<string | null> {
  return (await getFourSomeIdentity())?.email ?? null;
}

export async function signInFourSome(email: string, password: string): Promise<IdentityUser> {
  const { data, error } = await getFourSomeSupabase().auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error('fourSome sign-in failed');
  return identityFromSupabaseUser(data.user);
}

export async function signOutFourSome(): Promise<void> {
  if (!isFourSomeAuthConfigured()) return;
  await getFourSomeSupabase().auth.signOut();
}
