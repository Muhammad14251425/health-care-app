/**
 * Authenticated booking.
 *
 * The difference from the guest flow is what is NOT here: no name, no phone, no
 * email. The patient is already known, so asking again would be both rude and a
 * chance to mistype themselves into a second record. The server takes the
 * patient from the session and rejects any request that names one.
 *
 * Doctor -> date -> slot -> confirm, on one scrolling screen. Availability comes
 * from the same server-side slot engine the staff and guest flows use
 * (clinic_core.api.v1.slots), so all three agree about one calendar.
 */

import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BackHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { DoctorCard } from '@/components/booking/DoctorCard';
import { DateStrip, TimeSlotGrid } from '@/components/booking/DateStrip';
import { TextField } from '@/components/form/TextField';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as publicBooking from '@/api/publicBooking';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { messageForError } from '@/api/errors';
import { formatDate, formatTime } from '@/utils/date';
import { colors, spacing } from '@/theme';

export default function PatientBookAppointmentScreen() {
  const [department, setDepartment] = useState<string | undefined>();
  const [practitioner, setPractitioner] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const toast = useToast();
  const queryClient = useQueryClient();

  const departments = useQuery({
    queryKey: queryKeys.publicDepartments,
    queryFn: publicBooking.listDepartments,
  });

  const practitioners = useQuery({
    queryKey: queryKeys.publicPractitioners(department),
    queryFn: () => publicBooking.listPractitioners(department),
  });

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

  // Choosing a different doctor invalidates the date and time beneath it.
  useEffect(() => {
    setDate(null);
    setTime(null);
  }, [practitioner]);

  useEffect(() => {
    setTime(null);
  }, [date]);

  const book = useMutation({
    mutationFn: () =>
      patientApi.createAppointment({
        practitioner: practitioner!,
        date: date!,
        time: time!,
        reason: reason.trim() || null,
      }),
    onSuccess: async (appointment) => {
      // Everything that counts appointments is now stale.
      await queryClient.invalidateQueries({ queryKey: ['patient'] });
      toast.success('Appointment booked.');
      router.replace(`/(patient)/appointment/${appointment.name}`);
    },
    onError: (error) => {
      toast.error(messageForError(error));
      // A conflict means the slot list on screen is out of date -- refresh it
      // so the patient is not staring at a time that is already gone.
      void slots.refetch();
      setTime(null);
    },
  });

  const chosenDoctor = practitioners.data?.items?.find((p) => p.name === practitioner);
  const canBook = Boolean(practitioner && date && time) && !book.isPending;

  return (
    <Screen>
      <BackHeader title="Book appointment" subtitle="Choose a doctor and a time" />

      {/* Department filter */}
      <SectionHeader title="Department" style={{ marginTop: spacing.lg }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <DeptChip
          label="All"
          selected={!department}
          onPress={() => setDepartment(undefined)}
        />
        {(departments.data?.items ?? []).map((dept) => (
          <DeptChip
            key={dept.name}
            label={dept.name}
            selected={department === dept.name}
            onPress={() => setDepartment(dept.name)}
          />
        ))}
      </View>

      {/* Doctor */}
      <SectionHeader title="Doctor" style={{ marginTop: spacing.xl }} />
      {practitioners.isError ? (
        <ErrorState error={practitioners.error} onRetry={() => void practitioners.refetch()} />
      ) : practitioners.isLoading ? (
        <SkeletonList count={3} />
      ) : (practitioners.data?.items?.length ?? 0) === 0 ? (
        <EmptyState title="No doctors available" message="Try another department." />
      ) : (
        <View>
          {practitioners.data!.items.map((doctor) => (
            // DoctorCard has no selected state of its own; the chosen doctor is
            // evident from the date/time sections that appear beneath it.
            <DoctorCard
              key={doctor.name}
              practitioner={doctor}
              onPress={() => setPractitioner(doctor.name)}
            />
          ))}
        </View>
      )}

      {/* Date */}
      {practitioner ? (
        <>
          <SectionHeader title="Date" style={{ marginTop: spacing.xl }} />
          {days.isLoading ? (
            <SkeletonList count={1} />
          ) : days.isError ? (
            <ErrorState error={days.error} onRetry={() => void days.refetch()} />
          ) : (days.data?.days?.length ?? 0) === 0 ? (
            <Card>
              <Text variant="caption" muted>
                This doctor has no open days in the next two weeks. Please choose
                another doctor or contact the clinic.
              </Text>
            </Card>
          ) : (
            <DateStrip
              days={days.data!.days}
              value={date}
              onChange={(next) => setDate(next)}
            />
          )}
        </>
      ) : null}

      {/* Slot */}
      {practitioner && date ? (
        <>
          <SectionHeader title="Time" style={{ marginTop: spacing.xl }} />
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
            <TimeSlotGrid
              slots={slots.data!.slots}
              value={time}
              onChange={(next) => setTime(next)}
            />
          )}
        </>
      ) : null}

      {/* Reason + confirm */}
      {practitioner && date && time ? (
        <>
          <SectionHeader title="Confirm" style={{ marginTop: spacing.xl }} />
          <Card>
            <Row label="Doctor" value={chosenDoctor?.practitioner_name ?? practitioner} />
            <Row
              label="Department"
              value={chosenDoctor?.department ?? 'General'}
            />
            <Row label="Date" value={formatDate(date)} />
            <Row label="Time" value={formatTime(time)} />
            <Row label="Type" value="Consultation" last />
          </Card>

          <View style={{ marginTop: spacing.lg }}>
            <TextField
              label="Reason for visit (optional)"
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. follow-up, persistent cough"
              maxLength={280}
              multiline
              style={{ height: 84, paddingTop: spacing.sm, textAlignVertical: 'top' }}
            />
          </View>

          <Button
            label="Confirm booking"
            onPress={() => book.mutate()}
            disabled={!canBook}
            loading={book.isPending}
            icon={<Check size={17} color={colors.white} strokeWidth={2} />}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.lg }}
          />
        </>
      ) : null}
    </Screen>
  );
}

function DeptChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        paddingHorizontal: spacing.md,
        height: 36,
        justifyContent: 'center',
        borderRadius: 999,
        backgroundColor: selected ? colors.green : colors.card,
        borderWidth: 1,
        borderColor: selected ? colors.green : colors.line,
      }}
    >
      <Text variant="micro" color={selected ? colors.white : colors.ink}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="caption">{value}</Text>
    </View>
  );
}
