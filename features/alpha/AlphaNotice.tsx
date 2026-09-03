import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { tokens, type ThemeColors } from '@/constants/Colors';
import { ALPHA_NOTICE_A11Y, ALPHA_NOTICE_BODY, ALPHA_NOTICE_LABEL } from './alphaCopy';

/**
 * Reusable alpha warning for login and chats home.
 * Copy lives in `alphaCopy.ts` so every surface stays in sync.
 */
export function AlphaNotice({
  colors,
  compact = false,
  style,
}: {
  colors: ThemeColors;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={ALPHA_NOTICE_A11Y}
      style={[
        styles.wrap,
        compact ? styles.compact : styles.roomy,
        {
          backgroundColor: colors.accentSoft,
          borderColor: colors.accent,
        },
        style,
      ]}
    >
      <Ionicons
        name="warning"
        size={compact ? 18 : 22}
        color={tokens.ember}
        accessibilityElementsHidden
      />
      <View style={styles.textCol}>
        <Text style={[styles.label, { color: tokens.ember }]}>{ALPHA_NOTICE_LABEL}</Text>
        <Text style={[styles.body, compact ? styles.bodyCompact : null, { color: colors.text }]}>
          {ALPHA_NOTICE_BODY}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  roomy: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  compact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  textCol: { flex: 1, minWidth: 0 },
  label: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  bodyCompact: {
    fontSize: 13,
    lineHeight: 18,
  },
});
