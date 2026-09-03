import { describe, expect, it } from 'vitest';
import { applyWebGemmaCheck, type ProbeResult } from './aiHealth';
import { parseIsoLangCode, unwrapGeneratedText } from './webGemma';

describe('WebGPU Gemma helpers', () => {
  it('unwraps chat-style generated_text arrays', () => {
    expect(
      unwrapGeneratedText([
        {
          generated_text: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hallo' },
          ],
        },
      ])
    ).toBe('Hallo');
  });

  it('parses an ISO language code from noisy model output', () => {
    expect(parseIsoLangCode('The language is DE.')).toBe('de');
    expect(parseIsoLangCode('xx')).toBeNull();
  });

  it('marks on-prem up when WebGPU Gemma is ready in the tab', () => {
    const web: ProbeResult = {
      id: 'webgpu',
      label: 'WebGPU Gemma',
      ok: true,
      detail: 'webgpu/q4',
    };
    const report = applyWebGemmaCheck(
      {
        checkedAt: '',
        checks: [
          { id: 'server', label: 'Server', ok: true, detail: 'ok' },
          { id: 'onprem', label: 'On-prem', ok: false, detail: 'URL not set' },
          { id: 'foursome', label: 'fourSome', ok: false, detail: 'both down' },
        ],
      },
      web
    );
    expect(report.checks.find((item) => item.id === 'webgpu')?.ok).toBe(true);
    expect(report.checks.find((item) => item.id === 'onprem')?.ok).toBe(true);
    expect(report.checks.find((item) => item.id === 'onprem')?.detail).toBe('webgpu/q4');
    expect(report.checks.find((item) => item.id === 'foursome')?.ok).toBe(true);
  });
});
