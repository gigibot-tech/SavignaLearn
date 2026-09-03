/**
 * Proxies to a local OpenAI-compatible server (vLLM / Ollama / fourSome on-prem).
 * Browser never talks to localhost:8000 directly (CORS).
 */

import { onPremChatBaseUrl } from '@/adapters/aiBackend';
import type { ChatCompletionMessage } from '@/ports/ports';

type Body = {
  messages?: ChatCompletionMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
};

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
  const baseUrl = onPremChatBaseUrl();
  if (!baseUrl) {
    return Response.json(
      { error: 'EXPO_PUBLIC_ONPREM_CHAT_URL is not set' },
      { status: 503, headers: corsHeaders() }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders() });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'messages required' }, { status: 400, headers: corsHeaders() });
  }

  const model = body.model || process.env.EXPO_PUBLIC_ONPREM_MODEL || 'gpt-4o-mini';
  const apiKey =
    process.env.EXPO_PUBLIC_ONPREM_API_KEY || process.env.EXPO_PUBLIC_CHAT_COMPLETION_KEY || '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 1000,
      }),
      signal: controller.signal,
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return Response.json(
        {
          error:
            (data as { error?: { message?: string } }).error?.message ??
            `On-prem upstream ${upstream.status}`,
        },
        { status: upstream.status, headers: corsHeaders() }
      );
    }
    return Response.json(data, { status: 200, headers: corsHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'On-prem fetch failed';
    return Response.json({ error: message }, { status: 502, headers: corsHeaders() });
  } finally {
    clearTimeout(timer);
  }
}
