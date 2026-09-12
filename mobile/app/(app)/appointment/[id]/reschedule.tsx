/**
 * Reschedule.
 *
 * Reschedule re-runs Marley's overlap validation, so it can conflict exactly
 * like a fresh booking -- handled the same way.
 */

import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { DateStrip, TimeSlotGrid } from '@/components/booking/DateStrip';
import { ErrorState, SkeletonBlock, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as appointmentsApi from '@/api/appointments';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { useStaffSlots } from '@/hooks/useStaffSlots';
import { addDays, dateStripLabels, formatDateLong, formatTime, toBackendDate } from '@/utils/date';
import { colors, spacing } from '@/theme';
import type { PublicDay } from '@/types/domain';

function buildDays(): PublicDay[] {
  return Array.from({ length: 14 }, (_, offset) => {
    const date = addDays(new Date(), offset);
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

export default function RescheduleAppointment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const appointmentId = decodeURIComponent(String(id ?? ''));
  const days = useMemo(buildDays, []);

  const [date, setDate] = useState<string>(toBackendDate(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const appointmentQuery = useQuery({
    queryKey: queryKeys.appointment(appointmentId),
    queryFn: () => appointmentsApi.getAppointment(appointmentId),
    enabled: Boolean(appointmentId),
  });

  const practitioner = appointmentQuery.data?.practitioner ?? null;
  const slots = useStaffSlots(practitioner, date);

  const reschedule = useMutation({
    mutationFn: () =>
      appointmentsApi.rescheduleAppointment(appointmentId, date, time ?? ''),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.appointment(appointmentId) }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      ]);
      toast.success('Appointment rescheduled');
      router.back();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.isConflict) {
        setTime(null);
        await slots.refetch();
        setConflict('That time was just booked. Please choose another time.');
        return;
      }
      toast.error(
        error instanceof ApiError ? error.message : 'Could not reschedule the appointment.',
      );
    },
  });

  const appointment = appointmentQuery.data;

  return (
    <Screen scroll={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
      >
        <BackHeader
          title="Reschedule"
          subtitle={
            appointment
              ? `Currently ${formatDateLong(appointment.appointment_date)}, ${formatTime(
                  appointment.appointment_time,
                )}`
              : undefined
          }
        />

        {appointmentQuery.isPending ? (
          <SkeletonList count={2} />
        ) : appointmentQuery.isError ? (
          <ErrorState
            error={appointmentQuery.error}
            onRetry={() => void appointmentQuery.refetch()}
          />
        ) : (
          <>
            <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
              New date
            </Text>
            <DateStrip
              days={days}
              value={date}
              onChange={(next) => {
                setDate(next);
                setTime(null);
                setConflict(null);
              }}
            />

            <Text
              variant="label"
              muted
              style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}
            >
              New time
            </Text>

            {slots.isPending ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {Array.from({ length: 6 }, (_, index) => (
                  <SkeletonBlock
                    key={index}
                    width={92}
                    height={44}
                    style={{ borderRadius: 999 }}
                  />
                ))}
              </View>
            ) : slots.slots.length === 0 ? (
              <Text variant="caption" muted>
                {slots.message ?? 'This doctor is not available on the selected day.'}
              </Text>
            ) : (
              <TimeSlotGrid
                slots={slots.slots}
                value={time}
                onChange={(next) => {
                  setTime(next);
                  setConflict(null);
                }}
              />
            )}

            {conflict ? (
              <View
                style={{
                  backgroundColor: colors.dangerSoft,
                  borderRadius: 12,
                  padding: spacing.md,
                  marginTop: spacing.lg,
                }}
              >
                <Text variant="bodySmall" color={colors.danger}>
                  {conflict}
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: spacing.xxl }}>
              <Button
                label="Confirm new time"
                disabled={!time || reschedule.isPending}
                loading={reschedule.isPending}
                onPress={() => reschedule.mutate()}
              />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
