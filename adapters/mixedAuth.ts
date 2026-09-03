/**
 * One login form, two identity providers: fourSome Auth and ido-core Auth.
 * Either session is enough to enter the app; backends stay gated per provider.
 */

import {
  getFourSomeIdentity,
  getFourSomeSupabase,
  isFourSomeAuthConfigured,
  signInFourSome,
  signOutFourSome,
} from '@/adapters/fourSomeAuth';
import { identityFromSupabaseUser, mergeIdentitySessions } from '@/adapters/identity';
import { getIdoSupabase, isIdoAiConfigured, signInIdo, signOutIdo } from '@/adapters/idoAi';
import {
  clearLocalDemoSession,
  isDemoLearnerCredentials,
  loadLocalDemoSession,
  saveLocalDemoSession,
} from '@/adapters/authStorage';
import type { AuthPort, AuthUser } from '@/ports/ports';

export function isMixedIdentityConfigured(): boolean {
  return isFourSomeAuthConfigured() || isIdoAiConfigured();
}

async function readMergedSession(): Promise<AuthUser | null> {
  const [fourSome, ido, demo] = await Promise.all([
    getFourSomeIdentity(),
    (async () => {
      if (!isIdoAiConfigured()) return null;
      const { data } = await getIdoSupabase().auth.getSession();
      return data.session?.user ? identityFromSupabaseUser(data.session.user) : null;
    })(),
    loadLocalDemoSession(),
  ]);
  return mergeIdentitySessions({ fourSome, ido }) ?? demo;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export class MixedAuthAdapter implements AuthPort {
  private localListeners = new Set<(user: AuthUser | null) => void>();

  private notify(user: AuthUser | null) {
    for (const listener of this.localListeners) listener(user);
  }

  async getSession(): Promise<AuthUser | null> {
    return readMergedSession();
  }

  async signInWithPassword(email: string, password: string): Promise<AuthUser> {
    const failures: string[] = [];
    if (isFourSomeAuthConfigured()) {
      try {
        await signInFourSome(email, password);
      } catch (error) {
        failures.push(`fourSome: ${errorMessage(error, 'failed')}`);
      }
    }
    if (isIdoAiConfigured()) {
      try {
        await signInIdo(email, password);
      } catch (error) {
        failures.push(`iDO: ${errorMessage(error, 'failed')}`);
      }
    }
    const session = await readMergedSession();
    if (session) {
      this.notify(session);
      return session;
    }
    if (isDemoLearnerCredentials(email, password)) {
      const demo: AuthUser = {
        id: 'demo-user',
        email: email.trim().toLowerCase(),
        displayName: 'Learner',
      };
      await saveLocalDemoSession(demo);
      this.notify(demo);
      return demo;
    }
    throw new Error(failures.join(' · ') || 'Sign-in failed');
  }

  async signUp(email: string, password: string, displayName?: string): Promise<AuthUser> {
    const failures: string[] = [];
    if (isFourSomeAuthConfigured()) {
      try {
        const { data, error } = await getFourSomeSupabase().auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        });
        if (error || !data.user) throw error ?? new Error('fourSome sign-up failed');
      } catch (error) {
        failures.push(`fourSome: ${errorMessage(error, 'failed')}`);
      }
    }
    if (isIdoAiConfigured()) {
      try {
        const { data, error } = await getIdoSupabase().auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        });
        if (error || !data.user) throw error ?? new Error('iDO sign-up failed');
      } catch (error) {
        failures.push(`iDO: ${errorMessage(error, 'failed')}`);
      }
    }
    const session = await readMergedSession();
    if (!session) {
      throw new Error(failures.join(' · ') || 'Sign-up failed');
    }
    return session;
  }

  async signOut(): Promise<void> {
    await Promise.all([signOutFourSome(), signOutIdo(), clearLocalDemoSession()]);
    this.notify(null);
  }

  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void {
    let alive = true;
    this.localListeners.add(listener);
    const emit = () => {
      void readMergedSession().then((user) => {
        if (alive) listener(user);
      });
    };
    const subs: Array<{ unsubscribe: () => void }> = [];
    if (isFourSomeAuthConfigured()) {
      subs.push(getFourSomeSupabase().auth.onAuthStateChange(() => emit()).data.subscription);
    }
    if (isIdoAiConfigured()) {
      subs.push(getIdoSupabase().auth.onAuthStateChange(() => emit()).data.subscription);
    }
    emit();
    return () => {
      alive = false;
      this.localListeners.delete(listener);
      for (const sub of subs) sub.unsubscribe();
    };
  }
}
