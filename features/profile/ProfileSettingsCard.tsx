/**
 * Settings: own photo, about, last-seen privacy. Same card shown on /u/<self>.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { profileHref } from '@/adapters/postLogin';
import { chatPersistenceUserId } from '@/adapters/identity';
import { readImageFileAsDataUrl } from '@/adapters/avatarImage';
import { clampProfileBio, PROFILE_BIO_MAX } from '@/domain';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { GlassPanel } from '@/features/chat/chatUi';
import { PersonAvatar } from '@/features/chat/avatars';
import { HiddenImageFileInput } from '@/features/chat/Composer';
import { useOwnProfileQuery } from '@/features/query/useChatQueries';
import { queryKeys } from '@/features/query/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import type { ThemeColors } from '@/constants/Colors';

export function ProfileSettingsCard({ colors }: { colors: ThemeColors }) {
  const { user } = useAuthState();
  const { profiles } = useServices();
  const queryClient = useQueryClient();
  const ownQuery = useOwnProfileQuery();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = ownQuery.data;
  const persistId = user ? chatPersistenceUserId(user) : '';
  const hydrated = useRef(false);

  useEffect(() => {
    if (!card) return;
    setBio(card.bio);
    hydrated.current = true;
  }, [card?.bio, card?.userId]);

  useEffect(() => {
    if (!hydrated.current || !persistId) return;
    const next = clampProfileBio(bio);
    if (next === (card?.bio ?? '')) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await profiles.upsertOwn(persistId, { bio: next });
          await queryClient.invalidateQueries({ queryKey: queryKeys.profileRoot });
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Could not save profile');
        }
      })();
    }, 450);
    return () => clearTimeout(timer);
  }, [bio, persistId, card?.bio, profiles, queryClient]);

  if (!user || !persistId) return null;

  const name = user.displayName ?? user.email ?? 'You';

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.profileRoot });

  const save = async (patch: {
    photoUrl?: string | null;
    bio?: string;
    presenceOptIn?: boolean;
  }) => {
    setBusy(true);
    setError(null);
    try {
      await profiles.upsertOwn(persistId, patch);
      await invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save profile');
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const url = await readImageFileAsDataUrl(file);
      await profiles.upsertOwn(persistId, { photoUrl: url });
      await invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not use that photo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassPanel colors={colors} style={styles.card}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>Profile</Text>
      <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
        Photo, about, and last seen — same as tapping your name in a chat.
      </Text>
      <View style={styles.hero}>
        <Pressable
          onPress={() => fileRef.current?.click()}
          disabled={Platform.OS !== 'web' || busy}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
        >
          <PersonAvatar size={88} name={name} photoUrl={card?.photoUrl} online showPresence />
        </Pressable>
        {Platform.OS === 'web' ? (
          <HiddenImageFileInput
            inputRef={fileRef}
            label="Change profile photo"
            onPick={(file) => void onPick(file)}
          />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }} numberOfLines={1}>
            {name}
          </Text>
          <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 13 }} numberOfLines={1}>
            {user.email}
          </Text>
          <Pressable
            onPress={() => {
              const next = clampProfileBio(bio);
              const open = () => router.push(profileHref(persistId));
              if (next !== (card?.bio ?? '')) {
                void save({ bio: next }).then(open);
                return;
              }
              open();
            }}
            accessibilityRole="button"
            accessibilityLabel="View my profile"
            style={{ marginTop: 8 }}
          >
            <Text style={{ color: colors.accent, fontWeight: '700' }}>View my profile</Text>
          </Pressable>
        </View>
      </View>

      {Platform.OS === 'web' ? (
        <View style={styles.photoRow}>
          <Pressable
            onPress={() => fileRef.current?.click()}
            disabled={busy}
            style={[styles.btn, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Set profile photo"
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {busy ? 'Saving…' : card?.photoUrl ? 'Change photo' : 'Set photo'}
            </Text>
          </Pressable>
          {card?.photoUrl ? (
            <Pressable
              onPress={() => void save({ photoUrl: null })}
              disabled={busy}
              style={[styles.btn, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Remove profile photo"
            >
              <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 12 }}>
          Profile photos can be set in the web app for now.
        </Text>
      )}

      <Text style={{ color: colors.text, fontWeight: '700', marginTop: 14 }}>About</Text>
      <TextInput
        value={bio}
        onChangeText={(next) => setBio(next.slice(0, PROFILE_BIO_MAX))}
        onBlur={() => {
          const next = clampProfileBio(bio);
          if (next !== (card?.bio ?? '')) void save({ bio: next });
        }}
        placeholder="Hey there! I am using SavignaLearn."
        placeholderTextColor={colors.textMuted}
        multiline
        style={[styles.bio, { color: colors.text, borderColor: colors.border }]}
        accessibilityLabel="About"
      />
      <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 12 }}>
        {bio.length}/{PROFILE_BIO_MAX}
      </Text>

      <View style={styles.row}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Last seen & online</Text>
          <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 13, lineHeight: 18 }}>
            Friends see “online” or last seen in the chat header and on your profile.
          </Text>
        </View>
        <Switch
          value={card?.presenceOptIn !== false}
          onValueChange={(next) => void save({ presenceOptIn: next })}
          disabled={busy}
        />
      </View>
      {error ? <Text style={{ color: colors.danger, marginTop: 8 }}>{error}</Text> : null}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, padding: 16 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 },
  photoRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  bio: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
});
