import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, Switch, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getFourSomeEmail, isFourSomeAuthConfigured, signInFourSome, signOutFourSome } from '@/adapters/fourSomeAuth';
import { getIdoEmail, isIdoAiConfigured, signInIdo, signOutIdo } from '@/adapters/idoAi';
import { currentFriendShareUrl } from '@/adapters/friends';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthState, useServices } from '@/features/chat/AppProviders';
import {
  AiConnectionPanel,
  GlassPanel,
  GradientCta,
  GradientScreen,
  useThemeColors,
} from '@/features/chat/chatUi';
import { AppearanceThemePicker } from '@/features/shell/AppearanceProvider';
import { useNotifications } from '@/features/notifications/NotificationProvider';

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { auth, aiBackend, setAiBackend, fourSomeUserId, health, healthChecking, refreshHealth } =
    useServices();
  const { user } = useAuthState();
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const { supported, enabled, permission, requestEnable, disable } = useNotifications();
  const [notifBusy, setNotifBusy] = useState(false);
  const [idoEmail, setIdoEmail] = useState<string | null>(user?.idoUserId ? user.email ?? null : null);
  const [fourSomeEmail, setFourSomeEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState<'foursome' | 'ido' | null>(null);
  const [copiedFriend, setCopiedFriend] = useState<'link' | 'id' | null>(null);

  useEffect(() => {
    void getIdoEmail().then(setIdoEmail);
    void getFourSomeEmail().then(setFourSomeEmail);
  }, [aiBackend, user?.fourSomeUserId, user?.idoUserId]);

  const onLink = async (provider: 'foursome' | 'ido') => {
    setLinkError(null);
    setLinkBusy(provider);
    try {
      if (provider === 'foursome') {
        const signed = await signInFourSome(email.trim(), password);
        setFourSomeEmail(signed.email ?? email.trim());
      } else {
        const signed = await signInIdo(email.trim(), password);
        setIdoEmail(signed);
      }
      setPassword('');
      refreshHealth();
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Sign-in failed');
    } finally {
      setLinkBusy(null);
    }
  };

  return (
    <GradientScreen scheme={scheme}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          SavignaLearn
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>App settings</Text>
        <GlassPanel colors={colors} style={styles.card}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {user?.email ?? 'Not signed in'}
          </Text>
          <Text style={{ color: colors.textMuted, marginTop: 6 }}>
            fourSome {fourSomeEmail ? 'connected' : 'off'} · iDO {idoEmail ? 'connected' : 'off'}
          </Text>
          <Text style={{ color: colors.textMuted, marginTop: 6 }}>Density · {density}</Text>
        </GlassPanel>

        <GlassPanel colors={colors} style={[styles.card, { marginTop: 12 }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Appearance</Text>
          <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
            Rosa is the default. Orange keeps the previous ember look. Your choice is saved on this
            device.
          </Text>
          <AppearanceThemePicker colors={colors} />
        </GlassPanel>

        {user ? (
          <GlassPanel colors={colors} style={[styles.card, { marginTop: 12 }]}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Friend link</Text>
            <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
              Share a link like /friends?add= so someone can send you a request.
            </Text>
            <Pressable
              onPress={() =>
                void Clipboard.setStringAsync(currentFriendShareUrl(user.id)).then(() => {
                  setCopiedFriend('link');
                  setTimeout(() => setCopiedFriend(null), 1600);
                })
              }
              style={[styles.btn, { marginTop: 10, backgroundColor: colors.accentSoft, borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Copy my friend link"
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {copiedFriend === 'link' ? 'Copied link' : 'Copy my friend link'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                void Clipboard.setStringAsync(user.id).then(() => {
                  setCopiedFriend('id');
                  setTimeout(() => setCopiedFriend(null), 1600);
                })
              }
              style={[styles.btn, { marginTop: 10, borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Copy my user id"
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {copiedFriend === 'id' ? 'Copied id' : 'Copy my user id'}
              </Text>
            </Pressable>
          </GlassPanel>
        ) : null}

        <View style={{ paddingHorizontal: 16, paddingTop: 8, maxWidth: 560 }}>
          <AiConnectionPanel
            health={health}
            checking={healthChecking}
            onRetry={refreshHealth}
            colors={colors}
            aiBackend={aiBackend}
            onAiBackendChange={setAiBackend}
          />
        </View>

        <GlassPanel colors={colors} style={[styles.card, { marginTop: 12 }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Notifications</Text>
          <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
            {Platform.OS === 'web'
              ? 'Browser notifications (service worker). Requires keeping this tab open so JS can receive updates.'
              : 'Uses native notifications for local alerts (send/app-triggered).'}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Enabled</Text>
            <Switch
              value={enabled}
              onValueChange={(next) => {
                void (async () => {
                  if (notifBusy) return;
                  setNotifBusy(true);
                  try {
                    if (next) {
                      const ok = await requestEnable();
                      if (!ok) await disable();
                    } else {
                      await disable();
                    }
                  } finally {
                    setNotifBusy(false);
                  }
                })();
              }}
              disabled={!supported || notifBusy}
            />
          </View>

          <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 12 }}>
            Status: {supported ? permission : 'Not supported'} {supported ? (enabled ? '· on' : '· off') : ''}
          </Text>
        </GlassPanel>

        {isFourSomeAuthConfigured() ? (
          <GlassPanel colors={colors} style={[styles.card, { marginTop: 12 }]}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>fourSome account</Text>
            <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
              Sign in with the same account as the fourSome app. That UUID is what GiGi’s WebSocket
              expects — no paste field.
            </Text>
            {fourSomeEmail ? (
              <>
                <Text style={{ color: colors.text, marginTop: 10 }}>{fourSomeEmail}</Text>
                {fourSomeUserId ? (
                  <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 12 }}>
                    User id: {fourSomeUserId}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() =>
                    void signOutFourSome().then(() => {
                      setFourSomeEmail(null);
                      refreshHealth();
                    })
                  }
                  style={[styles.btn, { marginTop: 10, backgroundColor: colors.accentSoft, borderColor: colors.border }]}
                  accessibilityRole="button"
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Sign out of fourSome</Text>
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="fourSome email"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="Password"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                />
                {linkError && linkBusy === null ? (
                  <Text style={{ color: colors.danger, marginTop: 6 }}>{linkError}</Text>
                ) : null}
                <Pressable
                  onPress={() => void onLink('foursome')}
                  disabled={linkBusy !== null || !email || !password}
                  style={[styles.btn, { marginTop: 10, backgroundColor: colors.accentSoft, borderColor: colors.border }]}
                  accessibilityRole="button"
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>
                    {linkBusy === 'foursome' ? 'Signing in…' : 'Sign in to fourSome'}
                  </Text>
                </Pressable>
              </>
            )}
          </GlassPanel>
        ) : null}

        {isIdoAiConfigured() ? (
          <GlassPanel colors={colors} style={[styles.card, { marginTop: 12 }]}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>iDO account</Text>
            <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
              iDO AI uses the ido-core `ai-assist` function. Link an iDO account if the home sign-in
              only matched fourSome.
            </Text>
            {idoEmail ? (
              <>
                <Text style={{ color: colors.text, marginTop: 10 }}>{idoEmail}</Text>
                <Pressable
                  onPress={() =>
                    void signOutIdo().then(() => {
                      setIdoEmail(null);
                      refreshHealth();
                    })
                  }
                  style={[styles.btn, { marginTop: 10, backgroundColor: colors.accentSoft, borderColor: colors.border }]}
                  accessibilityRole="button"
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Sign out of iDO</Text>
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="iDO email"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="Password"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                />
                {linkError ? (
                  <Text style={{ color: colors.danger ?? '#c45c4a', marginTop: 6 }}>{linkError}</Text>
                ) : null}
                <Pressable
                  onPress={() => void onLink('ido')}
                  disabled={linkBusy !== null || !email || !password}
                  style={[styles.btn, { marginTop: 10, backgroundColor: colors.accentSoft, borderColor: colors.border }]}
                  accessibilityRole="button"
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>
                    {linkBusy === 'ido' ? 'Signing in…' : 'Sign in for iDO AI'}
                  </Text>
                </Pressable>
              </>
            )}
          </GlassPanel>
        ) : null}

        <View style={styles.row}>
          <Pressable
            onPress={() => setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'))}
            style={[styles.btn, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>Toggle density</Text>
          </Pressable>
          <GradientCta
            label="Sign out"
            onPress={() => {
              router.replace('/');
              void auth.signOut();
            }}
          />
        </View>
        <Text style={{ color: colors.textMuted, padding: 16, lineHeight: 20 }}>
          Home sign-in tries fourSome and iDO with the same email. fourSome AI needs a fourSome
          session; iDO AI needs an iDO session. Chat history stays in this app.
        </Text>
      </ScrollView>
    </GradientScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', paddingHorizontal: 16, paddingTop: 16, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, paddingHorizontal: 16, marginBottom: 16 },
  card: { marginHorizontal: 16, padding: 16 },
  row: { padding: 16, gap: 12 },
  btn: {
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
});
