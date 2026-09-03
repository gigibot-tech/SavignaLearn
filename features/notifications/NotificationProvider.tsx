import { usePathname, useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { listInboxConversations, ensureLearningBotChat } from '@/adapters/chat';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { learningBotHref } from '@/adapters/postLogin';
import { useAuthState, useServices } from '@/features/chat/AppProviders';

import { loadNotificationPrefs, saveNotificationPrefs, type NotificationPrefs } from './notificationPrefs';

type ExpoNotificationsModule = typeof import('expo-notifications');

async function getExpoNotifications(): Promise<ExpoNotificationsModule> {
  // Important: dynamic import keeps expo-notifications from running during Expo web export.
  return (await import('expo-notifications')) as ExpoNotificationsModule;
}

export type NotificationRequest = {
  title: string;
  body: string;
  /** Optional deep link to open when the notification is clicked. */
  url?: string;
  /** Extra fields stored in notification payload (best-effort). */
  data?: Record<string, unknown>;
  /** A stable dedupe key (best-effort). */
  tag?: string;
};

type NotificationsContextValue = {
  supported: boolean;
  /** User toggle state (may still require OS permission). */
  enabled: boolean;
  /** Best-effort permission state label. */
  permission: 'granted' | 'denied' | 'default' | 'unknown';
  requestEnable: () => Promise<boolean>;
  disable: () => Promise<void>;
  showNotification: (req: NotificationRequest) => Promise<boolean>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

function webPermission(): NotificationsContextValue['permission'] {
  if (typeof window === 'undefined') return 'unknown';
  if (!('Notification' in window)) return 'unknown';
  return window.Notification.permission as NotificationsContextValue['permission'];
}

async function notifyViaServiceWorker(params: {
  title: string;
  body: string;
  data: Record<string, unknown>;
  tag?: string;
}): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!navigator.serviceWorker.controller) return false;
  navigator.serviceWorker.controller.postMessage({
    type: 'SHOW_NOTIFICATION',
    title: params.title,
    body: params.body,
    data: params.data,
    tag: params.tag,
  });
  return true;
}

async function notifyViaNotificationApi(params: {
  title: string;
  body: string;
  data: Record<string, unknown>;
  tag?: string;
  onClickUrl?: string;
}): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (window.Notification.permission !== 'granted') return false;

  const n = new window.Notification(params.title, {
    body: params.body,
    data: params.data,
    // `tag` is supported by many browsers; SW handles more reliably for background.
    tag: params.tag,
  } as NotificationOptions);

  if (params.onClickUrl) {
    n.onclick = () => {
      // In some browsers, click handlers won't run when notifications are shown by a SW.
      // This is best-effort for the Notification API path.
      window.open(params.onClickUrl, '_self');
    };
  }
  return true;
}

async function notifyWeb(req: NotificationRequest): Promise<boolean> {
  const permission = webPermission();
  if (permission !== 'granted') return false;

  const data: Record<string, unknown> = { url: req.url, ...(req.data ?? {}) };
  // Prefer SW display if possible (especially when the tab is backgrounded).
  const viaSw = await notifyViaServiceWorker({
    title: req.title,
    body: req.body,
    data,
    tag: req.tag,
  });
  if (viaSw) return true;

  return notifyViaNotificationApi({
    title: req.title,
    body: req.body,
    data,
    tag: req.tag,
    onClickUrl: req.url,
  });
}

async function notifyNative(req: NotificationRequest): Promise<boolean> {
  // expo-notifications handles permission internally; our provider gates by preference,
  // but we still fail closed here.
  const ExpoNotifications = await getExpoNotifications();
  const status = await ExpoNotifications.getPermissionsAsync().catch(() => null);
  if (!status || status.granted !== true) return false;

  // `data` must be under `content.data` for click handling.
  await ExpoNotifications.presentNotificationAsync({
    title: req.title,
    body: req.body,
    data: { url: req.url, ...(req.data ?? {}) },
  });
  return true;
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { chat } = useServices();
  const { user, ready: authReady } = useAuthState();

  const [permission, setPermission] = useState<NotificationsContextValue['permission']>('unknown');
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  const serviceWorkerRegistered = useRef(false);
  const activeChatIdRef = useRef<string | null>(null);
  const messageIdsByConversation = useRef<Record<string, Set<string>>>({});
  const lastNotifiedMessageId = useRef<Record<string, string | undefined>>({});

  const supported = useMemo(() => {
    // Web: permission + Notifications API availability.
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' && 'Notification' in window;
    }
    return true;
  }, []);

  // Load persisted toggle on boot.
  useEffect(() => {
    void (async () => {
      const loaded = await loadNotificationPrefs();
      setPrefs(loaded);
    })();
  }, []);

  // Keep permission state fresh.
  useEffect(() => {
    void (async () => {
      if (Platform.OS === 'web') {
        setPermission(webPermission());
        return;
      }
      const ExpoNotifications = await getExpoNotifications();
      const status = await ExpoNotifications.getPermissionsAsync().catch(() => null);
      setPermission(status?.granted === true ? 'granted' : status?.status === 'denied' ? 'denied' : 'default');
    })();
  }, [supported]);

  const enabled = Boolean(prefs?.enabled);

  // Keep the currently-active chat id in a ref so subscriptions can always consult it
  // without needing to resubscribe on every navigation.
  useEffect(() => {
    activeChatIdRef.current =
      typeof pathname === 'string' && pathname.startsWith('/chat/')
        ? pathname.slice('/chat/'.length)
        : null;
  }, [pathname]);

  const registerServiceWorkerIfNeeded = useCallback(async () => {
    if (Platform.OS !== 'web') return;
    if (serviceWorkerRegistered.current) return;
    if (typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    try {
      await navigator.serviceWorker.register('/service-worker.js');
      serviceWorkerRegistered.current = true;
    } catch {
      // Non-fatal: we can still fall back to direct Notifications API.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!enabled) return;
    void registerServiceWorkerIfNeeded();
  }, [enabled, registerServiceWorkerIfNeeded]);

  const requestEnable = useCallback(async () => {
    if (!supported) return false;

    if (Platform.OS === 'web') {
      if (!('Notification' in window)) return false;
      const perm = await window.Notification.requestPermission();
      const nextPermission = (perm ?? 'default') as NotificationsContextValue['permission'];
      setPermission(nextPermission);
      if (nextPermission !== 'granted') return false;
      await registerServiceWorkerIfNeeded();
      const next = { enabled: true, channel: 'browser' as const };
      await saveNotificationPrefs(next);
      setPrefs(next);
      return true;
    }

    const ExpoNotifications = await getExpoNotifications();
    const status = await ExpoNotifications.requestPermissionsAsync().catch(() => null);
    const granted = status?.granted === true;
    setPermission(status?.granted === true ? 'granted' : status?.status === 'denied' ? 'denied' : 'default');
    if (!granted) return false;

    // Native: default handler shows alerts.
    ExpoNotifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    const next = { enabled: true, channel: 'browser' as const };
    await saveNotificationPrefs(next);
    setPrefs(next);
    return true;
  }, [registerServiceWorkerIfNeeded, supported]);

  const disable = useCallback(async () => {
    const next = { enabled: false, channel: 'browser' as const };
    await saveNotificationPrefs(next);
    setPrefs(next);
    if (Platform.OS !== 'web') {
      const ExpoNotifications = await getExpoNotifications();
      await ExpoNotifications.dismissAllNotificationsAsync().catch(() => undefined);
    }
  }, []);

  const showNotification = useCallback(
    async (req: NotificationRequest) => {
      if (!supported || !enabled) return false;

      if (Platform.OS === 'web') {
        // If permission changed externally, fail closed.
        if (webPermission() !== 'granted') return false;
        return notifyWeb(req);
      }

      return notifyNative(req);
    },
    [enabled, supported]
  );

  // Native: handle taps on notifications.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      const ExpoNotifications = await getExpoNotifications();
      if (cancelled) return;
      sub = ExpoNotifications.addNotificationResponseReceivedListener((response) => {
        const url = response?.notification?.request?.content?.data?.url;
        if (typeof url === 'string' && url.length > 0) {
          try {
            // expo-router uses route strings; `url` is expected to be a deep route.
            router.push(url as never);
          } catch {
            // best-effort
          }
        }
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [router]);

  /**
   * Web-only “worker”: while the app tab is open, listen for new messages via Supabase realtime
   * (chat repository subscription) and show browser notifications when the user is NOT viewing
   * the corresponding chat route.
   *
   * No Netlify Edge Function / web-push is added here: background notifications require the
   * tab to stay alive so JS can receive realtime updates.
   */
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!enabled) return;
    if (!supported) return;
    if (!authReady || !user) return;

    let cancelled = false;
    const unsubs: Array<() => void> = [];

    void (async () => {
      const viewerId = chatPersistenceUserId(user);
      const ids = chatActorIds(user);
      await ensureLearningBotChat(chat, viewerId, ids);
      const conversations = await listInboxConversations(chat, ids);
      if (cancelled) return;

      // Subscribe to all inbox conversations. We only notify when:
      // - the chat route isn't currently active.

      for (const conv of conversations) {
        if (!conv?.id) continue;
        const conversationId = conv.id;
        if (conv.muted) continue;

        // Seed known message ids so we can detect “new” messages.
        const seed = await chat.listMessages(conversationId).catch(() => []);
        messageIdsByConversation.current[conversationId] = new Set(seed.map((m) => m.id));

        const unsubscribe = chat.subscribe(conversationId, (nextMessages) => {
          if (cancelled) return;

          const known = messageIdsByConversation.current[conversationId] ?? new Set<string>();
          const nextIds = new Set(nextMessages.map((m) => m.id));

          const newMessages = nextMessages.filter((m) => !known.has(m.id));
          messageIdsByConversation.current[conversationId] = nextIds;

          if (newMessages.length === 0) return;

          // Skip if the user is currently viewing the chat.
          const activeChatId = activeChatIdRef.current;
          if (activeChatId && activeChatId === conversationId) return;

          const selfIds = new Set(ids);
          const relevant = newMessages
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .filter((m) => !selfIds.has(m.authorId));

          if (relevant.length === 0) return;

          // Deduplicate: only notify once per message.
          const last = relevant[relevant.length - 1];
          const already = lastNotifiedMessageId.current[conversationId];
          if (already === last.id) return;
          lastNotifiedMessageId.current[conversationId] = last.id;

          const firstLine = (last.sourceText ?? '').split('\n').find((s) => s.trim().length > 0) ?? '';
          const preview = firstLine.trim().slice(0, 140) || 'New message';
          const url = learningBotHref(conversationId);

          void showNotification({
            title: conv.title ?? 'New message',
            body: preview,
            url,
            data: { conversationId },
            tag: `conv:${conversationId}`,
          });
        });

        unsubs.push(unsubscribe);
      }
    })();

    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub();
    };
  }, [authReady, enabled, supported, user, chat, showNotification]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      supported,
      enabled,
      permission,
      requestEnable,
      disable,
      showNotification,
    }),
    [disable, enabled, permission, requestEnable, showNotification, supported]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}

