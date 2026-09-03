/**
 * In-browser Gemma 3 (270M ONNX) via Transformers.js + WebGPU.
 * Loads off the send path; translation/chat throw until ready so the circuit breaker can fall back.
 */

import type { ProbeResult } from '@/adapters/aiHealth';
import type { ChatCompletionMessage, ChatCompletionPort } from '@/ports/ports';

export const WEB_GEMMA_MODEL = 'onnx-community/gemma-3-270m-it-ONNX';

const ISO_LANGS = new Set([
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
  'sv',
  'da',
  'fi',
  'cs',
  'hu',
  'ro',
  'el',
  'ru',
  'uk',
  'tr',
  'ar',
  'he',
  'ja',
  'ko',
  'zh',
  'hi',
]);

const LANG_LABEL: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ru: 'Russian',
  pl: 'Polish',
  tr: 'Turkish',
};

export type WebGemmaStatus = {
  state: 'off' | 'unavailable' | 'loading' | 'ready' | 'error';
  device?: string;
  detail: string;
};

type Generator = (
  messages: Array<{ role: string; content: string }>,
  options: { max_new_tokens: number; temperature?: number; do_sample?: boolean }
) => Promise<unknown>;

let generator: Generator | null = null;
let loadPromise: Promise<void> | null = null;
let status: WebGemmaStatus = {
  state: process.env.EXPO_PUBLIC_ENABLE_WEB_GEMMA === 'true' ? 'unavailable' : 'off',
  detail: process.env.EXPO_PUBLIC_ENABLE_WEB_GEMMA === 'true' ? 'not started' : 'flag off',
};
const listeners = new Set<() => void>();
let queue: Promise<void> = Promise.resolve();

export type WebGemmaRequest =
  | { type: 'detect'; text: string }
  | {
      type: 'translate';
      text: string;
      source_lang_code: string;
      target_lang_code: string;
      mode: 'lines' | 'birkenbihl';
    }
  | { type: 'chat'; messages: ChatCompletionMessage[] };

export type WebGemmaResponse =
  | { ok: true; lang?: string; text?: string }
  | { ok: false; error: string };

export function isWebGemmaEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_WEB_GEMMA === 'true';
}

export function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as { gpu?: unknown }).gpu);
}

export function getWebGemmaStatus(): WebGemmaStatus {
  return status;
}

export function onWebGemmaStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(next: WebGemmaStatus) {
  status = next;
  for (const listener of listeners) listener();
}

export function unwrapGeneratedText(result: unknown): string {
  const first = Array.isArray(result) ? result[0] : result;
  if (!first || typeof first !== 'object') return '';
  const text = (first as { generated_text?: unknown }).generated_text;
  if (typeof text === 'string') {
    return text.replace(/^[\s\S]*assistant\s*/i, '').trim();
  }
  if (Array.isArray(text)) {
    const last = [...text].reverse().find((item) => item && typeof item === 'object');
    const content = (last as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === 'string' ? part : (part as { text?: string })?.text ?? ''))
        .join('')
        .trim();
    }
  }
  return '';
}

export function parseIsoLangCode(raw: string): string | null {
  const tokens = raw.toLowerCase().match(/[a-z]{2}/g) ?? [];
  for (const token of tokens) {
    if (ISO_LANGS.has(token)) return token;
  }
  return null;
}

export function probeWebGemma(): ProbeResult {
  if (!isWebGemmaEnabled()) {
    return { id: 'webgpu', label: 'WebGPU Gemma', ok: false, detail: 'flag off' };
  }
  if (typeof window === 'undefined') {
    return { id: 'webgpu', label: 'WebGPU Gemma', ok: false, detail: 'browser-only' };
  }
  if (!hasWebGpu()) {
    return { id: 'webgpu', label: 'WebGPU Gemma', ok: false, detail: 'WebGPU not available in this browser' };
  }
  const current = getWebGemmaStatus();
  if (current.state === 'ready') {
    return {
      id: 'webgpu',
      label: 'WebGPU Gemma',
      ok: true,
      detail: `${current.device ?? 'webgpu'} · ${WEB_GEMMA_MODEL}`,
    };
  }
  if (current.state === 'loading') {
    return { id: 'webgpu', label: 'WebGPU Gemma', ok: false, detail: 'loading ONNX in this tab…' };
  }
  if (current.state === 'unavailable') {
    return {
      id: 'webgpu',
      label: 'WebGPU Gemma',
      ok: false,
      detail: current.detail === 'not started' ? 'waiting to load' : current.detail,
    };
  }
  if (current.state === 'error') {
    return { id: 'webgpu', label: 'WebGPU Gemma', ok: false, detail: current.detail };
  }
  return { id: 'webgpu', label: 'WebGPU Gemma', ok: false, detail: 'waiting to load' };
}

async function importTransformers() {
  const mod = await import('@huggingface/transformers');
  const env = mod.env as {
    allowLocalModels?: boolean;
    version?: string;
    backends?: { onnx?: { wasm?: { numThreads?: number; wasmPaths?: string } } };
  };
  env.allowLocalModels = false;
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${env.version ?? '4.2.0'}/dist/`;
  }
  return mod;
}

async function loadGenerator(): Promise<Generator> {
  if (generator) return generator;
  if (!isWebGemmaEnabled()) throw new Error('Web Gemma flag is off');
  if (typeof window === 'undefined') throw new Error('Web Gemma is browser-only');
  if (!hasWebGpu()) throw new Error('WebGPU not available');

  if (!loadPromise) {
    setStatus({ state: 'loading', detail: `downloading ${WEB_GEMMA_MODEL}` });
    loadPromise = (async () => {
      const { pipeline } = await importTransformers();
      const attempts: Array<{ device: string; dtype: string }> = [
        { device: 'webgpu', dtype: 'q4' },
        { device: 'webgpu', dtype: 'fp16' },
        { device: 'webgpu', dtype: 'fp32' },
      ];
      let lastError: unknown;
      for (const opts of attempts) {
        try {
          const pipe = await pipeline('text-generation', WEB_GEMMA_MODEL, opts);
          generator = pipe as unknown as Generator;
          setStatus({
            state: 'ready',
            device: `${opts.device}/${opts.dtype}`,
            detail: `${opts.device} ${opts.dtype}`,
          });
          return;
        } catch (error) {
          lastError = error;
        }
      }
      const message = lastError instanceof Error ? lastError.message : 'Gemma load failed';
      setStatus({ state: 'error', detail: message });
      throw lastError instanceof Error ? lastError : new Error(message);
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }

  await loadPromise;
  if (!generator) throw new Error('Web Gemma generator missing');
  return generator;
}

export function preloadWebGemma(): Promise<void> {
  if (!isWebGemmaEnabled() || typeof window === 'undefined') return Promise.resolve();
  if (!hasWebGpu()) {
    setStatus({ state: 'unavailable', detail: 'WebGPU not available in this browser' });
    return Promise.resolve();
  }
  return loadGenerator().then(() => undefined).catch(() => undefined);
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function generate(messages: Array<{ role: string; content: string }>, maxNewTokens: number) {
  const pipe = await loadGenerator();
  const result = await enqueue(() =>
    pipe(messages, { max_new_tokens: maxNewTokens, do_sample: false, temperature: 0.2 })
  );
  const text = unwrapGeneratedText(result);
  if (!text) throw new Error('Web Gemma returned empty text');
  return text;
}

export async function runWebGemmaInWorker(request: WebGemmaRequest): Promise<WebGemmaResponse> {
  try {
    if (getWebGemmaStatus().state !== 'ready') {
      throw new Error('Web Gemma not ready');
    }
    if (request.type === 'detect') {
      const raw = await generate(
        [
          {
            role: 'system',
            content: 'Reply with only a two-letter ISO 639-1 language code.',
          },
          { role: 'user', content: request.text.slice(0, 500) },
        ],
        8
      );
      const lang = parseIsoLangCode(raw);
      if (!lang) return { ok: false, error: `no language code in: ${raw.slice(0, 80)}` };
      return { ok: true, lang };
    }
    if (request.type === 'translate') {
      const target = LANG_LABEL[request.target_lang_code] ?? request.target_lang_code;
      const raw = await generate(
        [
          {
            role: 'system',
            content: `Translate into ${target}. Output only the translation, no quotes or labels.`,
          },
          { role: 'user', content: request.text.slice(0, 2000) },
        ],
        160
      );
      return { ok: true, text: raw };
    }
    const text = await generate(
      request.messages.map((item) => ({ role: item.role, content: item.content })),
      180
    );
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Web Gemma failed' };
  }
}

export async function completeWithWebGemma(messages: ChatCompletionMessage[]): Promise<string> {
  const result = await runWebGemmaInWorker({ type: 'chat', messages });
  if (!result.ok || !result.text) {
    throw new Error(result.ok === false ? result.error : 'Web Gemma chat failed');
  }
  return result.text;
}

export class WebGemmaChatCompletionAdapter implements ChatCompletionPort {
  isAvailable(): boolean {
    return isWebGemmaEnabled() && typeof window !== 'undefined' && hasWebGpu();
  }

  async complete(messages: ChatCompletionMessage[]): Promise<string> {
    if (getWebGemmaStatus().state !== 'ready') {
      throw new Error('Web Gemma not ready');
    }
    return completeWithWebGemma(messages);
  }
}
