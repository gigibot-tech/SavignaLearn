/**
 * Appearance theme persistence. Default is Rosa; Orange stays available in Settings.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_APPEARANCE_THEME,
  isAppearanceThemeId,
  type AppearanceThemeId,
} from '@/constants/Colors';

export const APPEARANCE_THEME_STORAGE_KEY = 'savigna.appearanceTheme.v1';

export function parseAppearanceTheme(raw: string | null | undefined): AppearanceThemeId {
  return isAppearanceThemeId(raw) ? raw : DEFAULT_APPEARANCE_THEME;
}

export async function loadAppearanceTheme(): Promise<AppearanceThemeId> {
  try {
    return parseAppearanceTheme(await AsyncStorage.getItem(APPEARANCE_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_APPEARANCE_THEME;
  }
}

export async function saveAppearanceTheme(id: AppearanceThemeId): Promise<void> {
  await AsyncStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, id);
}
