/**
 * SavignaLearn palette — fourSome warm ember + dawn peach (not flat cream / purple).
 * Gradient stops power GradientBackground; accent reserved for send / CTAs / AI spark.
 */

export const tokens = {
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
} as const;

/** Vertical screen washes (Gigolingo shell + fourSome ember stops). */
export const gradients = {
  light: [tokens.blush, tokens.dawn, '#F4A07A'] as const,
  dark: [tokens.night, tokens.wine, tokens.ember] as const,
  cta: [tokens.coral, tokens.ember] as const,
  ctaSoft: [tokens.peach, tokens.coral] as const,
  bubbleOut: [tokens.coral, tokens.ember] as const,
  headerDark: ['rgba(26,10,8,0.55)', 'transparent'] as const,
  headerLight: ['rgba(255,241,230,0.7)', 'transparent'] as const,
} as const;

export const Colors = {
  light: {
    text: tokens.ink,
    textMuted: tokens.muted,
    background: tokens.blush,
    surface: tokens.glassLight,
    surfaceSolid: '#FFF8F3',
    tint: tokens.ember,
    accent: tokens.ember,
    accentSoft: 'rgba(189, 64, 63, 0.14)',
    tabIconDefault: '#B89A8C',
    tabIconSelected: tokens.deep,
    bubbleIncoming: 'rgba(255,255,255,0.88)',
    bubbleOutgoing: tokens.coral,
    bubbleAi: 'rgba(255, 236, 224, 0.92)',
    bubbleSystem: 'transparent',
    border: tokens.line,
    unread: tokens.ember,
    online: tokens.success,
    danger: tokens.danger,
    onAccent: '#FFFFFF',
    headerGlass: 'rgba(255, 248, 243, 0.82)',
  },
  dark: {
    text: '#FFF0E8',
    textMuted: '#D4A99A',
    background: tokens.night,
    surface: tokens.glassDark,
    surfaceSolid: '#2A1612',
    tint: tokens.peach,
    accent: tokens.peach,
    accentSoft: 'rgba(254, 180, 123, 0.18)',
    tabIconDefault: '#8A7064',
    tabIconSelected: tokens.peach,
    bubbleIncoming: 'rgba(58, 36, 32, 0.9)',
    bubbleOutgoing: tokens.ember,
    bubbleAi: 'rgba(90, 40, 34, 0.88)',
    bubbleSystem: 'transparent',
    border: 'rgba(254, 180, 123, 0.22)',
    unread: tokens.peach,
    online: tokens.success,
    danger: '#EF9A9A',
    onAccent: '#1A0A08',
    headerGlass: 'rgba(26, 10, 8, 0.78)',
  },
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
  headerGlass: string;
};

export default Colors;
