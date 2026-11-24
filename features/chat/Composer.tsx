/**
 * Message composer: text input, send, sticker tray and image attach.
 * Chat must not import features/media.
 */

import React, { useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type ThemeColors } from '@/constants/Colors';
import { useAppearance } from '@/features/shell/AppearanceProvider';
import type { MessageMediaKind } from '@/domain/chat';
import { DEFAULT_STICKER_PACK } from '@/adapters/stickers';
import { mediaImageSource } from './stickerAssets';
import { languageLabel } from './ChatSettings';

export function Composer({
  colors,
  onSend,
  onSendImage,
  replyPreview,
  onCancelReply,
  nativeLang,
  learningLang,
}: {
  colors: ThemeColors;
  onSend: (text: string) => void;
  onSendImage?: (media: OutgoingMedia) => void;
  replyPreview?: string;
  onCancelReply?: () => void;
  nativeLang: string;
  learningLang?: string;
}) {
  const { pack } = useAppearance();
  const [text, setText] = useState('');
  const [trayOpen, setTrayOpen] = useState(false);
  const draft = useRef('');
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const setDraft = (value: string) => {
    draft.current = value;
    setText(value);
  };

  const submit = () => {
    const fromDom = Platform.OS === 'web' ? (areaRef.current?.value ?? '') : '';
    const value = (fromDom || draft.current || text).trim();
    if (!value) return;
    draft.current = '';
    setText('');
    if (areaRef.current) areaRef.current.value = '';
    onSend(value);
  };

  const sendMedia = (media: OutgoingMedia) => {
    setTrayOpen(false);
    onSendImage?.(media);
  };

  const canSend = (draft.current.trim() || text.trim()).length > 0;
  const placeholder = learningLang
    ? `Message in ${languageLabel(nativeLang)} (learning ${languageLabel(learningLang)})…`
    : `Message in ${languageLabel(nativeLang)}…`;
  const sendControl = (
    <LinearGradient colors={[...pack.gradients.cta]} style={[styles.sendBtn, { pointerEvents: 'none' }]}>
      <Ionicons name="send" size={18} color="#fff" />
    </LinearGradient>
  );

  return (
    <View style={[styles.composerWrap, { backgroundColor: colors.headerGlass, borderTopColor: colors.border }]}>
      {replyPreview ? (
        <View style={[styles.replyPreview, { backgroundColor: colors.accentSoft }]}>
          <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
            {replyPreview}
          </Text>
          <Pressable onPress={onCancelReply} accessibilityLabel="Cancel reply" hitSlop={10}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      {trayOpen && onSendImage ? <StickerTray colors={colors} onPick={sendMedia} /> : null}
      <View style={styles.composerRow}>
        {onSendImage ? (
          <ComposerMediaButtons
            colors={colors}
            trayOpen={trayOpen}
            onToggleTray={() => setTrayOpen((open) => !open)}
            onPickImage={sendMedia}
          />
        ) : null}
        {Platform.OS === 'web' ? (
          <textarea
            ref={areaRef}
            id="savigna-message"
            aria-label="Message"
            placeholder={placeholder}
            rows={2}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            style={{
              flex: 1,
              width: '100%',
              minHeight: 44,
              maxHeight: 120,
              borderRadius: 18,
              padding: '10px 14px',
              fontSize: 16,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceSolid,
              color: colors.text,
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <TextInput
            value={text}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            multiline
            blurOnSubmit={false}
            onSubmitEditing={submit}
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.surfaceSolid,
              },
            ]}
            accessibilityLabel="Message"
          />
        )}
        {Platform.OS === 'web' ? (
          <button
            type="button"
            aria-label="Send"
            onClick={submit}
            style={{
              width: 44,
              height: 44,
              minWidth: 44,
              minHeight: 44,
              flexShrink: 0,
              border: 'none',
              borderRadius: 22,
              cursor: 'pointer',
              background: `linear-gradient(90deg, ${pack.tokens.coral}, ${pack.tokens.ember})`,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              padding: 0,
            }}
          >
            ➤
          </button>
        ) : (
          <Pressable
            onPress={submit}
            accessibilityRole="button"
            accessibilityLabel="Send"
            hitSlop={8}
            style={[styles.sendHit, !canSend && { opacity: 0.4 }]}
          >
            {sendControl}
          </Pressable>
        )}
      </View>
    </View>
  );
}


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
  composerWrap: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8, zIndex: 2 },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendHit: { borderRadius: 22, overflow: 'hidden', width: 44, height: 44 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
