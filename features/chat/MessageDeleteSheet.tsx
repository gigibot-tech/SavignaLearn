import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/Colors';

export function MessageDeleteSheet({
  visible,
  colors,
  canDeleteForEveryone,
  onDeleteForMe,
  onDeleteForEveryone,
  onClose,
}: {
  visible: boolean;
  colors: ThemeColors;
  canDeleteForEveryone: boolean;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close delete menu">
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
          onPress={(event) => event.stopPropagation?.()}
        >
          <Text style={[styles.title, { color: colors.text }]}>Delete message</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Hide this bubble on your account, or remove it for both people in the chat.
          </Text>
          <Pressable
            onPress={onDeleteForMe}
            accessibilityRole="button"
            accessibilityLabel="Delete for me"
            style={styles.option}
          >
            <Text style={[styles.optionLabel, { color: colors.text }]}>Delete for me</Text>
          </Pressable>
          {canDeleteForEveryone ? (
            <Pressable
              onPress={onDeleteForEveryone}
              accessibilityRole="button"
              accessibilityLabel="Delete for everyone"
              style={styles.option}
            >
              <Text style={[styles.optionLabel, { color: colors.danger }]}>Delete for everyone</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.cancel}>
            <Text style={{ color: colors.textMuted, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 10, 8, 0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    paddingHorizontal: 16,
    marginBottom: 8,
    lineHeight: 18,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
});
