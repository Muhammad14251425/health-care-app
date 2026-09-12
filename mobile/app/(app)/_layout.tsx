/**
 * Authenticated stack. Anyone who lands here without a session is redirected to
 * the public welcome screen -- including when a 401 clears the session mid-use.
 */

import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/stores/auth';
import { colors } from '@/theme';

export default function AppLayout() {
  const { initialising, user } = useAuth();

  if (initialising) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  if (!user) return <Redirect href="/(public)/welcome" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
