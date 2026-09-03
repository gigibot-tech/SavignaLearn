import AsyncStorage from '@react-native-async-storage/async-storage';

const KEEP_KEY = 'savigna.keepLoggedIn';
const DEMO_SESSION_KEY = 'savignalearn.demo.session';

export const DEMO_LEARNER_EMAIL = 'learner@savigna.local';
export const DEMO_LEARNER_PASSWORD = 'demo';

export function isDemoLearnerCredentials(email: string, password: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith('@savigna.local') && password === DEMO_LEARNER_PASSWORD;
}

function webStore(keep: boolean): Storage | null {
  if (typeof window === 'undefined') return null;
  return keep ? window.localStorage : window.sessionStorage;
}

export function shouldKeepLoggedIn(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.sessionStorage.getItem(KEEP_KEY) === '0') return false;
  return window.localStorage.getItem(KEEP_KEY) !== '0';
}

export function setKeepLoggedIn(keep: boolean): void {
  if (typeof window === 'undefined') return;
  if (keep) {
    window.localStorage.setItem(KEEP_KEY, '1');
    window.sessionStorage.removeItem(KEEP_KEY);
  } else {
    window.localStorage.setItem(KEEP_KEY, '0');
    window.sessionStorage.setItem(KEEP_KEY, '0');
  }
}

/** Storage that honors “Keep me logged in”: local when on, tab session when off. */
export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window !== 'undefined') {
      const keep = shouldKeepLoggedIn();
      const web = webStore(keep)?.getItem(key);
      if (web != null) return web;
      if (!keep) return null;
    }
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof window !== 'undefined') {
      const keep = shouldKeepLoggedIn();
      webStore(keep)?.setItem(key, value);
      if (!keep) {
        window.localStorage.removeItem(key);
        return;
      }
    }
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    }
    await AsyncStorage.removeItem(key);
  },
};

export async function loadLocalDemoSession(): Promise<{
  id: string;
  email?: string;
  displayName?: string;
} | null> {
  const raw = await authStorage.getItem(DEMO_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { id: string; email?: string; displayName?: string };
  } catch {
    return null;
  }
}

export async function saveLocalDemoSession(user: {
  id: string;
  email?: string;
  displayName?: string;
}): Promise<void> {
  await authStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
}

export async function clearLocalDemoSession(): Promise<void> {
  await authStorage.removeItem(DEMO_SESSION_KEY);
}
