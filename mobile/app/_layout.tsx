/**
 * Root layout: fonts, providers, and the public/authenticated split.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from '@expo-google-fonts/poppins';

import '../global.css';

import { createQueryClient } from '@/api/queryClient';
import { validateEnv } from '@/config/env';
import { AuthProvider } from '@/stores/auth';
import { ToastProvider } from '@/components/ui/Toast';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();

// Surfaces a bad EXPO_PUBLIC_API_URL at startup rather than as a confusing
// "Network request failed" on the first screen.
validateEnv();

export default function RootLayout() {
  const [queryClient] = useState(() => createQueryClient());

  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });

  useEffect(() => {
    // Hide the splash once fonts settle. If they failed, continue anyway with
    // system fonts rather than holding the user on a splash screen forever.
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <View style={{ flex: 1, backgroundColor: colors.bg }}>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.bg },
                    animation: 'slide_from_right',
                  }}
                >
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(public)" />
                  <Stack.Screen name="(app)" />
                  <Stack.Screen name="(patient-auth)" />
                  <Stack.Screen name="(patient)" />
                </Stack>
              </View>
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
