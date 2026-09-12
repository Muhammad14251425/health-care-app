/**
 * Doctor availability -- the weekly working pattern, plus leave and blocked time.
 *
 * Editable now. `practitioners.availability` returns `can_manage`, decided by
 * the server (admin and reception manage anyone, a physician only themselves),
 * and the edit affordances are gated on it. That flag is a DISPLAY decision
 * only: every write re-checks permission, so a stale `true` is refused, not
 * honoured.
 *
 * Everything written here goes through Marley's own Practitioner Schedule and
 * Practitioner Availability doctypes, so a change is immediately visible to the
 * scheduler and to both the staff and guest booking flows.
 */

import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, CalendarPlus, Info, Pencil, X } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { PickerField } from '@/components/form/PickerField';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ScheduleEditorSheet } from '@/components/clinic/ScheduleEditorSheet';
import { TimeOffSheet, type TimeOffMode } from '@/components/clinic/TimeOffSheet';
import * as practitionersApi from '@/api/practitioners';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { formatDate, formatTime } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';
import type { ScheduleSlot, Unavailability } from '@/types/domain';

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export default function AvailabilityScreen() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [practitioner, setPractitioner] = useState<string | null>(null);
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [timeOffMode, setTimeOffMode] = useState<TimeOffMode>('leave');
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  const [timeOffError, setTimeOffError] = useState<string | null>(null);

  const practitionersQuery = useQuery({
    queryKey: queryKeys.practitioners(),
    queryFn: () => practitionersApi.listPractitioners(),
  });

  // Default to the first doctor so the screen is never empty on arrival.
  const selected = practitioner ?? practitionersQuery.data?.items[0]?.name ?? null;

  const availabilityQuery = useQuery({
    queryKey: queryKeys.availability(selected ?? 'none'),
    queryFn: () => practitionersApi.availability(selected ?? ''),
    enabled: Boolean(selected),
  });

  // Two distinct rights. `canManage` covers day-to-day diary work (block time,
  // leave) and includes reception; `canSetHours` covers rewriting the weekly
  // pattern and does not. Gating both on one flag would show reception an hours
  // editor whose save can only fail with 403.
  const canManage = Boolean(availabilityQuery.data?.can_manage);
  const canSetHours = Boolean(availabilityQuery.data?.can_set_hours);

  /** Flatten every schedule into "weekday -> ranges". */
  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleSlot[]>();
    for (const schedule of availabilityQuery.data?.schedules ?? []) {
      for (const slot of schedule.slots) {
        map.set(slot.day, [...(map.get(slot.day) ?? []), slot]);
      }
    }
    return map;
  }, [availabilityQuery.data]);

  /**
   * Invalidate slots too, not just this screen: changing the hours changes what
   * is bookable, and the booking screens cache their slot lists.
   */
  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.availability(selected ?? 'none') }),
      queryClient.invalidateQueries({ queryKey: ['slots'] }),
    ]);
  };

  const saveSchedule = useMutation({
    mutationFn: (slots: ScheduleSlot[]) =>
      practitionersApi.setSchedule(selected ?? '', slots),
    onSuccess: async () => {
      setEditingDay(null);
      await refreshAll();
      toast.success('Working hours updated');
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not update the schedule.',
      );
    },
  });

  const addTimeOff = useMutation({
    mutationFn: (values: {
      mode: TimeOffMode;
      from_date: string;
      to_date: string;
      from_time: string;
      to_time: string;
      reason: string;
    }) =>
      values.mode === 'leave'
        ? practitionersApi.setLeave(selected ?? '', {
            from_date: values.from_date,
            to_date: values.to_date,
            reason: values.reason as never,
          })
        : practitionersApi.blockTime(selected ?? '', {
            date: values.from_date,
            end_date: values.to_date,
            from_time: values.from_time,
            to_time: values.to_time,
            reason: values.reason as never,
          }),
    onSuccess: async () => {
      setTimeOffOpen(false);
      setTimeOffError(null);
      await refreshAll();
      toast.success(timeOffMode === 'leave' ? 'Leave added' : 'Time blocked');
    },
    onError: (error) => {
      // Shown inside the sheet, not as a toast: the user has to change the
      // dates to proceed, so the message belongs next to the fields.
      setTimeOffError(
        error instanceof ApiError ? error.message : 'Could not save this entry.',
      );
    },
  });

  const clearTimeOff = useMutation({
    mutationFn: (name: string) => practitionersApi.clearUnavailability(name),
    onSuccess: async () => {
      await refreshAll();
      toast.success('Entry removed');
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not remove the entry.');
    },
  });

  /**
   * `set_schedule` replaces the whole pattern, so one day's edit is merged into
   * every other day before sending.
   */
  const handleDaySave = (day: string, ranges: Array<{ from_time: string; to_time: string; duration: number }>) => {
    const next: ScheduleSlot[] = [];
    for (const weekday of WEEKDAYS) {
      const source =
        weekday === day
          ? ranges.map((range) => ({ ...range, day: weekday }))
          : (byDay.get(weekday) ?? []).map((slot) => ({
              day: weekday,
              from_time: slot.from_time,
              to_time: slot.to_time,
              duration: slot.duration || 0,
            }));
      next.push(...source);
    }

    if (next.length === 0) {
      // The backend requires at least one slot -- a doctor with no hours at all
      // is expressed as leave, not as an empty timetable.
      toast.error('Keep at least one working range, or add leave instead.');
      return;
    }
    saveSchedule.mutate(next);
  };

  return (
    <Screen
      onRefresh={() => void availabilityQuery.refetch()}
      refreshing={availabilityQuery.isRefetching}
    >
      <BackHeader title="Availability" subtitle="Weekly working schedule" />

      <PickerField
        label="Doctor"
        placeholder="Choose a doctor"
        value={selected}
        loading={practitionersQuery.isPending}
        options={(practitionersQuery.data?.items ?? []).map((item) => ({
          value: item.name,
          label: item.practitioner_name,
          description: item.department ?? undefined,
        }))}
        onChange={setPractitioner}
      />

      {availabilityQuery.isPending ? (
        <SkeletonList count={5} />
      ) : availabilityQuery.isError ? (
        <ErrorState
          error={availabilityQuery.error}
          onRetry={() => void availabilityQuery.refetch()}
        />
      ) : byDay.size === 0 && !canSetHours ? (
        <EmptyState
          icon={<CalendarOff size={24} color={colors.brown} strokeWidth={1.6} />}
          title="No schedule published"
          message="This doctor has no working pattern configured yet."
        />
      ) : (
        <>
          {WEEKDAYS.map((day) => {
            const ranges = byDay.get(day) ?? [];
            const row = (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: spacing.md,
                }}
              >
                <Text variant="cardTitle">{day}</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  {ranges.length === 0 ? (
                    <Text variant="caption" muted>
                      Unavailable
                    </Text>
                  ) : (
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {ranges.map((range) => (
                        <View
                          key={`${range.from_time}-${range.to_time}`}
                          style={{
                            backgroundColor: colors.mint,
                            borderRadius: radius.pill,
                            paddingHorizontal: spacing.md,
                            paddingVertical: 4,
                          }}
                        >
                          <Text variant="micro" color={colors.green}>
                            {formatTime(range.from_time)} – {formatTime(range.to_time)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {canSetHours ? (
                    <Pencil size={16} color={colors.muted} strokeWidth={1.8} />
                  ) : null}
                </View>
              </View>
            );

            return (
              <Card key={day} style={{ marginBottom: spacing.sm }}>
                {canSetHours ? (
                  <Pressable
                    onPress={() => setEditingDay(day)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${day} hours`}
                  >
                    {row}
                  </Pressable>
                ) : (
                  row
                )}
              </Card>
            );
          })}

          {canManage ? (
            <Button
              label="Add leave or block time"
              variant="secondary"
              fullWidth
              icon={<CalendarPlus size={17} color={colors.green} strokeWidth={1.8} />}
              onPress={() => {
                setTimeOffError(null);
                setTimeOffOpen(true);
              }}
              style={{ marginTop: spacing.md }}
            />
          ) : null}

          <TimeOffList
            items={availabilityQuery.data?.unavailability ?? []}
            canManage={canManage}
            clearingName={clearTimeOff.isPending ? clearTimeOff.variables : undefined}
            onClear={(name) => clearTimeOff.mutate(name)}
          />

          {!canSetHours ? (
            <Card style={{ marginTop: spacing.lg }}>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <Info size={17} color={colors.muted} strokeWidth={1.8} />
                <Text variant="caption" muted style={{ flex: 1 }}>
                  {canManage
                    ? 'You can block time and record leave for this doctor. Only they or an administrator can change the weekly hours.'
                    : 'You can see when this doctor is bookable. Only they or an administrator can change these hours.'}
                </Text>
              </View>
            </Card>
          ) : null}
        </>
      )}

      <ScheduleEditorSheet
        visible={Boolean(editingDay)}
        day={editingDay}
        ranges={editingDay ? (byDay.get(editingDay) ?? []) : []}
        saving={saveSchedule.isPending}
        onClose={() => setEditingDay(null)}
        onSave={handleDaySave}
      />

      <TimeOffSheet
        visible={timeOffOpen}
        mode={timeOffMode}
        saving={addTimeOff.isPending}
        error={timeOffError}
        onClose={() => setTimeOffOpen(false)}
        onModeChange={(mode) => {
          setTimeOffMode(mode);
          setTimeOffError(null);
        }}
        onSubmit={(values) => addTimeOff.mutate(values)}
      />
    </Screen>
  );
}

/** Upcoming leave and blocked time, newest date first as the server sorts it. */
function TimeOffList({
  items,
  canManage,
  clearingName,
  onClear,
}: {
  items: Unavailability[];
  canManage: boolean;
  clearingName?: string;
  onClear: (name: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Text variant="caption" muted style={{ marginTop: spacing.lg }}>
        No upcoming leave or blocked time.
      </Text>
    );
  }

  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
        LEAVE &amp; BLOCKED TIME
      </Text>

      {items.map((item) => {
        const sameDay = item.start_date === item.end_date;
        const dates = sameDay
          ? formatDate(item.start_date)
          : `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`;

        return (
          <Card key={item.name} style={{ marginBottom: spacing.sm }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: spacing.md,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="cardTitle">{dates}</Text>
                <Text variant="caption" muted>
                  {item.full_day
                    ? `All day · ${item.reason}`
                    : `${formatTime(item.start_time)} – ${formatTime(item.end_time)} · ${item.reason}`}
                </Text>
                {item.note ? (
                  <Text variant="micro" muted>
                    {item.note}
                  </Text>
                ) : null}
              </View>

              {canManage ? (
                <Pressable
                  onPress={() => onClear(item.name)}
                  disabled={clearingName === item.name}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${dates}`}
                  hitSlop={8}
                  style={{ opacity: clearingName === item.name ? 0.4 : 1 }}
                >
                  <X size={18} color={colors.danger} strokeWidth={1.8} />
                </Pressable>
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}
