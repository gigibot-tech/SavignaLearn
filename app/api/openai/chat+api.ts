/**
 * Server-side OpenAI proxy — browsers cannot call api.openai.com (CORS).
 * Secrets stay on the Expo server route; never return the API key to the client.
 */

import type { ChatCompletionMessage } from '@/ports/ports';

type Body = {
  messages?: ChatCompletionMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  json?: boolean;
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
  const apiKey =
    process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';
  if (!apiKey) {
    return Response.json(
      { error: 'OpenAI API key not configured on server' },
      { status: 500, headers: corsHeaders() }
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

  const model =
    body.model || process.env.EXPO_PUBLIC_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const baseUrl =
    process.env.OPENAI_BASE_URL ||
    process.env.EXPO_PUBLIC_OPENAI_BASE_URL ||
    'https://api.openai.com/v1';

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: body.messages,
      temperature: body.temperature ?? 0.7,
      max_tokens: body.max_tokens ?? 1000,
      ...(body.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return Response.json(
      {
        error:
          (data as { error?: { message?: string } }).error?.message ??
          `OpenAI upstream ${upstream.status}`,
      },
      { status: upstream.status, headers: corsHeaders() }
    );
  }

  return Response.json(data, { status: 200, headers: corsHeaders() });
}
