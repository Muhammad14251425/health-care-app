/**
 * Entry gate.
 *
 * Once the stored session has been checked, route by ACCOUNT TYPE:
 *
 *   no session            -> public welcome (guest booking + patient login)
 *   patient, unregistered -> finish registration
 *   patient               -> patient app
 *   staff                 -> staff app
 *
 * Routing is a usability decision, not a security control: the backend refuses
 * staff endpoints to a patient session regardless of which navigator is on
 * screen (verified -- see PATIENT_SECURITY_TESTS.md).
 */

import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/stores/auth';
import { colors } from '@/theme';

export default function Index() {
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

  if (kind === 'patient' || user.persona === 'patient') {
    return needsRegistration ? (
      <Redirect href="/(patient-auth)/register" />
    ) : (
      <Redirect href="/(patient)/(tabs)" />
    );
  }

  return <Redirect href="/(app)/(tabs)" />;
}
