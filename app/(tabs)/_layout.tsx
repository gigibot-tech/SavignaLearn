import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { badgeLabel } from '@/domain/unread';
import { DESKTOP_BREAKPOINT, useAppShell } from '@/features/shell/AppShell';
import { useAppearance } from '@/features/shell/AppearanceProvider';

function TabBarIcon(props: { name: React.ComponentProps<typeof FontAwesome>['name']; color: string }) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { pack } = useAppearance();
  const colors = colorScheme === 'dark' ? pack.dark : pack.light;
  const { width } = useWindowDimensions();
  const desktop = width >= DESKTOP_BREAKPOINT;
  const { unread, incoming } = useAppShell();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tabIconSelected,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarStyle: desktop
          ? { display: 'none' }
          : {
              backgroundColor: colors.headerGlass,
              borderTopColor: colors.border,
              borderTopWidth: StyleSheet.hairlineWidth,
            },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarBadge: badgeLabel(unread),
          tabBarIcon: ({ color }) => <TabBarIcon name="comments" color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarBadge: badgeLabel(incoming),
          tabBarIcon: ({ color }) => <TabBarIcon name="users" color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabBarIcon name="cog" color={String(color)} />,
        }}
      />
    </Tabs>
  );
}
