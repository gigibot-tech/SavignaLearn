/**
 * Friends: add by email, user id, or /friends?add= link; accept/decline; open a DM.
 * No meetups — same scope as the fourSome web sidebar minus events.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  FriendRequestFailed,
  friendInconsistencyMessage,
  friendRequestErrorMessage,
  type FriendRequestError,
  type FriendRow,
} from '@/domain/friends';
import { currentFriendShareUrl, findOrCreateDirectChat, usernameFromUser } from '@/adapters/friends';
import { learningBotHref } from '@/adapters/postLogin';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { GlassPanel, GradientCta, GradientScreen, useThemeColors } from '@/features/chat/chatUi';
import { useAppShell } from '@/features/shell/AppShell';

const ERROR_CODES: FriendRequestError[] = [
  'empty',
  'self',
  'not_found',
  'not_found_savigna',
  'not_found_ido',
  'malformed_link',
  'missing_email',
  'already_friends',
  'already_requested',
];

function errorFromCaught(caught: unknown): FriendRequestError {
  if (caught instanceof FriendRequestFailed) return caught.error;
  const message = caught instanceof Error ? caught.message : '';
  return ERROR_CODES.includes(message as FriendRequestError) ? (message as FriendRequestError) : 'not_found';
}

export function FriendsScreen() {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { desktop } = useAppShell();
  const { friends, chat, bumpFriends, friendsTick } = useServices();
  const { user } = useAuthState();
  const params = useLocalSearchParams<{ add?: string | string[] }>();
  const addParam = Array.isArray(params.add) ? params.add[0] : params.add;
  const [query, setQuery] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'link' | 'id' | null>(null);
  const [rows, setRows] = useState<FriendRow[]>([]);
  const consumedAdd = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setRows(await friends.reconcile(user.id));
  }, [friends, user]);

  useEffect(() => {
    void refresh();
  }, [refresh, friendsTick]);

  const add = async (raw?: string) => {
    if (!user) return;
    const identifier = (raw ?? query).trim();
    if (!identifier) {
      setModalError(friendRequestErrorMessage('empty'));
      return;
    }
    setBusy(true);
    try {
      await friends.request(user.id, identifier);
      setQuery('');
      bumpFriends();
      await refresh();
    } catch (caught) {
      setModalError(friendRequestErrorMessage(errorFromCaught(caught)));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!user || !addParam || consumedAdd.current === addParam) return;
    consumedAdd.current = addParam;
    setQuery(addParam);
    void add(addParam);
    // add is recreated each render; consume once per param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam, user]);

  const openChat = async (row: FriendRow) => {
    if (!user || row.inconsistent) return;
    const conv = await findOrCreateDirectChat(chat, { id: user.id }, {
      id: row.userId,
      username: row.username,
      displayName: row.displayName,
      email: row.email,
    });
    router.push(learningBotHref(conv.id));
  };

  const removeRow = async (row: FriendRow) => {
    if (!user) return;
    await friends.remove(user.id, row.friendshipId);
    bumpFriends();
    await refresh();
  };

  const copy = async (kind: 'link' | 'id') => {
    if (!user) return;
    const value = kind === 'link' ? currentFriendShareUrl(user.id) : user.id;
    await Clipboard.setStringAsync(value);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };

  const incoming = rows.filter((row) => row.kind === 'incoming');
  const outgoing = rows.filter((row) => row.kind === 'outgoing');
  const accepted = rows.filter((row) => row.kind === 'accepted');
  const username = user ? usernameFromUser(user) : '';

  return (
    <GradientScreen scheme={scheme}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Friends
        </Text>
        <Text style={{ color: colors.textMuted, paddingHorizontal: 16, marginBottom: 16 }}>
          Your username is @{username}. Add people by email, user id, or friend link — then chat. No
          meetups.
        </Text>

        <GlassPanel colors={colors} style={styles.card}>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>Add friend</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="Email, user id, or friend link"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={() => void add()}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            accessibilityLabel="Friend email, user id, or link"
          />
          <View style={{ marginTop: 12 }}>
            <GradientCta label={busy ? 'Adding…' : 'Add'} onPress={() => void add()} />
          </View>
          <View style={styles.copyRow}>
            <Pressable
              onPress={() => void copy('link')}
              style={[styles.copyBtn, { borderColor: colors.border, backgroundColor: colors.accentSoft }]}
              accessibilityRole="button"
              accessibilityLabel="Copy my friend link"
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                {copied === 'link' ? 'Copied link' : 'Copy my friend link'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void copy('id')}
              style={[styles.copyBtn, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Copy my user id"
            >
              <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>
                {copied === 'id' ? 'Copied id' : 'Copy my user id'}
              </Text>
            </Pressable>
          </View>
        </GlassPanel>

        {incoming.length > 0 ? (
          <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
            <Text style={[styles.section, { color: colors.textMuted }]}>Requests</Text>
            {incoming.map((row) => (
              <View key={row.friendshipId} style={[styles.rowCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{row.displayName}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    @{row.username}
                    {row.email ? ` · ${row.email}` : ''}
                  </Text>
                  {row.inconsistent ? (
                    <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                      Inconsistent · {friendInconsistencyMessage(row.inconsistency ?? 'not_found')}
                    </Text>
                  ) : null}
                </View>
                {row.inconsistent ? (
                  <Pressable
                    onPress={() => void removeRow(row)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${row.displayName}`}
                  >
                    <Text style={{ color: colors.danger, fontWeight: '700' }}>Delete</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      onPress={() =>
                        void friends.accept(user!.id, row.friendshipId).then(() => {
                          bumpFriends();
                          return refresh();
                        })
                      }
                      style={[styles.pill, { backgroundColor: colors.accentSoft }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Accept ${row.displayName}`}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700' }}>Accept</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void friends.decline(user!.id, row.friendshipId).then(() => {
                          bumpFriends();
                          return refresh();
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Decline ${row.displayName}`}
                    >
                      <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Decline</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ))}
          </View>
        ) : null}

        {outgoing.length > 0 ? (
          <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
            <Text style={[styles.section, { color: colors.textMuted }]}>Sent</Text>
            {outgoing.map((row) => (
              <View key={row.friendshipId} style={[styles.rowCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{row.displayName}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    Waiting · @{row.username}
                    {row.email ? ` · ${row.email}` : ''}
                  </Text>
                  {row.inconsistent ? (
                    <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                      Inconsistent · {friendInconsistencyMessage(row.inconsistency ?? 'not_found')}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => void removeRow(row)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.inconsistent ? 'Delete' : 'Cancel'} ${row.displayName}`}
                >
                  <Text style={{ color: row.inconsistent ? colors.danger : colors.textMuted, fontWeight: '700' }}>
                    {row.inconsistent ? 'Delete' : 'Cancel'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {!desktop ? (
          <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
            <Text style={[styles.section, { color: colors.textMuted }]}>Friends</Text>
            {accepted.length === 0 ? (
              <Text style={{ color: colors.textMuted, marginTop: 8 }}>No friends yet.</Text>
            ) : (
              accepted.map((row) => (
                <View
                  key={row.friendshipId}
                  style={[styles.rowCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Pressable
                    onPress={() => void openChat(row)}
                    disabled={row.inconsistent}
                    style={{ flex: 1 }}
                    accessibilityRole="button"
                    accessibilityLabel={row.inconsistent ? `${row.displayName} inconsistent` : `Chat with ${row.displayName}`}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{row.displayName}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      @{row.username}
                      {row.email ? ` · ${row.email}` : ''}
                    </Text>
                    {row.inconsistent ? (
                      <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                        Inconsistent · {friendInconsistencyMessage(row.inconsistency ?? 'not_found')}
                      </Text>
                    ) : null}
                  </Pressable>
                  {row.inconsistent ? (
                    <Pressable
                      onPress={() => void removeRow(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${row.displayName}`}
                    >
                      <Text style={{ color: colors.danger, fontWeight: '700' }}>Delete</Text>
                    </Pressable>
                  ) : (
                    <>
                      <Text style={{ color: colors.accent, fontWeight: '700' }}>Chat</Text>
                      <Pressable
                        onPress={() => void removeRow(row)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${row.displayName}`}
                      >
                        <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Remove</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              ))
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
            {accepted.some((row) => row.inconsistent) ? (
              <>
                <Text style={[styles.section, { color: colors.textMuted }]}>Needs attention</Text>
                {accepted
                  .filter((row) => row.inconsistent)
                  .map((row) => (
                    <View
                      key={row.friendshipId}
                      style={[styles.rowCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>{row.displayName}</Text>
                        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                          @{row.username}
                          {row.email ? ` · ${row.email}` : ''}
                        </Text>
                        <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                          Inconsistent · {friendInconsistencyMessage(row.inconsistency ?? 'not_found')}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => void removeRow(row)}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${row.displayName}`}
                      >
                        <Text style={{ color: colors.danger, fontWeight: '700' }}>Delete</Text>
                      </Pressable>
                    </View>
                  ))}
              </>
            ) : (
              <Text style={{ color: colors.textMuted }}>
                Your friends stay in the sidebar. Tap one to open a chat.
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={Boolean(modalError)} transparent animationType="fade" onRequestClose={() => setModalError(null)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => setModalError(null)}
          accessibilityLabel="Close error"
        >
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation?.()}
          >
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Couldn’t add friend</Text>
            <Text style={{ color: colors.textMuted, paddingHorizontal: 16, lineHeight: 20 }}>{modalError}</Text>
            <Pressable
              onPress={() => setModalError(null)}
              style={styles.sheetCancel}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Text style={{ color: colors.accent, fontWeight: '700' }}>OK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </GradientScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', paddingHorizontal: 16, paddingTop: 16, letterSpacing: -0.5 },
  card: { marginHorizontal: 16, padding: 16 },
  section: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  copyRow: { marginTop: 12, gap: 8 },
  copyBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
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
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sheetCancel: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
});
