/**
 * Write a consultation note.
 *
 * Saved as a draft first; signing it is a separate, explicit step because a
 * submitted encounter is immutable in Marley (further edits return CONFLICT).
 * No autosave: a half-typed clinical note silently persisting is worse than
 * losing it, and the backend has no draft-safe endpoint for it.
 */

import { useEffect } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FormInput } from '@/components/form/FormInput';
import { PickerField } from '@/components/form/PickerField';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { Lock } from 'lucide-react-native';
import * as encountersApi from '@/api/encounters';
import * as appointmentsApi from '@/api/appointments';
import * as practitionersApi from '@/api/practitioners';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import { useAuth, usePermissions } from '@/stores/auth';
import { encounterSchema, toList, type EncounterForm } from '@/validation/schemas';
import { colors, spacing } from '@/theme';

export default function NewEncounter() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const params = useLocalSearchParams<{ patient?: string; appointment?: string }>();

  const patient = params.patient ? decodeURIComponent(params.patient) : '';
  const appointment = params.appointment ? decodeURIComponent(params.appointment) : undefined;

  // A doctor writes as themselves. An admin has no practitioner record, so the
  // note has to name the clinician it belongs to -- see the picker below.
  const { user } = useAuth();
  const ownPractitioner = user?.practitioner ?? null;

  // When the note came from an appointment, that appointment already knows which
  // doctor saw the patient. Inherit it rather than asking, so a note cannot be
  // filed against a different doctor than the one who held the consultation.
  const appointmentQuery = useQuery({
    queryKey: queryKeys.appointment(appointment ?? 'none'),
    queryFn: () => appointmentsApi.getAppointment(appointment ?? ''),
    enabled: Boolean(appointment) && !ownPractitioner,
  });

  const inheritedPractitioner = appointmentQuery.data?.practitioner ?? null;
  const resolvedPractitioner = ownPractitioner ?? inheritedPractitioner;

  // Only asked for when nothing else determined it: an admin writing a
  // standalone note with no appointment context.
  const needsPicker = !ownPractitioner && !inheritedPractitioner;

  const practitionersQuery = useQuery({
    queryKey: queryKeys.practitioners(),
    queryFn: () => practitionersApi.listPractitioners(),
    enabled: needsPicker,
  });

  const { control, handleSubmit, setValue } = useForm<EncounterForm>({
    resolver: zodResolver(encounterSchema),
    defaultValues: {
      patient,
      appointment,
      practitioner: resolvedPractitioner ?? '',
      symptoms: '',
      diagnosis: '',
      encounter_comment: '',
    },
  });

  // The appointment resolves after the form is created, so fill it in when it
  // arrives. Guarded on the value so it cannot clobber a manual choice.
  useEffect(() => {
    if (resolvedPractitioner) setValue('practitioner', resolvedPractitioner);
  }, [resolvedPractitioner, setValue]);

  const create = useMutation({
    mutationFn: (values: EncounterForm) =>
      encountersApi.createEncounter({
        patient: values.patient,
        appointment: values.appointment,
        practitioner: values.practitioner,
        symptoms: toList(values.symptoms),
        diagnosis: toList(values.diagnosis),
        encounter_comment: values.encounter_comment?.trim() || undefined,
      }),
    onSuccess: async (encounter) => {
      await queryClient.invalidateQueries({ queryKey: ['encounters'] });
      toast.success('Note saved as draft');
      router.replace(`/(app)/encounter/${encodeURIComponent(encounter.name)}`);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not save the note.');
    },
  });

  if (!permissions.canCreateEncounter) {
    return (
      <Screen>
        <BackHeader title="Consultation note" />
        <EmptyState
          icon={<Lock size={24} color={colors.brown} strokeWidth={1.6} />}
          title="Not available to you"
          message="Only the treating clinician can record consultation notes."
        />
      </Screen>
    );
  }

  const onSubmit = handleSubmit((values) => create.mutate(values));

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
          <BackHeader title="Consultation note" subtitle={patient} />

          {needsPicker ? (
            <Controller
              control={control}
              name="practitioner"
              render={({ field, fieldState }) => (
                <PickerField
                  label="Doctor"
                  placeholder="Select the treating doctor"
                  value={field.value || null}
                  onChange={field.onChange}
                  searchable
                  loading={practitionersQuery.isPending}
                  error={fieldState.error?.message}
                  emptyMessage="No active doctors found."
                  options={(practitionersQuery.data?.items ?? []).map((p) => ({
                    value: p.name,
                    label: p.practitioner_name,
                    description: p.department ?? undefined,
                  }))}
                />
              )}
            />
          ) : null}

          {needsPicker ? (
            <Text variant="micro" muted style={{ marginBottom: spacing.md }}>
              You are recording this note on the doctor&apos;s behalf. It will be filed
              under their name, and saved as entered by you.
            </Text>
          ) : null}

          <FormInput
            control={control}
            name="symptoms"
            label="Symptoms"
            placeholder="Headache, fever"
            hint="Separate multiple entries with commas."
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="diagnosis"
            label="Assessment / diagnosis"
            placeholder="Tension headache"
            hint="Separate multiple entries with commas."
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="encounter_comment"
            label="Clinical notes"
            placeholder="Examination findings, plan, follow-up…"
            type="multiline"
          />

          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="Save note"
              onPress={onSubmit}
              loading={create.isPending}
              disabled={create.isPending}
            />
            <Text variant="micro" muted align="center" style={{ marginTop: spacing.md }}>
              Saved as a draft. You can review it before signing.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
