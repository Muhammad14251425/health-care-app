/**
 * Appointment calendar.
 *
 * Day view is the default and the primary one: a vertical time rail with
 * appointments positioned in their slots. Week view is a compact per-day
 * summary rather than a shrunken desktop grid -- seven columns of detail does
 * not fit a phone and reading it would be worse than useless.
 *
 * Tapping an appointment opens it; tapping an empty slot starts a booking at
 * that time.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FilterPillRow } from '@/components/ui/FilterPill';
import { DateStrip } from '@/components/booking/DateStrip';
import { PickerField } from '@/components/form/PickerField';
import { StatusPill } from '@/components/ui/StatusPill';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import * as appointmentsApi from '@/api/appointments';
import * as practitionersApi from '@/api/practitioners';
import { queryKeys } from '@/api/queryClient';
import { usePermissions } from '@/stores/auth';
import {
  addDays,
  dateStripLabels,
  formatMonthYear,
  formatTime,
  minutesSinceMidnight,
  toBackendDate,
} from '@/utils/date';
import { colors, radius, spacing } from '@/theme';
import type { Appointment, PublicDay } from '@/types/domain';

type ViewMode = 'day' | 'week';

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
];

/** Rail runs 08:00-19:00; one row per half hour. */
const START_HOUR = 8;
const END_HOUR = 19;
const SLOT_MINUTES = 30;
const ROW_HEIGHT = 56;

function buildDays(anchor: Date, count: number): PublicDay[] {
  return Array.from({ length: count }, (_, offset) => {
    const date = addDays(anchor, offset);
    const { weekday, day } = dateStripLabels(date);
    return {
      date: toBackendDate(date),
      weekday,
      day_label: weekday,
      day_number: day,
      available: true,
    };
  });
}

export default function CalendarScreen() {
  const router = useRouter();
  const permissions = usePermissions();

  const [mode, setMode] = useState<ViewMode>('day');
  const [date, setDate] = useState(toBackendDate(new Date()));
  const [practitioner, setPractitioner] = useState<string | null>(null);

  const days = useMemo(() => buildDays(new Date(), 14), []);
  const weekStart = date;
  const weekEnd = toBackendDate(addDays(new Date(date.replace(/-/g, '/')), 6));

  const practitionersQuery = useQuery({
    queryKey: queryKeys.practitioners(),
    queryFn: () => practitionersApi.listPractitioners(),
  });

  const query = useQuery({
    queryKey: queryKeys.appointments({
      calendar: mode,
      date,
      practitioner,
    }),
    queryFn: () =>
      appointmentsApi.listAppointments({
        practitioner: practitioner ?? undefined,
        from_date: mode === 'day' ? date : weekStart,
        to_date: mode === 'day' ? date : weekEnd,
        limit: 200,
      }),
  });

  const appointments = useMemo(
    () =>
      (query.data?.items ?? []).filter(
        (appointment) => appointment.status !== 'Cancelled',
      ),
    [query.data],
  );

  const rows = useMemo(() => {
    const result: Array<{ minutes: number; label: string; items: Appointment[] }> = [];
    for (let minutes = START_HOUR * 60; minutes < END_HOUR * 60; minutes += SLOT_MINUTES) {
      const label = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
        minutes % 60,
      ).padStart(2, '0')}`;
      result.push({
        minutes,
        label,
        items: appointments.filter((appointment) => {
          const start = minutesSinceMidnight(appointment.appointment_time);
          return start >= minutes && start < minutes + SLOT_MINUTES;
        }),
      });
    }
    return result;
  }, [appointments]);

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of appointments) {
      const bucket = map.get(appointment.appointment_date) ?? [];
      bucket.push(appointment);
      map.set(appointment.appointment_date, bucket);
    }
    return map;
  }, [appointments]);

  return (
    <Screen scroll={false}>
      <BackHeader title={formatMonthYear(date)} subtitle={`${appointments.length} appointments`} />

      <View style={{ marginBottom: spacing.md }}>
        <FilterPillRow options={VIEW_OPTIONS} value={mode} onChange={setMode} />
      </View>

      <DateStrip days={days} value={date} onChange={setDate} />

      <View style={{ marginTop: spacing.lg }}>
        <PickerField
          label="Doctor"
          placeholder="All doctors"
          value={practitioner}
          loading={practitionersQuery.isPending}
          options={[
            { value: '', label: 'All doctors' },
            ...(practitionersQuery.data?.items ?? []).map((item) => ({
              value: item.name,
              label: item.practitioner_name,
              description: item.department ?? undefined,
            })),
          ]}
          onChange={(value) => setPractitioner(value || null)}
        />
      </View>

      {query.isPending ? (
        <SkeletonList count={5} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : mode === 'day' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
          {rows.map((row) => (
            <View key={row.minutes} style={{ flexDirection: 'row', minHeight: ROW_HEIGHT }}>
              <View style={{ width: 52, paddingTop: 2 }}>
                <Text variant="micro" muted>
                  {row.label}
                </Text>
              </View>

              <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 4 }}>
                {row.items.length > 0 ? (
                  row.items.map((appointment) => (
                    <Pressable
                      key={appointment.name}
                      onPress={() =>
                        router.push(`/(app)/appointment/${encodeURIComponent(appointment.name)}`)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${appointment.patient_name} at ${formatTime(
                        appointment.appointment_time,
                      )}`}
                    >
                      <Card padding={spacing.md} style={{ marginBottom: 6 }}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: spacing.sm,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text variant="cardTitle" numberOfLines={1}>
                              {appointment.patient_name || appointment.patient}
                            </Text>
                            <Text variant="micro" muted numberOfLines={1} style={{ marginTop: 2 }}>
                              {appointment.practitioner_name}
                            </Text>
                          </View>
                          <StatusPill status={appointment.status} kind="appointment" />
                        </View>
                      </Card>
                    </Pressable>
                  ))
                ) : permissions.canCreateAppointment ? (
                  <Pressable
                    onPress={() => router.push('/(app)/appointment/new')}
                    accessibilityRole="button"
                    accessibilityLabel={`Book an appointment at ${row.label}`}
                    style={{
                      height: ROW_HEIGHT - 12,
                      borderRadius: radius.md,
                      justifyContent: 'center',
                      paddingHorizontal: spacing.md,
                    }}
                  >
                    <Text variant="micro" muted>
                      Free
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
          {buildDays(new Date(date.replace(/-/g, '/')), 7).map((day) => {
            const items = byDay.get(day.date) ?? [];
            return (
              <Pressable
                key={day.date}
                onPress={() => {
                  setDate(day.date);
                  setMode('day');
                }}
                accessibilityRole="button"
                accessibilityLabel={`${day.weekday} ${day.day_number}, ${items.length} appointments`}
              >
                <Card style={{ marginBottom: spacing.sm }} padding={spacing.md}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <View
                      style={{
                        width: 46,
                        alignItems: 'center',
                        paddingVertical: spacing.sm,
                        borderRadius: radius.md,
                        backgroundColor: items.length > 0 ? colors.mint : colors.bg,
                      }}
                    >
                      <Text variant="micro" muted>
                        {day.day_label}
                      </Text>
                      <Text variant="cardTitle">{day.day_number}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="cardTitle">
                        {items.length === 0
                          ? 'No appointments'
                          : `${items.length} appointment${items.length === 1 ? '' : 's'}`}
                      </Text>
                      {items.length > 0 ? (
                        <Text variant="micro" muted numberOfLines={1} style={{ marginTop: 2 }}>
                          {formatTime(items[0]?.appointment_time ?? '')} –{' '}
                          {formatTime(items[items.length - 1]?.appointment_time ?? '')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}
