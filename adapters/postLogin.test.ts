import { describe, expect, it } from 'vitest';
import { learningBotHref, needsPostLoginBotRedirect, routeParam } from './postLogin';

describe('postLogin', () => {
  it('opens SavignasBoi after login instead of Settings or chats home', () => {
    expect(needsPostLoginBotRedirect('/settings', 'demo-1')).toBe(true);
    expect(needsPostLoginBotRedirect('/', 'demo-1')).toBe(true);
    expect(needsPostLoginBotRedirect('/modal', 'demo-1')).toBe(true);
    expect(needsPostLoginBotRedirect('/chat/other', 'demo-1')).toBe(true);
  });

  it('does not bounce if the bot thread is already open', () => {
    expect(needsPostLoginBotRedirect('/chat/demo-1', 'demo-1')).toBe(false);
    expect(learningBotHref('demo-1')).toBe('/chat/demo-1');
  });

  it('normalizes Expo Router params that arrive as arrays', () => {
    expect(routeParam('demo-1', 'fallback')).toBe('demo-1');
    expect(routeParam(['demo-1'], 'fallback')).toBe('demo-1');
    expect(routeParam(undefined, 'demo-1')).toBe('demo-1');
  });
});
