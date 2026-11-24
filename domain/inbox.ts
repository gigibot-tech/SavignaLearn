import { LEARNING_BOT_USER_ID, type Conversation, type SourceMessage } from './chat';

export function shouldCountAsUnread(
  message: Pick<SourceMessage, 'authorId' | 'deletedAt'>,
  viewerIds: readonly string[]
): boolean {
  if (message.deletedAt) return false;
  if (viewerIds.includes(message.authorId)) return false;
  return true;
}

export function unreadRecipients(
  participantIds: readonly string[],
  authorId: string
): string[] {
  return participantIds.filter(
    (id) => id && id !== authorId && id !== LEARNING_BOT_USER_ID
  );
}

export function unreadTotal(
  conversations: readonly Pick<Conversation, 'unreadCount' | 'muted'>[]
): number {
  return conversations.reduce((sum, item) => {
    if (item.muted) return sum;
    return sum + Math.max(0, item.unreadCount ?? 0);
  }, 0);
}

export function badgeLabel(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}

/** One chat as the inbox shows it — already resolved to a name, photo and presence. */
export interface InboxItem {
  id: string;
  title: string;
  preview?: string;
  updatedAt: string;
  unread: number;
  muted: boolean;
  isBot: boolean;
  online: boolean;
  photoUrl?: string | null;
}

export type InboxFilter = 'all' | 'unread' | 'online';

export const INBOX_FILTERS: ReadonlyArray<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'online', label: 'Online' },
];

/** Search matches what the user *sees* (name + preview), not the stored conversation title. */
export function filterInboxItems(
  items: readonly InboxItem[],
  { query, filter }: { query: string; filter: InboxFilter }
): InboxItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === 'unread' && item.unread <= 0) return false;
    if (filter === 'online' && !item.online) return false;
    if (!needle) return true;
    return (
      item.title.toLowerCase().includes(needle) || (item.preview ?? '').toLowerCase().includes(needle)
    );
  });
}

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** WhatsApp-style stamp: time today, "Yesterday", weekday this week, otherwise a short date. */
export function inboxTimestamp(iso: string, now: Date = new Date(), locale?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const daysAgo = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (daysAgo <= 0) return at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo < 7) return at.toLocaleDateString(locale, { weekday: 'short' });
  return at.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * How many conversation tiles fit across `width`. Never fewer than two: a grid with
 * one tile per row is just the list we are moving away from.
 */
export function inboxGridColumns(
  width: number,
  { minTile = 148, gap = 10, padding = 12 }: { minTile?: number; gap?: number; padding?: number } = {}
): number {
  const fit = Math.floor((width - padding * 2 + gap) / (minTile + gap));
  return Math.max(2, fit);
}

/* ---- inside a thread ------------------------------------------------- */

/** The small clock time inside a message bubble, e.g. "14:05". */
export function messageClockTime(iso: string, locale?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** Same calendar day in the viewer's time zone — decides where a day separator goes. */
export function sameChatDay(a: string, b: string): boolean {
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return startOfDay(left) === startOfDay(right);
}

/** Pill between days of a thread: Today, Yesterday, the weekday this week, otherwise the date. */
export function chatDayLabel(iso: string, now: Date = new Date(), locale?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const daysAgo = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (daysAgo <= 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo < 7) return at.toLocaleDateString(locale, { weekday: 'long' });
  return at.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}
