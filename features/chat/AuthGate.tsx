import React, { useState } from 'react';
import { router } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { ensureLearningBotChat } from '@/adapters/chat';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { isMixedIdentityConfigured } from '@/adapters/mixedAuth';
import { setKeepLoggedIn } from '@/adapters/authStorage';
import { learningBotHref } from '@/adapters/postLogin';
import { useAuthState, useServices } from './AppProviders';
import { AlphaNotice } from '@/features/alpha';
import { AuthHero, GradientScreen, InboxSkeleton, useThemeColors } from './chatUi';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const colors = useThemeColors(scheme);
  const { auth, chat } = useServices();
  const { user, ready, markJustSignedIn } = useAuthState();
  const [bootstrapping, setBootstrapping] = useState(false);

  const enter = async (email: string, password: string, keepLoggedIn?: boolean) => {
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
      router.replace(learningBotHref(id));
    } catch (error) {
      setBootstrapping(false);
      throw error;
    }
    setBootstrapping(false);
  };

  if (!ready) {
    return (
      <GradientScreen scheme={scheme}>
        <InboxSkeleton colors={colors} />
      </GradientScreen>
    );
  }

  if (!user) {
    return (
      <GradientScreen scheme={scheme}>
        <AlphaNotice colors={colors} />
        <AuthHero
          colors={colors}
          onSignIn={(email, password, keepLoggedIn) => enter(email, password, keepLoggedIn)}
          allowDemo={!isMixedIdentityConfigured()}
          onDemo={() => void enter('learner@savigna.local', 'demo')}
        />
      </GradientScreen>
    );
  }

  if (bootstrapping) {
    return (
      <GradientScreen scheme={scheme}>
        <InboxSkeleton colors={colors} />
      </GradientScreen>
    );
  }

  return children;
}
