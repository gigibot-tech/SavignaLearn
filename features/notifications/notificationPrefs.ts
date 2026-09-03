import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationChannel = 'browser';

export interface NotificationPrefs {
  /** Whether notifications are enabled (not just permission granted). */
  enabled: boolean;
  /** Notification backend/channel. For now this is browser notifications on web. */
  channel: NotificationChannel;
}

const PREFS_KEY = 'savigna.notificationPrefs.v1';

const defaultPrefs: NotificationPrefs = { enabled: false, channel: 'browser' };

function webStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage ?? null;
}

export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  const web = webStorage();
  if (web) {
    const raw = web.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs;
    try {
      const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
      if (parsed.channel !== 'browser') return defaultPrefs;
      return { enabled: Boolean(parsed.enabled), channel: 'browser' };
    } catch {
      return defaultPrefs;
    }
  }

  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    if (parsed.channel !== 'browser') return defaultPrefs;
    return { enabled: Boolean(parsed.enabled), channel: 'browser' };
  } catch {
    return defaultPrefs;
  }
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  const web = webStorage();
  if (web) {
    web.setItem(PREFS_KEY, JSON.stringify(prefs));
    return;
  }
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

