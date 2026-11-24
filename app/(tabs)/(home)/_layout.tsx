import { Stack } from 'expo-router';
import { useDesktopShell } from '@/features/shell/AppShell';

export default function HomeStackLayout() {
  // Desktop swaps chats in place beside the list; sliding screens would fight the persistent pane.
  const desktop = useDesktopShell();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
        animation: desktop ? 'none' : 'slide_from_right',
      }}
    />
  );
}
