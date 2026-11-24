/**
 * Shared chat chrome: theme hook, gradient screen, glass panel, CTA button, the thread header
 * and loading skeletons. Message bubbles, the composer and the settings UI live beside this file
 * (MessageBubble, Composer, ChatSettings) so each can be read on its own.
 * LONG-TERM: WordTapPort only — never call VocabularyCardPort from presentation code.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type ThemeColors } from '@/constants/Colors';
import { useAppearance } from '@/features/shell/AppearanceProvider';
import { PersonAvatar } from './avatars';

export function useThemeColors(scheme: 'light' | 'dark' | null | undefined): ThemeColors {
  const { pack } = useAppearance();
  return scheme === 'dark' ? pack.dark : pack.light;
}

/**
 * Full-bleed screen wash (Gigolingo GradientBackground + active appearance stops).
 */
export function GradientBackground({
  children,
  scheme,
  style,
}: {
  children: React.ReactNode;
  scheme?: 'light' | 'dark' | null;
  style?: StyleProp<ViewStyle>;
}) {
  const { pack } = useAppearance();
  const colors = scheme === 'dark' ? pack.gradients.dark : pack.gradients.light;
  return (
    <LinearGradient
      colors={[...colors]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.15, y: 1 }}
      style={[styles.gradient, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** Safe area + gradient — default chat screen chrome. */
export function GradientScreen({
  children,
  scheme,
  edges = ['top', 'left', 'right'],
}: {
  children: React.ReactNode;
  scheme?: 'light' | 'dark' | null;
  edges?: Array<'top' | 'right' | 'bottom' | 'left'>;
}) {
  return (
    <GradientBackground scheme={scheme}>
      <SafeAreaView style={styles.flex} edges={edges}>
        {children}
      </SafeAreaView>
    </GradientBackground>
  );
}

export function GlassPanel({
  children,
  colors,
  style,
}: {
  children: React.ReactNode;
  colors: ThemeColors;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.glass,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function GradientCta({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { pack } = useAppearance();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={styles.ctaWrap}
    >
      <LinearGradient
        colors={[...pack.gradients.cta]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const SLAY_GIF = require('../../assets/slay.gif');

export function SlayGif({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={SLAY_GIF}
      accessibilityLabel="Slay gif"
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

export function ThreadChromeHeader({
  title,
  subtitle,
  onBack,
  onOpenSettings,
  inlineSettings,
  colors,
  scheme,
  isBot,
  photoUrl,
  leadingIcon = 'chevron-back',
  leadingLabel = 'Back',
  onOpenProfile,
}: {
  title: string;
  subtitle?: string;
  /** Omit on desktop, where the chat list is always beside the thread. */
  onBack?: () => void;
  onOpenSettings?: () => void;
  inlineSettings?: React.ReactNode;
  colors: ThemeColors;
  scheme?: 'light' | 'dark' | null;
  isBot?: boolean;
  photoUrl?: string | null;
  leadingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  leadingLabel?: string;
  onOpenProfile?: () => void;
}) {
  const { pack } = useAppearance();
  const wash = scheme === 'dark' ? pack.gradients.headerDark : pack.gradients.headerLight;
  return (
    <LinearGradient colors={[...wash]} style={styles.threadHeaderWash}>
      <View
        style={[
          styles.threadHeader,
          {
            backgroundColor: colors.headerGlass,
            borderBottomColor: inlineSettings ? 'transparent' : colors.border,
          },
        ]}
      >
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={leadingLabel}
            hitSlop={12}
            style={styles.backHit}
          >
            <Ionicons name={leadingIcon} size={24} color={colors.accent} />
          </Pressable>
        ) : (
          <View style={styles.headerEdge} />
        )}
        <Pressable
          onPress={onOpenProfile}
          disabled={!onOpenProfile}
          accessibilityRole={onOpenProfile ? 'button' : undefined}
          accessibilityLabel={onOpenProfile ? `Open ${title} profile` : undefined}
          style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}
        >
          <PersonAvatar
            size={32}
            name={title}
            photoUrl={photoUrl}
            isBot={isBot}
            style={styles.headerAvatar}
          />
          <View style={styles.headerTitles}>
            <Text style={[styles.threadTitle, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {onOpenSettings ? (
          <Pressable
            onPress={onOpenSettings}
            accessibilityLabel="Chat languages and AI"
            hitSlop={12}
            style={styles.backHit}
          >
            <Ionicons name="options-outline" size={22} color={colors.accent} />
          </Pressable>
        ) : inlineSettings ? null : (
          <View style={{ width: 40 }} />
        )}
      </View>
      {inlineSettings}
    </LinearGradient>
  );
}


const THREAD_SKELETON: Array<{ mine: boolean; widths: Array<`${number}%`> }> = [
  { mine: false, widths: ['72%', '54%'] },
  { mine: true, widths: ['48%', '64%', '32%'] },
  { mine: false, widths: ['66%'] },
  { mine: true, widths: ['58%', '40%'] },
  { mine: false, widths: ['70%', '52%', '28%'] },
];

/** Placeholder message lines while cloud hydrate / listMessages is in flight. */
export function ThreadMessageSkeleton({ colors }: { colors: ThemeColors }) {
  const opacity = useSkeletonPulse();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Loading messages"
      accessibilityState={{ busy: true }}
      style={styles.skeletonThread}
    >
      {THREAD_SKELETON.map((row, index) => (
        <View
          key={index}
          style={[styles.skeletonBubbleWrap, { alignItems: row.mine ? 'flex-end' : 'flex-start' }]}
        >
          <View
            style={[
              styles.skeletonBubble,
              {
                backgroundColor: row.mine ? colors.accentSoft : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {row.widths.map((width, line) => (
              <SkeletonBar
                key={line}
                colors={colors}
                opacity={opacity}
                width={width}
                height={line === 0 ? 13 : 11}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function useSkeletonPulse() {
  const opacity = useRef(new Animated.Value(0.42)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.88, duration: 720, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 720, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

export function SkeletonBar({
  colors,
  opacity,
  width,
  height,
  color,
}: {
  colors: ThemeColors;
  opacity: Animated.Value;
  width: `${number}%`;
  height: number;
  color?: string;
}) {
  return (
    <Animated.View
      style={{
        height,
        width,
        borderRadius: 6,
        backgroundColor: color ?? colors.textMuted,
        opacity,
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gradient: { flex: 1, width: '100%', height: '100%' },
  glass: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  ctaWrap: { borderRadius: 999, overflow: 'hidden' },
  cta: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  threadHeaderWash: { width: '100%' },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backHit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerEdge: { width: 8 },
  headerTitles: { flex: 1, minWidth: 0 },
  threadTitle: { fontWeight: '700', fontSize: 16 },
  skeletonThread: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 14,
  },
  skeletonBubbleWrap: {
    width: '100%',
  },
  skeletonBubble: {
    maxWidth: '78%',
    minWidth: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});
