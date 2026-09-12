/**
 * Appointments list.
 *
 * Filters are applied client-side over the fetched window rather than as extra
 * round trips: the backend returns the day/range in one call, and switching a
 * pill should be instant.
 */

import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { FilterPillRow } from '@/components/ui/FilterPill';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { AppointmentCard } from '@/components/clinic/AppointmentCard';
import * as appointmentsApi from '@/api/appointments';
import { queryKeys } from '@/api/queryClient';
import { usePermissions } from '@/stores/auth';
import { addDays, toBackendDate, todayBackendDate } from '@/utils/date';
import { colors, radius, screenPadding, shadows, spacing, tabBarClearance } from '@/theme';
import type { Appointment } from '@/types/domain';

type Filter = 'today' | 'upcoming' | 'waiting' | 'completed' | 'all';

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

export default function AppointmentsScreen() {
  const router = useRouter();
  const permissions = usePermissions();
  const [filter, setFilter] = useState<Filter>('today');

  const today = todayBackendDate();
  // One window covers every filter: a fortnight back and forward.
  const from = toBackendDate(addDays(new Date(), -14));
  const to = toBackendDate(addDays(new Date(), 30));

  const query = useQuery({
    queryKey: queryKeys.appointments({ from, to }),
    queryFn: () =>
      appointmentsApi.listAppointments({ from_date: from, to_date: to, limit: 200 }),
  });

  const all = useMemo(() => query.data?.items ?? [], [query.data]);

  const visible = useMemo(() => {
    switch (filter) {
      case 'today':
        return all.filter((appointment) => appointment.appointment_date === today);
      case 'upcoming':
        return all.filter(
          (appointment) =>
            appointment.appointment_date >= today && appointment.status === 'Scheduled',
        );
      case 'waiting':
        return all.filter(
          (appointment) =>
            appointment.status === 'Checked In' || appointment.status === 'Open',
        );
      case 'completed':
        return all.filter((appointment) => appointment.status === 'Closed');
      case 'all':
      default:
        return all;
    }
  }, [all, filter, today]);

  const todayCount = all.filter((a) => a.appointment_date === today).length;
  const waitingCount = all.filter(
    (a) => a.status === 'Checked In' || a.status === 'Open',
  ).length;

  const renderItem = ({ item }: { item: Appointment }) => (
    <AppointmentCard
      appointment={item}
      onPress={() => router.push(`/(app)/appointment/${item.name}`)}
    />
  );

  return (
    <Screen scroll={false} withTabBar padded={false}>
      <View style={{ paddingHorizontal: screenPadding }}>
        <ScreenHeader
          title="Appointments"
          subtitle={`${todayCount} today · ${waitingCount} waiting`}
          right={
            permissions.canCreateAppointment ? (
              <Pressable
                onPress={() => router.push('/(app)/appointment/new')}
                accessibilityRole="button"
                accessibilityLabel="New appointment"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.pill,
                  backgroundColor: colors.green,
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...shadows.raised,
                }}
              >
                <Plus size={21} color={colors.gold} strokeWidth={2.4} />
              </Pressable>
            ) : undefined
          }
        />
      </View>

      <View style={{ paddingHorizontal: screenPadding, marginBottom: spacing.lg }}>
        <FilterPillRow options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      {query.isPending ? (
        <View style={{ paddingHorizontal: screenPadding }}>
          <SkeletonList count={6} />
        </View>
      ) : query.isError ? (
        <View style={{ paddingHorizontal: screenPadding }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.name}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: screenPadding,
            paddingBottom: tabBarClearance,
          }}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={
            <EmptyState
              title="No appointments"
              message={
                filter === 'today'
                  ? 'Your schedule is clear for today.'
                  : 'Nothing matches this filter.'
              }
              action={
                permissions.canCreateAppointment
                  ? {
                      label: 'Book an appointment',
                      onPress: () => router.push('/(app)/appointment/new'),
                    }
                  : undefined
              }
            />
          }
        />
      )}
    </Screen>
  );
}
