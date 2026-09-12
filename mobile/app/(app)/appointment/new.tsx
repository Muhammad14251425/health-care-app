/**
 * Create an appointment.
 *
 * The slot list is fetched from the backend for the chosen doctor and day; the
 * app never offers a time it has not seen the server publish. On a 409 the
 * slots are refetched and the user is told plainly that the time just went --
 * the appointment is never optimistically shown as booked.
 */

import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { PickerField } from '@/components/form/PickerField';
import { DateStrip, TimeSlotGrid } from '@/components/booking/DateStrip';
import { ErrorState, SkeletonBlock } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as appointmentsApi from '@/api/appointments';
import * as patientsApi from '@/api/patients';
import * as practitionersApi from '@/api/practitioners';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useStaffSlots } from '@/hooks/useStaffSlots';
import { addDays, dateStripLabels, toBackendDate } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';
import type { PublicDay } from '@/types/domain';

/** Fourteen days from today, for the horizontal strip. */
function buildDays(): PublicDay[] {
  return Array.from({ length: 14 }, (_, offset) => {
    const date = addDays(new Date(), offset);
    const { weekday, day } = dateStripLabels(date);
    return {
      date: toBackendDate(date),
      weekday,
      day_label: weekday,
      day_number: day,
      // The slot lookup decides what is actually free; every day is selectable.
      available: true,
    };
  });
}

export default function NewAppointment() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ patient?: string }>();

  // Arriving from a patient profile fixes who this is for. Decode it -- patient
  // IDs are names here ("Syed Azaan"), so the raw param is percent-encoded and
  // would not match any record.
  const presetPatient = params.patient ? decodeURIComponent(params.patient) : null;

  const [patient, setPatient] = useState<string | null>(presetPatient);
  const [practitioner, setPractitioner] = useState<string | null>(null);
  const [date, setDate] = useState<string>(toBackendDate(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const [patientSearch, setPatientSearch] = useState('');
  const debouncedPatientSearch = useDebouncedValue(patientSearch, 350);

  const days = useMemo(buildDays, []);

  const patientsQuery = useQuery({
    queryKey: queryKeys.patients(debouncedPatientSearch),
    queryFn: () =>
      patientsApi.listPatients({ search: debouncedPatientSearch || undefined, limit: 50 }),
    // Nothing to choose when the patient is already decided.
    enabled: !presetPatient,
  });

  const practitionersQuery = useQuery({
    queryKey: queryKeys.practitioners(),
    queryFn: () => practitionersApi.listPractitioners(),
  });

  const slots = useStaffSlots(practitioner, date);

  const create = useMutation({
    mutationFn: () =>
      appointmentsApi.createAppointment({
        patient: patient ?? '',
        practitioner: practitioner ?? '',
        appointment_date: date,
        appointment_time: time ?? '',
      }),
    onSuccess: async (appointment) => {
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
      toast.success('Appointment booked');
      router.replace(`/(app)/appointment/${encodeURIComponent(appointment.name)}`);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.isConflict) {
        setTime(null);
        await slots.refetch();
        setConflict('That time was just booked. Please choose another time.');
        return;
      }
      toast.error(
        error instanceof ApiError ? error.message : 'Could not create the appointment.',
      );
    },
  });

  const canSubmit = Boolean(patient && practitioner && date && time) && !create.isPending;

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        >
          <BackHeader title="New appointment" subtitle="Check availability before booking" />

          {presetPatient ? (
            // Booked from this patient's profile, so there is nothing to pick.
            // Shown read-only rather than as a dropdown pre-filled with one
            // value, which invites the user to re-answer a settled question.
            <View style={{ marginBottom: spacing.lg }}>
              <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
                Patient
              </Text>
              <View
                style={{
                  backgroundColor: colors.card,
                  borderRadius: radius.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                }}
              >
                <Text>{presetPatient}</Text>
              </View>
            </View>
          ) : (
            <PickerField
              label="Patient"
              placeholder="Choose a patient"
              value={patient}
              searchable
              onSearchChange={setPatientSearch}
              loading={patientsQuery.isPending}
              options={(patientsQuery.data?.items ?? []).map((item) => ({
                value: item.name,
                label: item.patient_name,
                description: item.mobile ?? undefined,
              }))}
              onChange={setPatient}
              emptyMessage="No patients match that search"
            />
          )}

          <PickerField
            label="Doctor"
            placeholder="Choose a doctor"
            value={practitioner}
            loading={practitionersQuery.isPending}
            options={(practitionersQuery.data?.items ?? []).map((item) => ({
              value: item.name,
              label: item.practitioner_name,
              description: item.department ?? undefined,
            }))}
            onChange={(next) => {
              setPractitioner(next);
              setTime(null);
              setConflict(null);
            }}
            emptyMessage="No doctors available"
          />

          <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
            Date
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

          <Text variant="label" muted style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
            Available time
          </Text>

          {!practitioner ? (
            <Text variant="caption" muted>
              Choose a doctor to see their available times.
            </Text>
          ) : slots.isPending ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {Array.from({ length: 6 }, (_, index) => (
                <SkeletonBlock key={index} width={92} height={44} style={{ borderRadius: 999 }} />
              ))}
            </View>
          ) : slots.isError ? (
            <ErrorState error={slots.error} onRetry={() => void slots.refetch()} />
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
              label="Book appointment"
              disabled={!canSubmit}
              loading={create.isPending}
              onPress={() => create.mutate()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
