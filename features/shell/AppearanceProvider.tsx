/**
 * Saved appearance theme (Rosa default, Orange optional). System light/dark still applies.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  APPEARANCE_THEME_IDS,
  APPEARANCE_THEMES,
  DEFAULT_APPEARANCE_THEME,
  appearancePack,
  type AppearancePack,
  type AppearanceThemeId,
  type ThemeColors,
} from '@/constants/Colors';
import { loadAppearanceTheme, saveAppearanceTheme } from '@/adapters/appearance';

type AppearanceContextValue = {
  themeId: AppearanceThemeId;
  pack: AppearancePack;
  setThemeId: (id: AppearanceThemeId) => void;
};

const AppearanceContext = createContext<AppearanceContextValue>({
  themeId: DEFAULT_APPEARANCE_THEME,
  pack: appearancePack(),
  setThemeId: () => {},
});

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<AppearanceThemeId>(DEFAULT_APPEARANCE_THEME);

  useEffect(() => {
    void loadAppearanceTheme().then(setThemeIdState);
  }, []);

  const setThemeId = useCallback((id: AppearanceThemeId) => {
    setThemeIdState(id);
    void saveAppearanceTheme(id);
  }, []);

  const pack = APPEARANCE_THEMES[themeId];

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pack.tokens.ember);
  }, [pack]);

  const value = useMemo(
    () => ({ themeId, pack, setThemeId }),
    [themeId, pack, setThemeId]
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  return useContext(AppearanceContext);
}

export function AppearanceThemePicker({ colors }: { colors: ThemeColors }) {
  const { themeId, setThemeId } = useAppearance();
  return (
    <View style={styles.row}>
      {APPEARANCE_THEME_IDS.map((id) => {
        const pack = APPEARANCE_THEMES[id];
        const selected = themeId === id;
        return (
          <Pressable
            key={id}
            onPress={() => setThemeId(id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${pack.label} theme${selected ? ', selected' : ''}`}
            style={[
              styles.card,
              {
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: selected ? colors.accentSoft : colors.background,
              },
            ]}
          >
            <View style={styles.swatches}>
              {pack.swatches.map((swatch) => (
                <View key={swatch} style={[styles.swatch, { backgroundColor: swatch }]} />
              ))}
            </View>
            <Text style={[styles.label, { color: colors.text }]}>{pack.label}</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>{pack.description}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  card: {
    flexGrow: 1,
    flexBasis: 140,
    minWidth: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  swatches: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.08)' },
  label: { fontWeight: '800', fontSize: 15 },
  hint: { fontSize: 12, lineHeight: 16 },
});
