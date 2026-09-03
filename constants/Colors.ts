/**
 * SavignaLearn palettes. Rosa is the default; Orange is the previous ember look.
 * Gradient stops power GradientBackground; accent is send / CTAs / AI spark.
 */

export type AppearanceThemeId = 'rosa' | 'orange';

export const DEFAULT_APPEARANCE_THEME: AppearanceThemeId = 'rosa';

export const APPEARANCE_THEME_IDS = ['rosa', 'orange'] as const;

export function isAppearanceThemeId(value: unknown): value is AppearanceThemeId {
  return value === 'rosa' || value === 'orange';
}

export type ThemeTokens = {
  ember: string;
  coral: string;
  peach: string;
  dawn: string;
  blush: string;
  wine: string;
  night: string;
  deep: string;
  ink: string;
  muted: string;
  line: string;
  glassLight: string;
  glassDark: string;
  success: string;
  danger: string;
  surfaceSolidLight: string;
  surfaceSolidDark: string;
  washEnd: string;
  darkText: string;
  darkMuted: string;
  darkSurface: string;
  darkBorder: string;
  darkBubbleIn: string;
  darkBubbleAi: string;
  darkHeaderGlass: string;
  darkOnAccent: string;
  lightHeaderGlass: string;
  failedDeep: string;
};

export type ThemeGradients = {
  light: readonly [string, string, string];
  dark: readonly [string, string, string];
  cta: readonly [string, string];
  ctaSoft: readonly [string, string];
  bubbleOut: readonly [string, string];
  headerDark: readonly [string, string];
  headerLight: readonly [string, string];
};

export type ThemeColors = {
  text: string;
  textMuted: string;
  background: string;
  surface: string;
  surfaceSolid: string;
  tint: string;
  accent: string;
  accentSoft: string;
  tabIconDefault: string;
  tabIconSelected: string;
  bubbleIncoming: string;
  bubbleOutgoing: string;
  bubbleAi: string;
  bubbleSystem: string;
  border: string;
  unread: string;
  online: string;
  danger: string;
  onAccent: string;
  onSoft: string;
  headerGlass: string;
};

export type AppearancePack = {
  id: AppearanceThemeId;
  label: string;
  description: string;
  swatches: readonly [string, string, string];
  tokens: ThemeTokens;
  gradients: ThemeGradients;
  light: ThemeColors;
  dark: ThemeColors;
};

const orangeTokens: ThemeTokens = {
  ember: '#BD403F',
  coral: '#E85D4C',
  peach: '#FEB47B',
  dawn: '#FFD4C2',
  blush: '#FFF1E6',
  wine: '#5A1A1A',
  night: '#1A0A08',
  deep: '#8B2E28',
  ink: '#2A1210',
  muted: '#7A5348',
  line: 'rgba(189, 64, 63, 0.18)',
  glassLight: 'rgba(255, 255, 255, 0.78)',
  glassDark: 'rgba(42, 18, 16, 0.72)',
  success: '#2F9E6A',
  danger: '#C62828',
  surfaceSolidLight: '#FFF8F3',
  surfaceSolidDark: '#2A1612',
  washEnd: '#F4A07A',
  darkText: '#FFF0E8',
  darkMuted: '#D4A99A',
  darkSurface: '#2A1612',
  darkBorder: 'rgba(254, 180, 123, 0.22)',
  darkBubbleIn: 'rgba(58, 36, 32, 0.9)',
  darkBubbleAi: 'rgba(90, 40, 34, 0.88)',
  darkHeaderGlass: 'rgba(26, 10, 8, 0.78)',
  darkOnAccent: '#1A0A08',
  lightHeaderGlass: 'rgba(255, 248, 243, 0.82)',
  failedDeep: '#3A1010',
};

const rosaTokens: ThemeTokens = {
  ember: '#C43B6F',
  coral: '#E85A8A',
  peach: '#F5A3C0',
  dawn: '#FFD6E3',
  blush: '#FFF5F8',
  wine: '#5A1830',
  night: '#1A0810',
  deep: '#8B2A4A',
  ink: '#3A1220',
  muted: '#8A5466',
  line: 'rgba(196, 59, 111, 0.18)',
  glassLight: 'rgba(255, 255, 255, 0.78)',
  glassDark: 'rgba(42, 16, 28, 0.72)',
  success: '#2F9E6A',
  danger: '#C62828',
  surfaceSolidLight: '#FFF8FA',
  surfaceSolidDark: '#2A121C',
  washEnd: '#F4A0C0',
  darkText: '#FFF0F5',
  darkMuted: '#D4A0B4',
  darkSurface: '#2A121C',
  darkBorder: 'rgba(245, 163, 192, 0.22)',
  darkBubbleIn: 'rgba(58, 28, 40, 0.9)',
  darkBubbleAi: 'rgba(90, 34, 56, 0.88)',
  darkHeaderGlass: 'rgba(26, 8, 16, 0.78)',
  darkOnAccent: '#1A0810',
  lightHeaderGlass: 'rgba(255, 248, 250, 0.82)',
  failedDeep: '#3A1020',
};

function packFromTokens(
  id: AppearanceThemeId,
  label: string,
  description: string,
  t: ThemeTokens
): AppearancePack {
  const gradients: ThemeGradients = {
    light: [t.blush, t.dawn, t.washEnd],
    dark: [t.night, t.wine, t.ember],
    cta: [t.coral, t.ember],
    ctaSoft: [t.peach, t.coral],
    bubbleOut: [t.coral, t.ember],
    headerDark: [`${t.night}8C`, 'transparent'],
    headerLight: [`${t.blush}B3`, 'transparent'],
  };
  return {
    id,
    label,
    description,
    swatches: [t.blush, t.coral, t.ember],
    tokens: t,
    gradients,
    light: {
      text: t.ink,
      textMuted: t.muted,
      background: t.blush,
      surface: t.glassLight,
      surfaceSolid: t.surfaceSolidLight,
      tint: t.ember,
      accent: t.ember,
      accentSoft: t.line.replace('0.18', '0.14'),
      tabIconDefault: id === 'rosa' ? '#C49AAB' : '#B89A8C',
      tabIconSelected: t.deep,
      bubbleIncoming: 'rgba(255,255,255,0.88)',
      bubbleOutgoing: t.coral,
      bubbleAi: id === 'rosa' ? 'rgba(255, 232, 240, 0.92)' : 'rgba(255, 236, 224, 0.92)',
      bubbleSystem: 'transparent',
      border: t.line,
      unread: t.ember,
      online: t.success,
      danger: t.danger,
      onAccent: '#FFFFFF',
      onSoft: t.wine,
      headerGlass: t.lightHeaderGlass,
    },
    dark: {
      text: t.darkText,
      textMuted: t.darkMuted,
      background: t.night,
      surface: t.glassDark,
      surfaceSolid: t.surfaceSolidDark,
      tint: t.peach,
      accent: t.peach,
      accentSoft: id === 'rosa' ? 'rgba(245, 163, 192, 0.18)' : 'rgba(254, 180, 123, 0.18)',
      tabIconDefault: id === 'rosa' ? '#8A6474' : '#8A7064',
      tabIconSelected: t.peach,
      bubbleIncoming: t.darkBubbleIn,
      bubbleOutgoing: t.ember,
      bubbleAi: t.darkBubbleAi,
      bubbleSystem: 'transparent',
      border: t.darkBorder,
      unread: t.peach,
      online: t.success,
      danger: '#EF9A9A',
      onAccent: t.darkOnAccent,
      onSoft: t.peach,
      headerGlass: t.darkHeaderGlass,
    },
  };
}

export const APPEARANCE_THEMES: Record<AppearanceThemeId, AppearancePack> = {
  rosa: packFromTokens(
    'rosa',
    'Rosa',
    'Rose and blush — the default SavignaLearn look.',
    rosaTokens
  ),
  orange: packFromTokens(
    'orange',
    'Orange',
    'Warm ember and peach — the original fourSome coral look.',
    orangeTokens
  ),
};

export function appearancePack(id: AppearanceThemeId = DEFAULT_APPEARANCE_THEME): AppearancePack {
  return APPEARANCE_THEMES[id] ?? APPEARANCE_THEMES[DEFAULT_APPEARANCE_THEME];
}

/** Default (Rosa) tokens — prefer `useAppearance().pack.tokens` in UI. */
export const tokens = APPEARANCE_THEMES.rosa.tokens;

/** Default (Rosa) gradients — prefer `useAppearance().pack.gradients` in UI. */
export const gradients = APPEARANCE_THEMES.rosa.gradients;

/** Default (Rosa) light/dark surfaces for Expo template helpers. */
export const Colors = {
  light: APPEARANCE_THEMES.rosa.light,
  dark: APPEARANCE_THEMES.rosa.dark,
};

export default Colors;
