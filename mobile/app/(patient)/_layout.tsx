/**
 * The patient application shell.
 *
 * Two redirects guard it:
 *   * no session            -> public welcome
 *   * a STAFF session       -> the staff app
 *
 * The second matters: a receptionist who somehow deep-links into /(patient)
 * would otherwise see a patient shell built around `current_patient()`, which
 * for a staff user is null -- every screen would show a permission error. Send
 * them where they belong instead.
 *
 * As everywhere in this app, routing is usability. The backend independently
 * refuses patient endpoints to staff sessions and vice versa.
 */

import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/stores/auth';
import { colors } from '@/theme';

export default function PatientLayout() {
  const { initialising, user, kind, needsRegistration } = useAuth();

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

  const isPatient = kind === 'patient' || user.persona === 'patient';
  if (!isPatient) return <Redirect href="/(app)/(tabs)" />;

  // A verified phone with no Patient record cannot use any of these screens --
  // every endpoint behind them resolves the patient from the session.
  if (needsRegistration) return <Redirect href="/(patient-auth)/register" />;

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
