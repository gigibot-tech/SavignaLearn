import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '@/constants/Colors';
import { router } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { ensureLearningBotChat } from '@/adapters/chat';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { seedDemoFriendChats } from '@/adapters/memoryChat';
import { isMixedIdentityConfigured } from '@/adapters/mixedAuth';
import { isSupabaseConfigured } from '@/adapters/supabase';
import { setKeepLoggedIn, shouldKeepLoggedIn } from '@/adapters/authStorage';
import { chatHref } from '@/adapters/postLogin';
import { useAuthState, useServices } from './AppProviders';
import { AlphaNotice } from '@/features/alpha';
import { PresenceHeartbeat } from '@/features/profile/PresenceHeartbeat';
import { InboxSkeleton } from '@/features/inbox/InboxUi';
import { GradientCta, GradientScreen, SlayGif, useThemeColors } from './chatUi';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { auth, chat } = useServices();
  const { user, ready, markJustSignedIn } = useAuthState();
  const [bootstrapping, setBootstrapping] = useState(false);
  const { width } = useWindowDimensions();

  const enter = async (
    email: string,
    password: string,
    keepLoggedIn?: boolean,
    options?: { demoData?: boolean }
  ) => {
    if (keepLoggedIn !== undefined) setKeepLoggedIn(keepLoggedIn);
    setBootstrapping(true);
    try {
      const session = await auth.signInWithPassword(email, password);
      markJustSignedIn();
      const id = await ensureLearningBotChat(
        chat,
        chatPersistenceUserId(session),
        chatActorIds(session)
      );
      if (options?.demoData) await seedDemoFriendChats(chat, chatPersistenceUserId(session));
      router.replace(chatHref(id));
    } catch (error) {
      setBootstrapping(false);
      throw error;
    }
    setBootstrapping(false);
  };

  const authEdges = ['top', 'left', 'right', 'bottom'] as const;

  if (!ready) {
    return (
      <GradientScreen scheme={scheme} edges={[...authEdges]}>
        <InboxSkeleton colors={colors} width={width} />
      </GradientScreen>
    );
  }

  if (!user) {
    return (
      <GradientScreen scheme={scheme} edges={[...authEdges]}>
        <AlphaNotice colors={colors} />
        <AuthHero
          colors={colors}
          onSignIn={(email, password, keepLoggedIn) => enter(email, password, keepLoggedIn)}
          allowDemo={!isMixedIdentityConfigured()}
          onDemo={() => void enter('learner@savigna.local', 'demo', undefined, { demoData: !isSupabaseConfigured() })}
        />
      </GradientScreen>
    );
  }

  if (bootstrapping) {
    return (
      <GradientScreen scheme={scheme} edges={[...authEdges]}>
        <InboxSkeleton colors={colors} width={width} />
      </GradientScreen>
    );
  }

  return (
    <>
      <PresenceHeartbeat />
      {children}
    </>
  );
}

export function AuthHero({
  colors,
  onSignIn,
  allowDemo,
  onDemo,
}: {
  colors: ThemeColors;
  onSignIn: (email: string, password: string, keepLoggedIn: boolean) => Promise<void>;
  allowDemo?: boolean;
  onDemo?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepLoggedIn, setKeep] = useState(shouldKeepLoggedIn);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await onSignIn(email.trim(), password, keepLoggedIn);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.authRoot}>
      <SlayGif size={88} />
      <Text style={[styles.authBrand, { color: colors.text }]} accessibilityRole="header">
        SavignaLearn
      </Text>
      <Text style={[styles.authSub, { color: colors.textMuted }]}>
        Sign in with your fourSome or iDO account. Demo iDO: learner@savigna.local / demo.
      </Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        style={[styles.authInput, { color: colors.text, borderColor: colors.border }]}
        accessibilityLabel="Email"
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        style={[styles.authInput, { color: colors.text, borderColor: colors.border }]}
        accessibilityLabel="Password"
      />
      <Pressable
        onPress={() => setKeep((value) => !value)}
        style={styles.keepRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: keepLoggedIn }}
        accessibilityLabel="Keep me logged in"
      >
        <Ionicons
          name={keepLoggedIn ? 'checkbox' : 'square-outline'}
          size={22}
          color={keepLoggedIn ? colors.accent : colors.textMuted}
        />
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>Keep me logged in</Text>
      </Pressable>
      {error ? (
        <Text style={{ color: colors.danger, marginBottom: 12, textAlign: 'center', fontSize: 13 }}>
          {error}
        </Text>
      ) : null}
      <View style={{ width: '100%', maxWidth: 340 }}>
        <GradientCta
          label={busy ? 'Signing in…' : 'Sign in'}
          onPress={() => {
            if (busy || !email || !password) return;
            void submit();
          }}
        />
      </View>
      {allowDemo && onDemo ? (
        <Pressable onPress={onDemo} style={{ marginTop: 16 }} accessibilityRole="button">
          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Continue as demo learner</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  authRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  authBrand: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  authSub: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 28,
    maxWidth: 340,
  },
  authInput: {
    width: '100%',
    maxWidth: 340,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 16,
  },
  keepRow: {
    width: '100%',
    maxWidth: 340,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    marginTop: 4,
  },
});
