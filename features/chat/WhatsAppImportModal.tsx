/**
 * Paste a WhatsApp copy, map the two names before ":" to you vs them, import as a DM.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { usernameFromUser } from '@/adapters/friends';
import { chatPersistenceUserId } from '@/adapters/identity';
import { learningBotHref } from '@/adapters/postLogin';
import { importWhatsAppConversation } from '@/adapters/whatsappImport';
import {
  guessPartner,
  guessSelfSpeaker,
  parseWhatsAppTranscript,
  type WhatsAppParseResult,
} from '@/domain/whatsappImport';
import type { FriendRow } from '@/domain/friends';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import { GradientCta, useThemeColors } from '@/features/chat/chatUi';
import { useAppShell } from '@/features/shell/AppShell';
import { useColorScheme } from '@/components/useColorScheme';
import type { ThemeColors } from '@/constants/Colors';

const LOCAL_PARTNER = '__whatsapp_local__';

export function WhatsAppImportControl({
  colors,
  label = 'Import WhatsApp',
}: {
  colors: ThemeColors;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Import WhatsApp conversation"
        style={[styles.trigger, { borderColor: colors.border, backgroundColor: colors.accentSoft }]}
      >
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
      </Pressable>
      <WhatsAppImportModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function WhatsAppImportModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { chat, friends, friendsTick, bumpFriends } = useServices();
  const { user } = useAuthState();
  const { collapseSidebar } = useAppShell();
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState<WhatsAppParseResult | null>(null);
  const [selfSpeaker, setSelfSpeaker] = useState<string | null>(null);
  const [otherSpeaker, setOtherSpeaker] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string>(LOCAL_PARTNER);
  const [friendsRows, setFriendsRows] = useState<FriendRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || !user) return;
    void friends.reconcile(user.id).then((rows) => {
      setFriendsRows(rows.filter((row) => row.kind === 'accepted' && !row.inconsistent));
    });
  }, [visible, user, friends, friendsTick]);

  const selfHints = useMemo(
    () =>
      user
        ? {
            email: user.email,
            displayName: user.displayName,
            username: usernameFromUser(user),
          }
        : {},
    [user]
  );

  const accepted = friendsRows;

  const applyParse = () => {
    setError(null);
    const next = parseWhatsAppTranscript(paste);
    if (next.speakers.length < 2) {
      setError('Need two names before “:” — paste a WhatsApp copy like [16:05, 3.9.2026] Andrea: …');
      setParsed(null);
      return;
    }
    const names = next.speakers.map((item) => item.name);
    const selfGuess = guessSelfSpeaker(names, selfHints);
    const self = selfGuess.speaker ?? names[0];
    const other = names.find((name) => name !== self) ?? names[1];
    const partnerGuess = guessPartner(other, accepted);
    setParsed(next);
    setSelfSpeaker(self);
    setOtherSpeaker(other);
    setPartnerId(partnerGuess.unsure || !partnerGuess.partnerId ? LOCAL_PARTNER : partnerGuess.partnerId);
  };

  useEffect(() => {
    if (!parsed || !otherSpeaker) return;
    const partnerGuess = guessPartner(otherSpeaker, accepted);
    if (!partnerGuess.unsure && partnerGuess.partnerId) {
      setPartnerId(partnerGuess.partnerId);
    }
  }, [parsed, otherSpeaker, accepted]);

  const pickSelf = (name: string) => {
    setSelfSpeaker(name);
    if (otherSpeaker === name) {
      const nextOther = parsed?.speakers.map((item) => item.name).find((item) => item !== name) ?? null;
      setOtherSpeaker(nextOther);
    }
  };

  const pickOther = (name: string) => {
    setOtherSpeaker(name);
    if (selfSpeaker === name) {
      const nextSelf = parsed?.speakers.map((item) => item.name).find((item) => item !== name) ?? null;
      setSelfSpeaker(nextSelf);
    }
  };

  const importChat = async () => {
    if (!user || !parsed || !selfSpeaker || !otherSpeaker || busy) return;
    setBusy(true);
    setError(null);
    try {
      const friend = accepted.find((row) => row.userId === partnerId);
      const result = await importWhatsAppConversation({
        chat,
        viewer: { id: chatPersistenceUserId(user), nativeLang: 'en', learningLang: 'de' },
        selfSpeaker,
        otherSpeaker,
        partner: friend
          ? {
              id: friend.userId,
              displayName: friend.displayName,
              username: friend.username,
              email: friend.email,
            }
          : { id: '', displayName: otherSpeaker },
        parsed,
      });
      if (result.importedCount === 0) {
        setError('Those messages are already in this chat.');
        setBusy(false);
        return;
      }
      bumpFriends();
      collapseSidebar();
      onClose();
      setPaste('');
      setParsed(null);
      router.push(learningBotHref(result.conversationId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const selfGuess = parsed ? guessSelfSpeaker(parsed.speakers.map((item) => item.name), selfHints) : null;
  const otherGuess = parsed && otherSpeaker ? guessPartner(otherSpeaker, accepted) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close WhatsApp import">
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={[styles.title, { color: colors.text }]}>Import WhatsApp</Text>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 12 }}>
              Paste a copied chat. Then pick who is you and who is them (the names before “:”).
            </Text>
            <TextInput
              value={paste}
              onChangeText={setPaste}
              multiline
              placeholder={`[16:05, 3.9.2026] Andrea: hello\n[16:06, 3.9.2026] Savi(g)na 🔥: hi`}
              placeholderTextColor={colors.textMuted}
              style={[styles.paste, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              accessibilityLabel="WhatsApp copy paste"
            />
            <View style={{ marginTop: 12 }}>
              <GradientCta label="Read names" onPress={applyParse} />
            </View>

            {parsed ? (
              <View style={{ marginTop: 16, gap: 12 }}>
                <Text style={[styles.section, { color: colors.textMuted }]}>I am</Text>
                {selfGuess?.unsure ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    Couldn’t match your email/username — pick yourself.
                  </Text>
                ) : null}
                <View style={styles.chipRow}>
                  {parsed.speakers.map((item) => (
                    <Pressable
                      key={`self-${item.name}`}
                      onPress={() => pickSelf(item.name)}
                      style={[
                        styles.chip,
                        { borderColor: colors.border },
                        selfSpeaker === item.name && { backgroundColor: colors.accentSoft },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selfSpeaker === item.name }}
                      accessibilityLabel={`I am ${item.name}`}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{item.name}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.section, { color: colors.textMuted }]}>They are</Text>
                {otherGuess?.unsure ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    Unsure which friend this is — pick one, or import as a new local chat.
                  </Text>
                ) : null}
                <View style={styles.chipRow}>
                  {parsed.speakers.map((item) => (
                    <Pressable
                      key={`other-${item.name}`}
                      onPress={() => pickOther(item.name)}
                      style={[
                        styles.chip,
                        { borderColor: colors.border },
                        otherSpeaker === item.name && { backgroundColor: colors.accentSoft },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: otherSpeaker === item.name }}
                      accessibilityLabel={`They are ${item.name}`}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{item.name}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.section, { color: colors.textMuted }]}>Save as</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setPartnerId(LOCAL_PARTNER)}
                    style={[
                      styles.chip,
                      { borderColor: colors.border },
                      partnerId === LOCAL_PARTNER && { backgroundColor: colors.accentSoft },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="New local WhatsApp chat"
                  >
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                      New chat · {otherSpeaker ?? 'them'}
                    </Text>
                  </Pressable>
                  {accepted.map((row) => (
                    <Pressable
                      key={row.userId}
                      onPress={() => setPartnerId(row.userId)}
                      style={[
                        styles.chip,
                        { borderColor: colors.border },
                        partnerId === row.userId && { backgroundColor: colors.accentSoft },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Friend ${row.displayName}`}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                        {row.displayName}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <GradientCta
                  label={busy ? 'Importing…' : `Import ${parsed.messages.length} messages`}
                  onPress={() => void importChat()}
                />
              </View>
            ) : null}

            {error ? (
              <Text style={{ color: colors.danger, marginTop: 12, fontWeight: '700' }}>{error}</Text>
            ) : null}

            <Pressable onPress={onClose} style={{ marginTop: 16 }} accessibilityRole="button" accessibilityLabel="Cancel">
              <Text style={{ color: colors.accent, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 10, 8, 0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
    maxHeight: '92%',
  },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 6 },
  paste: {
    minHeight: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  section: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
