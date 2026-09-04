import React from 'react';
import { StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { badgeLabel } from '@/domain/unread';
import { useAppShell } from '@/features/shell/AppShell';
import { useAppearance } from '@/features/shell/AppearanceProvider';

export const unstable_settings = {
  initialRouteName: '(home)',
};

function TabBarIcon(props: { name: React.ComponentProps<typeof FontAwesome>['name']; color: string }) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { pack } = useAppearance();
  const colors = colorScheme === 'dark' ? pack.dark : pack.light;
  const { unread, incoming } = useAppShell();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tabIconSelected,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarHideOnKeyboard: false,
        tabBarStyle: {
          backgroundColor: colors.headerGlass,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="(home)"
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
