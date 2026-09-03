import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE_THEME,
  appearancePack,
  isAppearanceThemeId,
} from '@/constants/Colors';
import { parseAppearanceTheme } from './appearance';

describe('appearance theme', () => {
  it('defaults to Rosa and keeps Orange as a saved id', () => {
    expect(DEFAULT_APPEARANCE_THEME).toBe('rosa');
    expect(isAppearanceThemeId('rosa')).toBe(true);
    expect(isAppearanceThemeId('orange')).toBe(true);
    expect(isAppearanceThemeId('ember')).toBe(false);
    expect(parseAppearanceTheme(null)).toBe('rosa');
    expect(parseAppearanceTheme('orange')).toBe('orange');
    expect(parseAppearanceTheme('nope')).toBe('rosa');
  });

  it('gives Rosa a rose accent and Orange the previous ember', () => {
    expect(appearancePack('rosa').tokens.ember).toBe('#C43B6F');
    expect(appearancePack('orange').tokens.ember).toBe('#BD403F');
    expect(appearancePack('rosa').light.accent).not.toBe(appearancePack('orange').light.accent);
  });
});
