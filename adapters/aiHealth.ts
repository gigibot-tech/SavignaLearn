/**
 * Connection probes for the Expo server and each AI backend.
 * Used by GET /api/health (no React Native).
 */

import type { AiBackendId } from '@/adapters/aiBackend';
import { foursomeHttpChatUrl, onPremChatBaseUrl } from '@/adapters/aiBackend';

export type ProbeResult = {
  id: 'server' | 'webgpu' | AiBackendId;
  label: string;
  ok: boolean;
  detail: string;
};

export type AiHealthReport = {
  checkedAt: string;
  checks: ProbeResult[];
};

async function fetchStatus(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ status: number; ok: boolean; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { status: response.status, ok: response.ok, body: body.slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}

function openaiKey(): string {
  return process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';
}

function openaiBase(): string {
  return (
    process.env.OPENAI_BASE_URL ||
    process.env.EXPO_PUBLIC_OPENAI_BASE_URL ||
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');
}

function idoProjectUrl(): string {
  return (process.env.EXPO_PUBLIC_IDO_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(
    /\/$/,
    ''
  );
}

function idoAnonKey(): string {
  return process.env.EXPO_PUBLIC_IDO_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
}

function gigiHostOrigin(): string {
  return foursomeHttpChatUrl().replace(/\/chat\/?$/, '').replace(/\/$/, '');
}

export async function probeOpenAi(): Promise<ProbeResult> {
  const key = openaiKey();
  if (!key) {
    return { id: 'openai', label: 'OpenAI', ok: false, detail: 'no API key' };
  }
  try {
    const result = await fetchStatus(
      `${openaiBase()}/models`,
      { headers: { Authorization: `Bearer ${key}` } },
      6000
    );
    if (result.status === 401) {
      return { id: 'openai', label: 'OpenAI', ok: false, detail: '401 invalid key' };
    }
    if (!result.ok) {
      return { id: 'openai', label: 'OpenAI', ok: false, detail: `${result.status}` };
    }
    return { id: 'openai', label: 'OpenAI', ok: true, detail: 'models ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unreachable';
    return { id: 'openai', label: 'OpenAI', ok: false, detail: message };
  }
}

export async function probeOnPrem(): Promise<ProbeResult> {
  const base = onPremChatBaseUrl();
  if (!base) {
    return { id: 'onprem', label: 'On-prem', ok: false, detail: 'URL not set' };
  }
  try {
    const result = await fetchStatus(`${base}/models`, {}, 5000);
    if (!result.ok) {
      return { id: 'onprem', label: 'On-prem', ok: false, detail: `${result.status} ${base}` };
    }
    return { id: 'onprem', label: 'On-prem', ok: true, detail: 'models ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unreachable';
    return { id: 'onprem', label: 'On-prem', ok: false, detail: message };
  }
}

export async function probeGigiHost(): Promise<ProbeResult> {
  const origin = gigiHostOrigin();
  try {
    const result = await fetchStatus(`${origin}/health`, { headers: { Accept: 'application/json' } }, 5000);
    if (!result.ok) {
      return { id: 'foursome', label: 'fourSome host', ok: false, detail: `${result.status}` };
    }
    return { id: 'foursome', label: 'fourSome host', ok: true, detail: 'health ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unreachable';
    return { id: 'foursome', label: 'fourSome host', ok: false, detail: message };
  }
}

export async function probeIdoHost(): Promise<ProbeResult> {
  const url = idoProjectUrl();
  const anon = idoAnonKey();
  if (!url || anon.length < 20) {
    return { id: 'ido', label: 'iDO', ok: false, detail: 'not configured' };
  }
  try {
    const result = await fetchStatus(
      `${url}/auth/v1/health`,
      { headers: { apikey: anon, Authorization: `Bearer ${anon}` } },
      5000
    );
    if (!result.ok) {
      return { id: 'ido', label: 'iDO', ok: false, detail: `${result.status}` };
    }
    return { id: 'ido', label: 'iDO', ok: true, detail: 'auth health ok — sign in to chat' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unreachable';
    return { id: 'ido', label: 'iDO', ok: false, detail: message };
  }
}

export function composeFourSomeCheck(onprem: ProbeResult, openai: ProbeResult, host: ProbeResult): ProbeResult {
  const ok = onprem.ok || openai.ok;
  return {
    id: 'foursome',
    label: 'fourSome',
    ok,
    detail: `on-prem ${onprem.ok ? 'ok' : onprem.detail} · OpenAI ${openai.ok ? 'ok' : openai.detail} · host ${host.ok ? 'ok' : host.detail}`,
  };
}

export function isBackendOnline(id: AiBackendId, checks: ProbeResult[]): boolean {
  if (id === 'demo') return true;
  return Boolean(checks.find((item) => item.id === id)?.ok);
}

/** Demo is always selectable. Other backends stay off until a successful probe. */
export function isBackendSelectable(id: AiBackendId, health: AiHealthReport | null): boolean {
  if (id === 'demo') return true;
  if (!health) return false;
  return isBackendOnline(id, health.checks);
}

/** Prefer a live cloud/on-prem backend over Demo. Keep the current pick when it is still up. */
export const LIVE_BACKEND_PRIORITY: AiBackendId[] = ['onprem', 'openai', 'ido', 'foursome'];

export function preferredLiveBackend(
  checks: ProbeResult[],
  current: AiBackendId,
  options?: { preferIdo?: boolean }
): AiBackendId {
  if (current !== 'demo' && isBackendOnline(current, checks)) return current;
  if (options?.preferIdo && isBackendOnline('ido', checks)) return 'ido';
  return LIVE_BACKEND_PRIORITY.find((id) => isBackendOnline(id, checks)) ?? 'demo';
}

export async function collectAiHealth(): Promise<AiHealthReport> {
  const [openai, onprem, host, ido] = await Promise.all([
    probeOpenAi(),
    probeOnPrem(),
    probeGigiHost(),
    probeIdoHost(),
  ]);
  const foursome = composeFourSomeCheck(onprem, openai, host);
  return {
    checkedAt: new Date().toISOString(),
    checks: [
      { id: 'server', label: 'Server', ok: true, detail: 'Expo /api/health' },
      foursome,
      onprem,
      openai,
      ido,
      { id: 'webgpu', label: 'WebGPU Gemma', ok: false, detail: 'probed in the browser' },
      { id: 'demo', label: 'Demo', ok: true, detail: 'offline scripted' },
    ],
  };
}

export function applyIdoSession(report: AiHealthReport, signedIn: boolean): AiHealthReport {
  return {
    ...report,
    checks: report.checks.map((item) => {
      if (item.id !== 'ido') return item;
      if (!item.ok) return item;
      if (signedIn) return { ...item, detail: 'signed in' };
      return { ...item, ok: false, detail: 'host ok — sign in to enable' };
    }),
  };
}

export function applyFourSomeSession(report: AiHealthReport, signedIn: boolean): AiHealthReport {
  return {
    ...report,
    checks: report.checks.map((item) => {
      if (item.id !== 'foursome') return item;
      if (!signedIn) {
        return { ...item, ok: false, detail: `sign in to enable · ${item.detail}` };
      }
      return { ...item, detail: item.ok ? `signed in · ${item.detail}` : item.detail };
    }),
  };
}

/** Merge the in-tab WebGPU Gemma probe. Ready Gemma counts as on-prem for the chips. */
export function applyWebGemmaCheck(report: AiHealthReport, web: ProbeResult): AiHealthReport {
  const checks = report.checks.filter((item) => item.id !== 'webgpu');
  const serverAt = checks.findIndex((item) => item.id === 'server');
  const next = [...checks];
  next.splice(serverAt >= 0 ? serverAt + 1 : 0, 0, web);
  if (!web.ok) return { ...report, checks: next };
  return {
    ...report,
    checks: next.map((item) => {
      if (item.id === 'onprem') {
        return { ...item, ok: true, detail: web.detail };
      }
      if (item.id === 'foursome') {
        return {
          ...item,
          ok: true,
          detail: item.detail.includes('WebGPU') ? item.detail : `${item.detail} · WebGPU Gemma`,
        };
      }
      return item;
    }),
  };
}
