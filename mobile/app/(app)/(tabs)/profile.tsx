/**
 * Profile / Me.
 *
 * Follows the reference's profile screen: centred avatar, name, email, a role
 * chip, three stats, then grouped settings. The stats differ per role, and each
 * is a real figure from today's data.
 */

import { useMemo } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  ChartNoAxesColumn,
  CircleHelp,
  LogOut,
  ShieldCheck,
  UserCog,
} from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { ProfileStat } from '@/components/ui/StatCard';
import { SettingsGroup, SettingsRow } from '@/components/ui/SettingsRow';
import { SectionHeader } from '@/components/ui/ScreenHeader';
import * as invoicesApi from '@/api/invoices';
import { queryKeys } from '@/api/queryClient';
import { useDashboard } from '@/hooks/useDashboard';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/components/ui/Toast';
import { personaLabel } from '@/utils/permissions';
import { formatCurrencyCompact } from '@/utils/currency';
import { colors, radius, spacing } from '@/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const toast = useToast();
  const { user, permissions, signOut } = useAuth();
  const dashboard = useDashboard();

  const invoices = useQuery({
    queryKey: queryKeys.invoices({ scope: 'profile' }),
    queryFn: () => invoicesApi.listInvoices({ limit: 200 }),
    enabled: permissions.canViewBilling,
  });

  const stats = useMemo(() => {
    const { counts } = dashboard;

    if (permissions.persona === 'practitioner') {
      return [
        { label: "Today's patients", value: counts.total },
        { label: 'Completed', value: counts.completed },
        { label: 'Upcoming', value: counts.upcoming },
      ];
    }

    if (permissions.persona === 'reception') {
      return [
        { label: 'Bookings today', value: counts.total },
        { label: 'Checked in', value: counts.waiting },
        { label: 'Pending', value: counts.upcoming },
      ];
    }

    // SUBMITTED invoices only. `list_invoices` returns drafts too (staff need to
    // see them), but a draft posts nothing to the general ledger, so its
    // outstanding_amount is not money anyone owes -- counting it made this stat
    // disagree with the Reports screen and with ERPNext's own receivables.
    const outstanding = (invoices.data?.items ?? [])
      .filter((invoice) => invoice.docstatus === 1)
      .reduce((sum, invoice) => sum + invoice.outstanding_amount, 0);
    return [
      { label: 'Appointments', value: counts.total },
      { label: 'Completed', value: counts.completed },
      {
        label: 'Outstanding',
        value: formatCurrencyCompact(outstanding, invoices.data?.items[0]?.currency),
      },
    ];
  }, [dashboard, invoices.data, permissions.persona]);

  const confirmSignOut = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await signOut();
            toast.show('Signed out');
            router.replace('/(public)/welcome');
          })();
        },
      },
    ]);
  };

  const notImplemented = (what: string) => () =>
    toast.show(`${what} is not available in this build.`);

  return (
    <Screen withTabBar onRefresh={() => void dashboard.refetch()} refreshing={dashboard.isRefetching}>
      <View style={{ alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.xl }}>
        <Avatar name={user?.full_name} size={72} />
        <Text variant="heading3" style={{ marginTop: spacing.md }}>
          {user?.full_name}
        </Text>
        <Text variant="caption" muted style={{ marginTop: 3 }}>
          {user?.user}
        </Text>
        <View
          style={{
            marginTop: spacing.md,
            backgroundColor: '#DDE7D8',
            borderRadius: radius.pill,
            paddingHorizontal: spacing.lg,
            paddingVertical: 6,
          }}
        >
          <Text variant="micro" color="#31523F">
            {personaLabel(permissions.persona)}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl }}>
        {stats.map((stat) => (
          <ProfileStat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </View>

      <SectionHeader title="Clinic" />
      <SettingsGroup>
        <SettingsRow
          icon={<ChartNoAxesColumn size={16} color="#566057" strokeWidth={1.8} />}
          label="Reports"
          value={permissions.canViewBilling ? 'Activity & revenue' : 'Activity'}
          onPress={() => router.push('/(app)/reports')}
          last
        />
      </SettingsGroup>

      <SectionHeader title="Account" />
      <SettingsGroup>
        <SettingsRow
          icon={<UserCog size={16} color="#566057" strokeWidth={1.8} />}
          label="Account details"
          value={user?.user}
        />
        <SettingsRow
          icon={<Bell size={16} color="#566057" strokeWidth={1.8} />}
          label="Notifications"
          onPress={notImplemented('Notification settings')}
        />
        <SettingsRow
          icon={<Building2 size={16} color="#566057" strokeWidth={1.8} />}
          label="Clinic information"
          onPress={notImplemented('Clinic settings')}
          last
        />
      </SettingsGroup>

      <SectionHeader title="Support" />
      <SettingsGroup>
        <SettingsRow
          icon={<ShieldCheck size={16} color="#566057" strokeWidth={1.8} />}
          label="Security"
          onPress={notImplemented('Security settings')}
        />
        <SettingsRow
          icon={<CircleHelp size={16} color="#566057" strokeWidth={1.8} />}
          label="Help & support"
          onPress={notImplemented('Help centre')}
          last
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          icon={<LogOut size={16} color={colors.danger} strokeWidth={1.8} />}
          label="Log out"
          onPress={confirmSignOut}
          destructive
          last
        />
      </SettingsGroup>
    </Screen>
  );
}
