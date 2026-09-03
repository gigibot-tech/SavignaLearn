/**
 * Proxies one real fourSome user talking to GiGi.
 * Two-person SavignaLearn threads do not use this route.
 * HTTP `/chat/` 404s on the current send_invites deploy; WebSocket `/ws` is GiGi.
 */

import {
  completeFourSomeWebSocket,
  foursomeHttpChatUrl,
  isFourSomeUserId,
  messagesToFourSomeQuery,
} from '@/adapters/aiBackend';
import type { ChatCompletionMessage } from '@/ports/ports';

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  let body: { messages?: ChatCompletionMessage[]; user_id?: string; user_query?: string };
  try {
    body = (await request.json()) as {
      messages?: ChatCompletionMessage[];
      user_id?: string;
      user_query?: string;
    };
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders() });
  }

  const userQuery =
    body.user_query || (body.messages ? messagesToFourSomeQuery(body.messages) : '');
  if (!userQuery) {
    return Response.json({ error: 'messages required' }, { status: 400, headers: corsHeaders() });
  }
  const userId = body.user_id?.trim() ?? '';
  if (!isFourSomeUserId(userId)) {
    return Response.json(
      { error: 'fourSome user_id must be a real UUID (the signed-in fourSome user)' },
      { status: 400, headers: corsHeaders() }
    );
  }

  try {
    const upstream = await fetch(foursomeHttpChatUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ user_id: userId, user_query: userQuery }),
    });
    if (upstream.ok) {
      const data = (await upstream.json().catch(() => ({}))) as {
        response?: string;
        message?: string;
        content?: string;
      };
      const content = data.response ?? data.message ?? data.content ?? '';
      if (content) {
        return Response.json({ content, response: content }, { status: 200, headers: corsHeaders() });
      }
    }
  } catch {
    // Fall through to WebSocket — HTTP `/chat/` is not on this deploy.
  }

  try {
    const content = await completeFourSomeWebSocket({ message: userQuery, userId });
    return Response.json({ content, response: content }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fourSome WebSocket failed';
    return Response.json({ error: message }, { status: 502, headers: corsHeaders() });
  }
}
