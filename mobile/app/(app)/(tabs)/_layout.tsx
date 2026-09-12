/**
 * Tab navigator.
 *
 * The fourth tab depends on what the user can actually do. Probing the live
 * backend showed a pure Physician has no `Sales Invoice` permission and gets
 * 403 from every invoice endpoint, so doctors see **Activity** there instead of
 * Billing -- offering Billing would only lead to a permission error.
 *
 * Hiding a tab is a usability decision, never a security one: the backend
 * enforces authorization on every request regardless of what is on screen.
 */

import { Tabs } from 'expo-router';
import { TabBar } from '@/components/navigation/TabBar';
import { usePermissions } from '@/stores/auth';

export default function TabsLayout() {
  const { canViewBilling, canViewPatients } = usePermissions();

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="appointments" options={{ title: 'Appointments' }} />
      <Tabs.Screen
        name="patients"
        options={{ title: 'Patients', href: canViewPatients ? undefined : null }}
      />
      <Tabs.Screen
        name="billing"
        options={{ title: 'Billing', href: canViewBilling ? undefined : null }}
      />
      <Tabs.Screen
        name="activity"
        // Activity takes Billing's place for users without billing access.
        options={{ title: 'Activity', href: canViewBilling ? null : undefined }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Me' }} />
    </Tabs>
  );
}
