import FontAwesome from '@expo/vector-icons/FontAwesome';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { ensureLearningBotChat } from '@/adapters/chat';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { chatHref, needsPostLoginBotRedirect } from '@/adapters/postLogin';
import { iconFontFamilyNames, iconFontsForWeb, waitForWebIconFonts } from '@/adapters/webFonts';
import { useColorScheme } from '@/components/useColorScheme';
import { AppProviders, useAuthState, useServices } from '@/features/chat/AppProviders';
import { AuthGate } from '@/features/chat/AuthGate';
import { NotificationsProvider } from '@/features/notifications/NotificationProvider';
import { QueryProvider } from '@/features/query/QueryProvider';
import { AppShell } from '@/features/shell/AppShell';
import { useAppearance } from '@/features/shell/AppearanceProvider';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...iconFontsForWeb(FontAwesome.font),
    ...iconFontsForWeb(Ionicons.font),
  });
  const [iconsReady, setIconsReady] = useState(Platform.OS !== 'web');

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (!fontsLoaded) return;
    let cancelled = false;
    void waitForWebIconFonts(iconFontFamilyNames([FontAwesome.font, Ionicons.font])).then(() => {
      if (!cancelled) setIconsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fontsLoaded]);

  useEffect(() => {
    if (fontsLoaded && iconsReady) SplashScreen.hideAsync();
  }, [fontsLoaded, iconsReady]);

  if (!fontsLoaded || !iconsReady) return null;

  return (
    <AppProviders>
      <QueryProvider>
        <NotificationsProvider>
          <AuthGate>
            <AppShell>
              <RootLayoutNav />
            </AppShell>
          </AuthGate>
        </NotificationsProvider>
      </QueryProvider>
    </AppProviders>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { pack } = useAppearance();
  const palette = colorScheme === 'dark' ? pack.dark : pack.light;
  const { chat } = useServices();
  const { user, justSignedIn, clearJustSignedIn } = useAuthState();
  const pathname = usePathname();

  useEffect(() => {
    if (!justSignedIn || !user) return;
    let cancelled = false;
    void (async () => {
      const id = await ensureLearningBotChat(chat, chatPersistenceUserId(user), chatActorIds(user));
      if (cancelled) return;
      if (needsPostLoginBotRedirect(pathname, id)) {
        router.replace(chatHref(id));
      }
      clearJustSignedIn();
    })();
    return () => {
      cancelled = true;
    };
  }, [justSignedIn, user, chat, pathname, clearJustSignedIn]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: 'transparent' },
        headerTintColor: palette.accent,
        contentStyle: { backgroundColor: 'transparent' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
