/**
 * Patient Home.
 *
 * One request (`patient.home`) fills the whole screen -- greeting, hero, the
 * three quick cards and recent visits. Bundled server-side because a patient on
 * mobile data should not pay four round trips to see one screen.
 *
 * Every number here comes from the backend, scoped to the signed-in patient.
 * Nothing is computed from a cached list or invented client-side.
 */

import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FileText, Plus } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { HeroCard } from '@/components/ui/HeroCard';
import { StatCard } from '@/components/ui/StatCard';
import { StatusPill } from '@/components/ui/StatusPill';
import { SectionHeader } from '@/components/ui/ScreenHeader';
import { ErrorState, SkeletonHero, SkeletonList } from '@/components/ui/States';
import { LogoMark } from '@/components/ui/Logo';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/stores/auth';
import { firstName, initials } from '@/utils/permissions';
import { formatCurrencyCompact } from '@/utils/currency';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/date';
import { colors, spacing, typography } from '@/theme';

export default function PatientHomeScreen() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: queryKeys.patientHome,
    queryFn: patientApi.home,
  });

  const home = query.data;
  const counts = home?.counts;
  const next = home?.next_appointment ?? null;

  const greeting = useMemo(
    () => firstName(home?.patient_name ?? user?.full_name ?? undefined),
    [home?.patient_name, user?.full_name],
  );

  const heroActions = [
    { label: 'Book', onPress: () => router.push('/(patient)/appointment/new'), primary: true },
    { label: 'Appointments', onPress: () => router.push('/(patient)/(tabs)/appointments') },
    { label: 'Records', onPress: () => router.push('/(patient)/(tabs)/records') },
  ];

  return (
    <Screen
      withTabBar
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <LogoMark />
            <Text variant="micro" muted>
              meadow clinic
            </Text>
          </View>
          <Text style={[typography.heading1, { marginTop: spacing.sm }]}>
            Hello, {greeting}
          </Text>
          <Text variant="caption" muted style={{ marginTop: 2 }}>
            Your health information, all in one place.
          </Text>
        </View>
        <Avatar name={home?.patient_name ?? user?.full_name ?? '?'} />
      </View>

      {query.isError ? (
        <View style={{ marginTop: spacing.xl }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </View>
      ) : query.isLoading ? (
        <View style={{ marginTop: spacing.xl }}>
          <SkeletonHero />
        </View>
      ) : (
        <>
          {/* Hero: the next appointment, or an invitation to book one. */}
          <View style={{ marginTop: spacing.xl }}>
            {next ? (
              <HeroCard
                label="Next appointment"
                value={formatDate(next.appointment_date)}
                caption={`${formatTime(next.appointment_time)} · ${
                  next.practitioner_name ?? next.practitioner
                }`}
                actions={heroActions}
              />
            ) : (
              <HeroCard
                label="No upcoming appointment"
                value="All clear"
                caption="Book a visit when you need one."
                actions={heroActions}
              />
            )}
          </View>

          {/* Quick cards -- all three values are server-computed. */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <StatCard
              label="Upcoming"
              value={counts?.upcoming ?? 0}
              backgroundColor={colors.peach}
              onPress={() => router.push('/(patient)/(tabs)/appointments')}
            />
            <StatCard
              label="Visits"
              value={counts?.visits ?? 0}
              backgroundColor={colors.mint}
              onPress={() => router.push('/(patient)/(tabs)/records')}
            />
            <StatCard
              label="Amount due"
              value={formatCurrencyCompact(counts?.outstanding ?? 0)}
              backgroundColor={colors.paleYellow}
              onPress={() => router.push('/(patient)/(tabs)/billing')}
            />
          </View>

          {/* The next appointment in full. */}
          {next ? (
            <>
              <SectionHeader
                title="Next appointment"
                style={{ marginTop: spacing.xl }}
              />
              <Pressable
                onPress={() => router.push(`/(patient)/appointment/${next.name}`)}
                accessibilityRole="button"
                accessibilityLabel={`Appointment with ${
                  next.practitioner_name ?? next.practitioner
                }`}
              >
                <Card>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                    }}
                  >
                    <Avatar name={next.practitioner_name ?? next.practitioner} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1}>
                        {next.practitioner_name ?? next.practitioner}
                      </Text>
                      <Text variant="caption" muted numberOfLines={1}>
                        {next.department ?? 'General'}
                      </Text>
                      <Text variant="caption" style={{ marginTop: 2 }}>
                        {relativeDayLabel(next.appointment_date)} ·{' '}
                        {formatTime(next.appointment_time)}
                      </Text>
                    </View>
                    <StatusPill status={next.status} kind="appointment" />
                  </View>
                </Card>
              </Pressable>
            </>
          ) : (
            <View style={{ marginTop: spacing.xl }}>
              <Card>
                <Text variant="body">No upcoming appointment</Text>
                <Text variant="caption" muted style={{ marginTop: spacing.xs }}>
                  Book a visit when you need one.
                </Text>
                <Button
                  label="Book appointment"
                  onPress={() => router.push('/(patient)/appointment/new')}
                  icon={<Plus size={16} color={colors.white} strokeWidth={2} />}
                  style={{ marginTop: spacing.md }}
                />
              </Card>
            </View>
          )}

          {/* Recent visits */}
          <SectionHeader
            title="Recent visits"
            actionLabel={(home?.recent_visits?.length ?? 0) > 0 ? 'See all' : undefined}
            onAction={
              (home?.recent_visits?.length ?? 0) > 0
                ? () => router.push('/(patient)/(tabs)/records')
                : undefined
            }
            style={{ marginTop: spacing.xl }}
          />

          {query.isLoading ? (
            <SkeletonList count={2} />
          ) : (home?.recent_visits?.length ?? 0) === 0 ? (
            <Card>
              <Text variant="caption" muted>
                Your past visits will appear here.
              </Text>
            </Card>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {home!.recent_visits.map((visit) => (
                <Card key={visit.name}>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
                  >
                    <Avatar
                      name={visit.practitioner_name ?? visit.practitioner}
                      size={40}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1}>
                        {visit.practitioner_name ?? visit.practitioner}
                      </Text>
                      <Text variant="caption" muted numberOfLines={1}>
                        {formatDate(visit.appointment_date)} ·{' '}
                        {visit.department ?? 'General'}
                      </Text>
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )}

          {/* Shortcuts */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <Pressable
              onPress={() => router.push('/(patient)/(tabs)/appointments')}
              style={{ flex: 1 }}
              accessibilityRole="button"
            >
              <Card style={{ alignItems: 'center', gap: spacing.xs }}>
                <CalendarDays size={20} color={colors.green} strokeWidth={1.7} />
                <Text variant="micro">Appointments</Text>
              </Card>
            </Pressable>
            <Pressable
              onPress={() => router.push('/(patient)/(tabs)/records')}
              style={{ flex: 1 }}
              accessibilityRole="button"
            >
              <Card style={{ alignItems: 'center', gap: spacing.xs }}>
                <FileText size={20} color={colors.green} strokeWidth={1.7} />
                <Text variant="micro">Records</Text>
              </Card>
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}
