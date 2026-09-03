/**
 * Switchable AI backends (fourSome / iDO / OpenAI / demo).
 * No React Native imports — safe for Vitest and Expo API routes.
 */

export type AiBackendId = 'foursome' | 'onprem' | 'ido' | 'openai' | 'demo';

export const AI_BACKENDS: Array<{ id: AiBackendId; label: string; hint: string }> = [
  {
    id: 'foursome',
    label: 'fourSome',
    hint: 'Same as fourSome GiGi engine: on-prem (vLLM) first, then OpenAI. GiGi socket only if you set a user UUID.',
  },
  {
    id: 'onprem',
    label: 'On-prem',
    hint: 'Local vLLM / Ollama, or in-tab WebGPU Gemma when EXPO_PUBLIC_ENABLE_WEB_GEMMA is on.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'Cloud GPT via /api/openai/chat. Needs a valid server key (copied frontend key is 401).',
  },
  {
    id: 'ido',
    label: 'iDO',
    hint: 'ido-core ai-assist edge function (server key). Sign in with an iDO account.',
  },
  { id: 'demo', label: 'Demo', hint: 'Offline scripted replies — always works' },
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function defaultAiBackend(): AiBackendId {
  const env = process.env.EXPO_PUBLIC_AI_BACKEND;
  if (env === 'openai' || env === 'foursome' || env === 'demo' || env === 'ido' || env === 'onprem') {
    return env;
  }
  if (process.env.EXPO_PUBLIC_USE_FOURSOME_AI === 'true') return 'foursome';
  return 'demo';
}

export function isAiBackendId(value: string | null | undefined): value is AiBackendId {
  return (
    value === 'foursome' ||
    value === 'onprem' ||
    value === 'ido' ||
    value === 'openai' ||
    value === 'demo'
  );
}

export function labelForAiBackend(id: AiBackendId): string {
  if (id === 'foursome') return 'fourSome';
  if (id === 'onprem') return 'On-prem';
  if (id === 'ido') return 'iDO';
  if (id === 'openai') return 'OpenAI';
  return 'Demo';
}

export function onPremChatBaseUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_ONPREM_CHAT_URL || process.env.ONPREM_CHAT_URL || '').trim();
  return raw.replace(/\/$/, '');
}

/** fourSome send_invites WS requires a real users-table UUID — never invent one. */
export function isFourSomeUserId(raw: string | null | undefined): raw is string {
  return Boolean(raw && UUID_RE.test(raw.trim()));
}

export function resolveFourSomeUserId(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (isFourSomeUserId(candidate)) return candidate.trim().toLowerCase();
  }
  return null;
}

export function foursomeHttpChatUrl(): string {
  return (
    process.env.EXPO_PUBLIC_CHAT_COMPLETION_URL ||
    'https://p01--four-some-backend--yjfqr8lcxqgg.code.run/chat/'
  );
}

export function foursomeWsUrl(httpChatUrl = foursomeHttpChatUrl()): string {
  const origin = httpChatUrl.replace(/\/chat\/?$/, '').replace(/\/$/, '');
  return `${origin.replace(/^http/, 'ws')}/ws`;
}

export function messagesToFourSomeQuery(
  messages: Array<{ role: string; content: string }>
): string {
  const lastUser = [...messages].reverse().find((item) => item.role === 'user');
  const system = messages.find((item) => item.role === 'system');
  return [system?.content, lastUser?.content].filter(Boolean).join('\n\n');
}

type WsLike = {
  send: (data: string) => void;
  close: () => void;
  addEventListener?: (type: string, fn: (ev: { data?: unknown }) => void) => void;
  onopen?: ((ev?: unknown) => void) | null;
  onmessage?: ((ev: { data?: unknown }) => void) | null;
  onerror?: ((ev?: unknown) => void) | null;
  onclose?: ((ev?: unknown) => void) | null;
};

/**
 * Live fourSome Northflank chat is WebSocket `/ws` (`action: chat`, `message`),
 * not HTTP `/chat/` (that path 404s on the current send_invites deploy).
 */
export async function completeFourSomeWebSocket(input: {
  message: string;
  userId: string;
  wsUrl?: string;
  timeoutMs?: number;
}): Promise<string> {
  const WebSocketImpl = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket;
  if (!WebSocketImpl) throw new Error('WebSocket is not available');

  const wsUrl = input.wsUrl ?? foursomeWsUrl();
  const timeoutMs = input.timeoutMs ?? 45_000;

  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(wsUrl);
    let full = '';
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (error) reject(error);
      else if (full.trim()) resolve(full.trim());
      else reject(new Error('fourSome WebSocket returned no content'));
    };

    const timer = setTimeout(() => finish(new Error('fourSome WebSocket timed out')), timeoutMs);

    const onMessage = (ev: { data?: unknown }) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
      if (!raw) return;
      try {
        const data = JSON.parse(raw) as {
          type?: string;
          action?: string;
          delta?: string;
          content?: string;
          response?: string;
          error?: string;
        };
        if (data.type === 'heartbeat') return;
        if (data.error) {
          finish(new Error(data.error));
          return;
        }
        const piece = data.delta ?? data.content ?? data.response ?? '';
        if (
          data.action === 'greet_user_response_stream' ||
          data.action === 'chat_response_stream' ||
          data.type === 'greet_user_response_stream'
        ) {
          full += piece;
          return;
        }
        if (
          data.action === 'greet_user_response_done' ||
          data.action === 'chat_response_done' ||
          data.type === 'greet_user_response_done'
        ) {
          finish();
          return;
        }
        if (piece && data.action === 'greet_user_response') {
          full += piece;
          finish();
        }
      } catch {
        if (/session error/i.test(raw)) {
          finish(new Error(raw));
          return;
        }
        full += raw;
      }
    };

    const onOpen = () => {
      ws.send(
        JSON.stringify({
          action: 'chat',
          user_id: input.userId,
          message: input.message,
        })
      );
    };

    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', () => finish(new Error('fourSome WebSocket error')));
      ws.addEventListener('close', () => {
        if (!settled) finish(full.trim() ? undefined : new Error('fourSome WebSocket closed'));
      });
    } else {
      ws.onopen = onOpen;
      ws.onmessage = onMessage;
      ws.onerror = () => finish(new Error('fourSome WebSocket error'));
      ws.onclose = () => {
        if (!settled) finish(full.trim() ? undefined : new Error('fourSome WebSocket closed'));
      };
    }
  });
}
