/**
 * Composer sticker tray + image pick. Chat must not import features/media.
 */

import React, { useRef } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_STICKER_PACK } from '@/adapters/stickers';
import type { MessageMediaKind } from '@/domain/chat';
import type { ThemeColors } from '@/constants/Colors';
import { mediaImageSource } from './stickerAssets';

export type OutgoingMedia = {
  url: string;
  mediaKind: MessageMediaKind;
  alt?: string;
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function HiddenImageFileInput({
  inputRef,
  label,
  onPick,
  accept = 'image/png,image/jpeg,image/gif,image/webp',
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  onPick: (file: File) => void;
  accept?: string;
}) {
  if (Platform.OS !== 'web') return null;
  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="file"
      accept={accept}
      aria-label={label}
      style={{ display: 'none' }}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) onPick(file);
      }}
    />
  );
}

export function ChatMediaImage({
  url,
  sticker,
  accessibilityLabel,
}: {
  url: string;
  sticker?: boolean;
  accessibilityLabel?: string;
}) {
  const size = sticker ? 136 : 240;
  return (
    <Image
      source={mediaImageSource(url)}
      accessibilityLabel={accessibilityLabel ?? (sticker ? 'Sticker' : 'Photo')}
      style={{
        width: size,
        height: size,
        borderRadius: sticker ? 18 : 12,
        backgroundColor: 'rgba(0,0,0,0.08)',
      }}
      resizeMode="contain"
    />
  );
}

export function StickerTray({
  colors,
  onPick,
}: {
  colors: ThemeColors;
  onPick: (media: OutgoingMedia) => void;
}) {
  return (
    <View style={styles.trayGrid} accessibilityLabel="Default stickers">
      {DEFAULT_STICKER_PACK.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onPick({ url: item.uri, mediaKind: 'sticker', alt: item.label })}
          accessibilityRole="button"
          accessibilityLabel={`Send sticker ${item.label}`}
          style={[styles.stickerHit, { borderColor: colors.border, backgroundColor: colors.surfaceSolid }]}
        >
          <Image
            source={mediaImageSource(item.uri)}
            accessibilityLabel={item.label}
            style={styles.stickerThumb}
            resizeMode="contain"
          />
          <Text style={[styles.stickerLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ComposerMediaButtons({
  colors,
  trayOpen,
  onToggleTray,
  onPickImage,
}: {
  colors: ThemeColors;
  trayOpen: boolean;
  onToggleTray: () => void;
  onPickImage: (media: OutgoingMedia) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const readPickedFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_IMAGE_BYTES) return;
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
    if (!url.startsWith('data:image/')) return;
    onPickImage({ url, mediaKind: 'image' });
  };

  return (
    <View style={styles.mediaBtns}>
      {Platform.OS === 'web' ? (
        <>
          <HiddenImageFileInput
            inputRef={fileRef}
            label="Attach photo"
            onPick={(file) => void readPickedFile(file)}
          />
          <Pressable
            onPress={() => fileRef.current?.click()}
            accessibilityRole="button"
            accessibilityLabel="Attach photo"
            hitSlop={8}
            style={styles.iconHit}
          >
            <Ionicons name="image-outline" size={22} color={colors.textMuted} />
          </Pressable>
        </>
      ) : null}
      <Pressable
        onPress={onToggleTray}
        accessibilityRole="button"
        accessibilityLabel={trayOpen ? 'Hide stickers' : 'Stickers'}
        accessibilityState={{ expanded: trayOpen }}
        hitSlop={8}
        style={styles.iconHit}
      >
        <Ionicons
          name={trayOpen ? 'happy' : 'happy-outline'}
          size={22}
          color={trayOpen ? colors.accent : colors.textMuted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  trayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  stickerHit: {
    width: 88,
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 8,
  },
  stickerThumb: { width: 64, height: 64 },
  stickerLabel: { fontSize: 11, fontWeight: '600' },
  mediaBtns: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingBottom: 4 },
  iconHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
