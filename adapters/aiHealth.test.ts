import { describe, expect, it } from 'vitest';
import {
  applyFourSomeSession,
  applyIdoSession,
  composeFourSomeCheck,
  isBackendOnline,
  isBackendSelectable,
  preferredLiveBackend,
  type ProbeResult,
} from './aiHealth';

const down = (id: ProbeResult['id'], label: string, detail: string): ProbeResult => ({
  id,
  label,
  ok: false,
  detail,
});
const up = (id: ProbeResult['id'], label: string): ProbeResult => ({
  id,
  label,
  ok: true,
  detail: 'ok',
});

describe('AI connection tests', () => {
  it('enables fourSome when OpenAI or on-prem is up', () => {
    const withOpenAi = composeFourSomeCheck(
      down('onprem', 'On-prem', 'URL not set'),
      up('openai', 'OpenAI'),
      up('foursome', 'host')
    );
    expect(withOpenAi.ok).toBe(true);
    const neither = composeFourSomeCheck(
      down('onprem', 'On-prem', 'URL not set'),
      down('openai', 'OpenAI', '401 invalid key'),
      up('foursome', 'host')
    );
    expect(neither.ok).toBe(false);
    expect(neither.detail).toContain('401');
  });

  it('keeps Demo selectable and disables dead backends', () => {
    const checks: ProbeResult[] = [
      up('server', 'Server'),
      down('foursome', 'fourSome', 'both down'),
      down('onprem', 'On-prem', 'URL not set'),
      down('openai', 'OpenAI', '401 invalid key'),
      down('ido', 'iDO', 'not signed in'),
      up('demo', 'Demo'),
    ];
    expect(isBackendOnline('demo', checks)).toBe(true);
    expect(isBackendOnline('openai', checks)).toBe(false);
    expect(isBackendOnline('onprem', checks)).toBe(false);
    expect(isBackendOnline('foursome', checks)).toBe(false);
    expect(isBackendOnline('ido', checks)).toBe(false);
    expect(isBackendSelectable('demo', null)).toBe(true);
    expect(isBackendSelectable('openai', null)).toBe(false);
    expect(isBackendSelectable('openai', { checkedAt: '', checks })).toBe(false);
  });

  it('requires an iDO session before enabling iDO', () => {
    const report = {
      checkedAt: new Date().toISOString(),
      checks: [up('ido', 'iDO')],
    };
    expect(applyIdoSession(report, false).checks[0].ok).toBe(false);
    expect(applyIdoSession(report, true).checks[0].ok).toBe(true);
  });

  it('auto-selects a working non-demo backend instead of Demo', () => {
    const checks: ProbeResult[] = [
      down('foursome', 'fourSome', 'down'),
      down('onprem', 'On-prem', 'URL not set'),
      down('openai', 'OpenAI', '401'),
      up('ido', 'iDO'),
      up('demo', 'Demo'),
    ];
    expect(preferredLiveBackend(checks, 'demo')).toBe('ido');
    expect(preferredLiveBackend(checks, 'foursome')).toBe('ido');
    expect(preferredLiveBackend(checks, 'ido')).toBe('ido');
  });

  it('prefers iDO when signed in even if OpenAI is also up', () => {
    const checks: ProbeResult[] = [
      down('onprem', 'On-prem', 'URL not set'),
      up('openai', 'OpenAI'),
      up('ido', 'iDO'),
      up('demo', 'Demo'),
    ];
    expect(preferredLiveBackend(checks, 'demo')).toBe('openai');
    expect(preferredLiveBackend(checks, 'demo', { preferIdo: true })).toBe('ido');
  });

  it('requires a fourSome session before enabling the fourSome chip', () => {
    const report = {
      checkedAt: new Date().toISOString(),
      checks: [up('foursome', 'fourSome')],
    };
    const gated = applyFourSomeSession(report, false);
    expect(gated.checks[0].ok).toBe(false);
    expect(gated.checks[0].detail).toContain('sign in to enable');
    expect(applyFourSomeSession(report, true).checks[0].ok).toBe(true);
  });
});
