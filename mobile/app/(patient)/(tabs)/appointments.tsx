/**
 * The patient's own appointments, in three tabs.
 *
 * `scope` selects the tab -- it does NOT select a patient. The endpoint has no
 * patient parameter, so there is nothing here that could address anyone else's
 * calendar.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Plus } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { FilterPillRow } from '@/components/ui/FilterPill';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import * as patientApi from '@/api/patient';
import type { AppointmentScope } from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/date';
import { colors, spacing } from '@/theme';

const SCOPES: Array<{ value: AppointmentScope; label: string }> = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function PatientAppointmentsScreen() {
  const [scope, setScope] = useState<AppointmentScope>('upcoming');

  const query = useQuery({
    queryKey: queryKeys.patientAppointments(scope),
    queryFn: () => patientApi.listAppointments(scope),
  });

  const items = query.data?.items ?? [];

  return (
    <Screen
      withTabBar
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      <ScreenHeader
        title="Appointments"
        subtitle="Your visits with the clinic"
        right={
          <Pressable
            onPress={() => router.push('/(patient)/appointment/new')}
            accessibilityRole="button"
            accessibilityLabel="Book appointment"
            hitSlop={10}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.green,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Plus size={20} color={colors.white} strokeWidth={2} />
          </Pressable>
        }
      />

      <View style={{ marginTop: spacing.md }}>
        <FilterPillRow options={SCOPES} value={scope} onChange={setScope} />
      </View>

      <View style={{ marginTop: spacing.lg }}>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <SkeletonList count={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={26} color={colors.green} strokeWidth={1.6} />}
            title={
              scope === 'upcoming'
                ? 'No upcoming appointments'
                : scope === 'past'
                  ? 'No past visits yet'
                  : 'No cancelled appointments'
            }
            message={
              scope === 'upcoming'
                ? 'Book a visit when you need one.'
                : 'They will appear here once you have some.'
            }
            action={
              scope === 'upcoming'
                ? {
                    label: 'Book appointment',
                    onPress: () => router.push('/(patient)/appointment/new'),
                  }
                : undefined
            }
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {items.map((appointment) => (
              <Pressable
                key={appointment.name}
                onPress={() =>
                  router.push(`/(patient)/appointment/${appointment.name}`)
                }
                accessibilityRole="button"
                accessibilityLabel={`Appointment with ${
                  appointment.practitioner_name ?? appointment.practitioner
                } on ${formatDate(appointment.appointment_date)}`}
              >
                <Card>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                    }}
                  >
                    <Avatar
                      name={appointment.practitioner_name ?? appointment.practitioner}
                      size={44}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1}>
                        {appointment.practitioner_name ?? appointment.practitioner}
                      </Text>
                      <Text variant="caption" muted numberOfLines={1}>
                        {appointment.department ?? 'General'}
                      </Text>
                      <Text variant="caption" style={{ marginTop: 2 }}>
                        {scope === 'upcoming'
                          ? relativeDayLabel(appointment.appointment_date)
                          : formatDate(appointment.appointment_date)}{' '}
                        · {formatTime(appointment.appointment_time)}
                      </Text>
                    </View>
                    <StatusPill status={appointment.status} kind="appointment" />
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {items.length > 0 && scope === 'upcoming' ? (
        <Button
          label="Book another appointment"
          variant="secondary"
          onPress={() => router.push('/(patient)/appointment/new')}
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </Screen>
  );
}
