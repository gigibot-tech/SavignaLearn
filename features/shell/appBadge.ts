import { Platform } from 'react-native';

type BadgingNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Tab icon / OS app icon badge for unread chats. Best-effort; ignore missing APIs. */
export async function setInboxAppBadge(count: number): Promise<void> {
  const n = Math.max(0, Math.floor(count));
  if (typeof navigator !== 'undefined') {
    const badging = navigator as BadgingNavigator;
    try {
      if (n > 0) await badging.setAppBadge?.(n);
      else await badging.clearAppBadge?.();
    } catch {
      // Permission or unsupported.
    }
  }
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.setBadgeCountAsync(n);
  } catch {
    // Native module missing in tests / web export.
  }
}
