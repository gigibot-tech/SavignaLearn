/**
 * WhatsApp-style last seen / online labels. Domain-only — no React.
 */

import { LEARNING_BOT_USER_ID } from './chat';
import type { ProfileCard } from './profileCard';

/** Treat as online if a heartbeat landed within this window. */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export type PresenceKind = 'online' | 'last_seen' | 'hidden';

export function isBotPresenceUser(userId: string): boolean {
  return userId === LEARNING_BOT_USER_ID;
}

export function isOnlineNow(input: {
  lastSeenAt: string | null;
  presenceOptIn: boolean;
  isBot?: boolean;
  now?: number;
}): boolean {
  if (input.isBot) return true;
  if (!input.presenceOptIn || !input.lastSeenAt) return false;
  const at = Date.parse(input.lastSeenAt);
  if (Number.isNaN(at)) return false;
  return (input.now ?? Date.now()) - at < ONLINE_WINDOW_MS;
}

export function presenceKind(input: {
  lastSeenAt: string | null;
  presenceOptIn: boolean;
  isBot?: boolean;
  now?: number;
}): PresenceKind {
  if (input.isBot) return 'online';
  if (!input.presenceOptIn) return 'hidden';
  if (isOnlineNow(input)) return 'online';
  if (!input.lastSeenAt || Number.isNaN(Date.parse(input.lastSeenAt))) return 'hidden';
  return 'last_seen';
}

function clockParts(ms: number): { date: string; time: string } {
  const date = new Date(ms);
  return {
    date: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    time: date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Inbox green-dot + thread/profile subtitle. Empty when hidden. */
export function formatPresenceLabel(input: {
  lastSeenAt: string | null;
  presenceOptIn: boolean;
  isBot?: boolean;
  now?: number;
}): string {
  const kind = presenceKind(input);
  if (kind === 'hidden') return '';
  if (kind === 'online') return 'online';
  const last = Date.parse(input.lastSeenAt!);
  const now = input.now ?? Date.now();
  const { time, date } = clockParts(last);
  const lastDay = startOfLocalDay(last);
  const today = startOfLocalDay(now);
  const dayMs = 24 * 60 * 60 * 1000;
  if (lastDay === today) return `last seen today at ${time}`;
  if (lastDay === today - dayMs) return `last seen yesterday at ${time}`;
  return `last seen ${date}`;
}

export function formatCardPresence(card: ProfileCard | undefined, now?: number): string {
  if (!card) return '';
  return formatPresenceLabel({
    lastSeenAt: card.lastSeenAt,
    presenceOptIn: card.presenceOptIn,
    isBot: isBotPresenceUser(card.userId),
    now,
  });
}

export function cardIsOnline(card: ProfileCard | undefined, now?: number): boolean {
  if (!card) return false;
  return isOnlineNow({
    lastSeenAt: card.lastSeenAt,
    presenceOptIn: card.presenceOptIn,
    isBot: isBotPresenceUser(card.userId),
    now,
  });
}
