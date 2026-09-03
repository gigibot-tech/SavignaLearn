/**
 * WhatsApp copy-paste import: parse `[time, date] Name: body` blocks,
 * strip quoted reply prefixes, and guess which names map to self vs partner.
 */

export type WhatsAppSpeaker = {
  name: string;
  messageCount: number;
};

export type ParsedWhatsAppMessage = {
  speaker: string;
  text: string;
  createdAt: string;
  replyToIndex: number | null;
};

export type WhatsAppParseResult = {
  messages: ParsedWhatsAppMessage[];
  speakers: WhatsAppSpeaker[];
};

const HEADER =
  /^[\u200e\u200f\u202a-\u202e]*\[(\d{1,2}:\d{2}(?::\d{2})?),\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})\]\s+(.+?):\s?(.*)$/u;

const QUOTE_MIN_CHARS = 8;
const UNSURE_SCORE = 0.55;
const UNSURE_MARGIN = 0.12;
const MEDIA_LABEL =
  /^(video|audio|image|sticker|gif|photo|bild|audio weggelassen|video weggelassen|bild weggelassen|<medien weggelassen>)$/i;

export function foldWhatsAppName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[()[\]{}]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

export function whatsappNameSimilarity(a: string, b: string): number {
  const left = foldWhatsAppName(a);
  const right = foldWhatsAppName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 3 && (longer.startsWith(shorter) || longer.includes(shorter))) {
    return 0.72 + 0.28 * (shorter.length / longer.length);
  }
  const distance = levenshtein(left, right);
  const ratio = 1 - distance / Math.max(left.length, right.length);
  return ratio >= 0.62 ? ratio : 0;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) grid[i][0] = i;
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
    }
  }
  return grid[a.length][b.length];
}

export function parseWhatsAppDateTime(time: string, date: string): string {
  const [hourRaw, minuteRaw, secondRaw] = time.split(':');
  const parts = date.split(/[./]/).map((part) => Number(part));
  const [day, month, yearRaw] = parts;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw ?? '0');
  if (!day || !month || !year || Number.isNaN(hour) || Number.isNaN(minute)) {
    return new Date().toISOString();
  }
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

export function parseWhatsAppTranscript(raw: string): WhatsAppParseResult {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks: Array<{ speaker: string; createdAt: string; body: string }> = [];

  for (const line of lines) {
    const match = HEADER.exec(line.trimEnd());
    if (match) {
      const [, time, date, speaker, rest] = match;
      blocks.push({
        speaker: speaker.trim(),
        createdAt: parseWhatsAppDateTime(time, date),
        body: rest ?? '',
      });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (!last) continue;
    last.body = last.body ? `${last.body}\n${line}` : line;
  }

  const messages: ParsedWhatsAppMessage[] = [];
  for (const block of blocks) {
    const previous = messages.map((item) => item.text);
    const { text, replyToIndex } = stripQuotedPrefix(block.body, previous);
    if (!text.trim()) continue;
    messages.push({
      speaker: block.speaker,
      createdAt: block.createdAt,
      text,
      replyToIndex,
    });
  }
  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message.speaker, (counts.get(message.speaker) ?? 0) + 1);
  }
  const speakers = [...counts.entries()]
    .map(([name, messageCount]) => ({ name, messageCount }))
    .sort((a, b) => b.messageCount - a.messageCount || a.name.localeCompare(b.name));

  return { messages, speakers };
}

function quoteCandidates(previous: string): string[] {
  const trimmed = previous.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  const lines = trimmed.split('\n');
  if (lines.length > 1 && MEDIA_LABEL.test(lines[0].trim())) {
    const withoutMedia = lines.slice(1).join('\n').trim();
    if (withoutMedia) candidates.push(withoutMedia);
  }
  return candidates.filter((item) => item.length >= QUOTE_MIN_CHARS);
}

function stripQuotedPrefix(
  body: string,
  previousBodies: string[]
): { text: string; replyToIndex: number | null } {
  const trimmed = body.replace(/^\s+/, '').replace(/\s+$/, '');
  let best = { len: 0, index: -1 };
  previousBodies.forEach((previous, index) => {
    for (const quote of quoteCandidates(previous)) {
      if (trimmed === quote) continue;
      if (trimmed.startsWith(quote) && trimmed.length > quote.length && quote.length > best.len) {
        best = { len: quote.length, index };
      }
    }
  });
  if (best.index < 0) return { text: trimmed, replyToIndex: null };
  return { text: trimmed.slice(best.len).replace(/^\s+/, ''), replyToIndex: best.index };
}

export type SpeakerIdentityHints = {
  email?: string;
  username?: string;
  displayName?: string;
};

export type SpeakerGuess = {
  speaker: string | null;
  score: number;
  unsure: boolean;
};

export function scoreSpeakerAgainstHints(speaker: string, hints: SpeakerIdentityHints): number {
  const haystacks = [hints.email, hints.username, hints.displayName, hints.email?.split('@')[0]].filter(
    (value): value is string => Boolean(value)
  );
  return haystacks.reduce((best, hay) => Math.max(best, whatsappNameSimilarity(speaker, hay)), 0);
}

export function guessSelfSpeaker(speakers: string[], self: SpeakerIdentityHints): SpeakerGuess {
  if (speakers.length === 0) return { speaker: null, score: 0, unsure: true };
  const ranked = speakers
    .map((speaker) => ({ speaker, score: scoreSpeakerAgainstHints(speaker, self) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const second = ranked[1];
  const unsure =
    top.score < UNSURE_SCORE ||
    Boolean(second && top.score - second.score < UNSURE_MARGIN && second.score > 0);
  return { speaker: top.speaker, score: top.score, unsure };
}

export type PartnerCandidate = {
  id: string;
  username: string;
  displayName: string;
  email: string;
};

export function guessPartner(
  speaker: string | null,
  candidates: PartnerCandidate[]
): SpeakerGuess & { partnerId: string | null } {
  if (!speaker || candidates.length === 0) {
    return { speaker, score: 0, unsure: true, partnerId: null };
  }
  const ranked = candidates
    .map((candidate) => ({
      partnerId: candidate.id,
      score: Math.max(
        whatsappNameSimilarity(speaker, candidate.username),
        whatsappNameSimilarity(speaker, candidate.displayName),
        whatsappNameSimilarity(speaker, candidate.email),
        whatsappNameSimilarity(speaker, candidate.email.split('@')[0] ?? '')
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const second = ranked[1];
  const unsure =
    top.score < UNSURE_SCORE ||
    Boolean(second && top.score - second.score < UNSURE_MARGIN && second.score > 0);
  return { speaker, score: top.score, unsure, partnerId: top.partnerId };
}

export function messagesForSpeakers(
  messages: ParsedWhatsAppMessage[],
  selfSpeaker: string,
  otherSpeaker: string
): ParsedWhatsAppMessage[] {
  return messages.filter(
    (message) => message.speaker === selfSpeaker || message.speaker === otherSpeaker
  );
}

export function localWhatsAppPartnerId(speaker: string): string {
  const folded = foldWhatsAppName(speaker) || 'partner';
  return `wa:${folded}`;
}
