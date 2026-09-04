/**
 * Shared person / bot avatars. Chat UI imports from here so chatUi stays the
 * presentation barrel without a cycle.
 */

import React from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { LEARNING_BOT_DISPLAY_NAME } from '@/domain';
import { useColorScheme } from '@/components/useColorScheme';
import { useAppearance } from '@/features/shell/AppearanceProvider';
import { mediaImageSource } from './stickerAssets';

const SAVIGNAS_BOI_AVATAR = require('../../assets/savignas-boi.png');

export function SavignasBoiAvatar({
  size,
  style,
}: {
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Image
        source={SAVIGNAS_BOI_AVATAR}
        accessibilityLabel={LEARNING_BOT_DISPLAY_NAME}
        style={{ width: size, height: size }}
        resizeMode="cover"
      />
    </View>
  );
}

export function PersonAvatar({
  size,
  name,
  photoUrl,
  isBot,
  online,
  showPresence,
  style,
}: {
  size: number;
  name: string;
  photoUrl?: string | null;
  isBot?: boolean;
  online?: boolean;
  showPresence?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const scheme = useColorScheme();
  const { pack } = useAppearance();
  const colors = scheme === 'dark' ? pack.dark : pack.light;
  const letter = (name || '?').slice(0, 1).toUpperCase();
  const dot = size >= 40 ? 12 : 10;

  return (
    <View style={[{ width: size, height: size }, style]}>
      {isBot ? (
        <SavignasBoiAvatar size={size} />
      ) : photoUrl ? (
        <Image
          source={mediaImageSource(photoUrl)}
          accessibilityLabel={name}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accentSoft }}
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={[...pack.gradients.ctaSoft]}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <Text style={{ color: colors.onSoft, fontWeight: '800', fontSize: Math.round(size * 0.42) }}>
            {letter}
          </Text>
        </LinearGradient>
      )}
      {showPresence ? (
        <View
          style={[
            styles.presence,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              opacity: online ? 1 : 0.4,
              backgroundColor: online ? colors.online : 'transparent',
              borderColor: online ? colors.online : colors.textMuted,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  presence: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
