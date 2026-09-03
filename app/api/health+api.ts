/**
 * GET /api/health — connection tests for Expo server + each AI backend.
 * Does not run chat completions (avoids extra OpenAI 401s on /api/openai/chat).
 */

import { collectAiHealth } from '@/adapters/aiHealth';

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  const report = await collectAiHealth();
  return Response.json(report, { status: 200, headers: corsHeaders() });
}
