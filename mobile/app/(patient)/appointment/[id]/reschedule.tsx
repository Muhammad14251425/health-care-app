/**
 * Move one of the patient's own appointments.
 *
 * The doctor is fixed -- changing who you see is a different appointment, not a
 * reschedule, and the server keeps the practitioner from the existing record.
 * Only the date and time are chosen here, from the same server-side slot list
 * the booking screen uses.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BackHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { DateStrip, TimeSlotGrid } from '@/components/booking/DateStrip';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as patientApi from '@/api/patient';
import * as publicBooking from '@/api/publicBooking';
import { queryKeys } from '@/api/queryClient';
import { messageForError } from '@/api/errors';
import { formatDate, formatDateLong, formatTime } from '@/utils/date';
import { colors, spacing } from '@/theme';

export default function PatientRescheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const toast = useToast();
  const queryClient = useQueryClient();

  const appointment = useQuery({
    queryKey: queryKeys.patientAppointment(id ?? ''),
    queryFn: () => patientApi.getAppointment(id!),
    enabled: Boolean(id),
  });

  const practitioner = appointment.data?.practitioner;

  const days = useQuery({
    queryKey: queryKeys.publicDays(practitioner ?? ''),
    queryFn: () => publicBooking.availableDays(practitioner!),
    enabled: Boolean(practitioner),
  });

  const slots = useQuery({
    queryKey: queryKeys.publicSlots(practitioner ?? '', date ?? ''),
    queryFn: () => publicBooking.availableSlots(practitioner!, date!),
    enabled: Boolean(practitioner && date),
  });

  useEffect(() => {
    setTime(null);
  }, [date]);

  const reschedule = useMutation({
    mutationFn: () => patientApi.rescheduleAppointment(id!, date!, time!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['patient'] });
      toast.success('Appointment moved.');
      router.back();
    },
    onError: (error) => {
      toast.error(messageForError(error));
      void slots.refetch();
      setTime(null);
    },
  });

  return (
    <Screen>
      <BackHeader title="Reschedule" subtitle="Pick a new date and time" />

      {appointment.isError ? (
        <View style={{ marginTop: spacing.lg }}>
          <ErrorState
            error={appointment.error}
            onRetry={() => void appointment.refetch()}
          />
        </View>
      ) : appointment.isLoading || !appointment.data ? (
        <SkeletonList count={3} />
      ) : (
        <>
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="caption" muted>
              Currently
            </Text>
            <Text variant="body" style={{ marginTop: 4 }}>
              {formatDateLong(appointment.data.appointment_date)} ·{' '}
              {formatTime(appointment.data.appointment_time)}
            </Text>
            <Text variant="caption" muted style={{ marginTop: 2 }}>
              {appointment.data.practitioner_name ?? appointment.data.practitioner}
            </Text>
          </Card>

          <SectionHeader title="New date" style={{ marginTop: spacing.xl }} />
          {days.isLoading ? (
            <SkeletonList count={1} />
          ) : days.isError ? (
            <ErrorState error={days.error} onRetry={() => void days.refetch()} />
          ) : (days.data?.days?.length ?? 0) === 0 ? (
            <Card>
              <Text variant="caption" muted>
                This doctor has no open days at the moment. Please contact the clinic.
              </Text>
            </Card>
          ) : (
            <DateStrip days={days.data!.days} value={date} onChange={setDate} />
          )}

          {date ? (
            <>
              <SectionHeader title="New time" style={{ marginTop: spacing.xl }} />
              {slots.isLoading ? (
                <SkeletonList count={2} />
              ) : slots.isError ? (
                <ErrorState error={slots.error} onRetry={() => void slots.refetch()} />
              ) : (slots.data?.slots?.length ?? 0) === 0 ? (
                <Card>
                  <Text variant="caption" muted>
                    No free times on {formatDate(date)}. Please pick another day.
                  </Text>
                </Card>
              ) : (
                <TimeSlotGrid slots={slots.data!.slots} value={time} onChange={setTime} />
              )}
            </>
          ) : null}

          <Button
            label="Confirm new time"
            onPress={() => reschedule.mutate()}
            disabled={!date || !time || reschedule.isPending}
            loading={reschedule.isPending}
            icon={<Check size={17} color={colors.white} strokeWidth={2} />}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.xl }}
          />
        </>
      )}
    </Screen>
  );
}
