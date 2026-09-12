/**
 * Patient tab navigator: Home · Appointments · Records · Billing · Me.
 *
 * Fixed set -- no staff tabs exist here at all (no Patients list, no clinic
 * calendar, no availability management, no admin settings). They are absent
 * from the tree rather than hidden, so there is nothing to reveal.
 */

import { Tabs } from 'expo-router';
import { PatientTabBar } from '@/components/navigation/PatientTabBar';

export default function PatientTabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <PatientTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="appointments" options={{ title: 'Appointments' }} />
      <Tabs.Screen name="records" options={{ title: 'Records' }} />
      <Tabs.Screen name="billing" options={{ title: 'Billing' }} />
      <Tabs.Screen name="profile" options={{ title: 'Me' }} />
    </Tabs>
  );
}
