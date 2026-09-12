/**
 * Home dashboard.
 *
 * One layout, three personas. The hero copy, actions and lower sections change
 * with the role -- a doctor sees their own patients and no billing; reception
 * sees the whole desk. Every figure is fetched, none are placeholders.
 */

import { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { CalendarPlus, CalendarRange, LogIn, Stethoscope, UserPlus, Users } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { HeroCard } from '@/components/ui/HeroCard';
import { Logo } from '@/components/ui/Logo';
import { StatCard, StatCardRow } from '@/components/ui/StatCard';
import { EmptyState, ErrorState, SkeletonHero, SkeletonList } from '@/components/ui/States';
import { AppointmentCard } from '@/components/clinic/AppointmentCard';
import { useDashboard } from '@/hooks/useDashboard';
import { useAuth } from '@/stores/auth';
import { firstName } from '@/utils/permissions';
import { formatCurrencyCompact } from '@/utils/currency';
import { colors, spacing } from '@/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { user, permissions } = useAuth();
  const dashboard = useDashboard();

  const isDoctor = permissions.persona === 'practitioner';
  const isReception = permissions.persona === 'reception';

  const greeting = useMemo(() => {
    const { counts } = dashboard;
    if (isDoctor) {
      return counts.total === 1
        ? 'You have 1 appointment today.'
        : `You have ${counts.total} appointments today.`;
    }
    if (isReception) return "Here's the front desk for today.";
    return "Here's what's happening at the clinic today.";
  }, [dashboard, isDoctor, isReception]);

  const heroLabel = isDoctor
    ? "Today's patients"
    : isReception
      ? 'Appointments today'
      : "Today's appointments";

  const heroActions = isDoctor
    ? [
        {
          label: 'Start visit',
          primary: true,
          onPress: () => router.push('/(app)/(tabs)/appointments'),
          icon: <Stethoscope size={14} color="#2E2A1D" strokeWidth={2} />,
        },
        {
          label: 'Schedule',
          onPress: () => router.push('/(app)/calendar'),
          icon: <CalendarRange size={14} color={colors.white} strokeWidth={2} />,
        },
        {
          label: 'Patients',
          onPress: () => router.push('/(app)/(tabs)/patients'),
          icon: <Users size={14} color={colors.white} strokeWidth={2} />,
        },
      ]
    : isReception
      ? [
          {
            label: 'Book',
            primary: true,
            onPress: () => router.push('/(app)/appointment/new'),
            icon: <CalendarPlus size={14} color="#2E2A1D" strokeWidth={2} />,
          },
          {
            label: 'Check in',
            onPress: () => router.push('/(app)/(tabs)/appointments'),
            icon: <LogIn size={14} color={colors.white} strokeWidth={2} />,
          },
          {
            label: 'Patients',
            onPress: () => router.push('/(app)/(tabs)/patients'),
            icon: <Users size={14} color={colors.white} strokeWidth={2} />,
          },
        ]
      : [
          {
            label: 'New',
            primary: true,
            onPress: () => router.push('/(app)/appointment/new'),
            icon: <CalendarPlus size={14} color="#2E2A1D" strokeWidth={2} />,
          },
          {
            label: 'Patients',
            onPress: () => router.push('/(app)/(tabs)/patients'),
            icon: <Users size={14} color={colors.white} strokeWidth={2} />,
          },
          {
            label: 'Calendar',
            onPress: () => router.push('/(app)/calendar'),
            icon: <CalendarRange size={14} color={colors.white} strokeWidth={2} />,
          },
        ];

  const { counts, billing } = dashboard;
  const upcoming = dashboard.appointments
    .filter((appointment) => appointment.status !== 'Cancelled')
    .slice(0, 4);

  return (
    <Screen withTabBar onRefresh={() => void dashboard.refetch()} refreshing={dashboard.isRefetching}>
      <ScreenHeader
        eyebrow={<Logo />}
        title={`Hello ${firstName(user?.full_name)}`}
        subtitle={greeting}
        right={
          <Avatar
            name={user?.full_name}
            size={44}
            style={{ marginTop: 4 }}
          />
        }
      />

      {dashboard.isPending ? (
        <SkeletonHero />
      ) : dashboard.isError ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <HeroCard
          label={heroLabel}
          value={String(counts.total)}
          caption={`${counts.waiting} waiting · ${counts.completed} completed · ${counts.upcoming} upcoming`}
          actions={heroActions}
        />
      )}

      {!dashboard.isPending && !dashboard.isError ? (
        <>
          <View style={{ marginTop: spacing.xxl }}>
            <SectionHeader
              title="Today's schedule"
              actionLabel="See all"
              onAction={() => router.push('/(app)/(tabs)/appointments')}
            />
            {upcoming.length > 0 ? (
              upcoming.map((appointment) => (
                <AppointmentCard
                  key={appointment.name}
                  appointment={appointment}
                  compact
                  hidePractitioner={isDoctor}
                  onPress={() => router.push(`/(app)/appointment/${appointment.name}`)}
                />
              ))
            ) : (
              <EmptyState
                title="No appointments today"
                message="Your schedule is clear."
                action={
                  permissions.canCreateAppointment
                    ? {
                        label: 'Book an appointment',
                        onPress: () => router.push('/(app)/appointment/new'),
                      }
                    : undefined
                }
              />
            )}
          </View>

          <View style={{ marginTop: spacing.xl }}>
            <SectionHeader title="At a glance" />
            <StatCardRow>
              <StatCard
                label="Waiting"
                value={counts.waiting}
                backgroundColor={colors.peach}
              />
              <StatCard
                label="Completed"
                value={counts.completed}
                backgroundColor={colors.mint}
              />
              <StatCard
                label="Upcoming"
                value={counts.upcoming}
                backgroundColor={colors.paleYellow}
              />
            </StatCardRow>
          </View>

          {/* Billing is omitted entirely for roles the backend refuses it to. */}
          {dashboard.billingAvailable ? (
            <View style={{ marginTop: spacing.xl }}>
              <SectionHeader
                title="Billing"
                actionLabel="See all"
                onAction={() => router.push('/(app)/(tabs)/billing')}
              />
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="micro" muted>
                      Collected today
                    </Text>
                    <Text variant="heading3" style={{ marginTop: 4 }}>
                      {formatCurrencyCompact(billing.collectedToday, billing.currency)}
                    </Text>
                  </View>
                  <View style={{ width: 1, backgroundColor: colors.line, marginHorizontal: spacing.lg }} />
                  <View style={{ flex: 1 }}>
                    <Text variant="micro" muted>
                      Outstanding
                    </Text>
                    <Text variant="heading3" style={{ marginTop: 4 }}>
                      {formatCurrencyCompact(billing.outstanding, billing.currency)}
                    </Text>
                  </View>
                  <View style={{ width: 1, backgroundColor: colors.line, marginHorizontal: spacing.lg }} />
                  <View style={{ flex: 0.7 }}>
                    <Text variant="micro" muted>
                      Unpaid
                    </Text>
                    <Text variant="heading3" style={{ marginTop: 4 }}>
                      {billing.unpaidCount}
                    </Text>
                  </View>
                </View>
              </Card>
            </View>
          ) : null}
        </>
      ) : null}

      {dashboard.isPending ? <SkeletonList count={3} /> : null}
    </Screen>
  );
}
