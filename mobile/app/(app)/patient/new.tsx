/**
 * Register a patient.
 *
 * The backend returns `possible_duplicates` when the mobile number already
 * exists. It deliberately does not auto-merge, so the app surfaces the match
 * and lets staff decide.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FormInput } from '@/components/form/FormInput';
import { PickerField } from '@/components/form/PickerField';
import { DateOfBirthField } from '@/components/form/DateOfBirthField';
import { useToast } from '@/components/ui/Toast';
import * as patientsApi from '@/api/patients';
import { ApiError } from '@/api/errors';
import { patientSchema, type PatientForm } from '@/validation/schemas';
import { colors, spacing } from '@/theme';

/** Marley's seeded Gender values. */
const GENDERS = [
  'Female',
  'Male',
  'Transgender',
  'Non-Conforming',
  'Genderqueer',
  'Other',
  'Prefer not to say',
].map((value) => ({ value, label: value }));

export default function NewPatient() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [duplicates, setDuplicates] = useState<string[]>([]);

  const { control, handleSubmit, watch, setValue, formState } = useForm<PatientForm>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      sex: '',
      dob: '',
      mobile: '',
      email: '',
      blood_group: '',
    },
  });

  const sex = watch('sex');
  const dob = watch('dob');

  const create = useMutation({
    mutationFn: (values: PatientForm) =>
      patientsApi.createPatient({
        first_name: values.first_name.trim(),
        last_name: values.last_name?.trim() || undefined,
        sex: values.sex,
        dob: values.dob?.trim() || undefined,
        mobile: values.mobile.trim(),
        email: values.email?.trim() || undefined,
        blood_group: values.blood_group?.trim() || undefined,
      }),
    onSuccess: async (patient) => {
      await queryClient.invalidateQueries({ queryKey: ['patients'] });

      const matches = patient.possible_duplicates ?? [];
      if (matches.length > 0) {
        setDuplicates(matches.map((match) => match.patient_name));
      }

      toast.success('Patient registered');
      router.replace(`/(app)/patient/${encodeURIComponent(patient.name)}`);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not register the patient.',
      );
    },
  });

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
          <BackHeader title="New patient" subtitle="Register a patient record" />

          <FormInput
            control={control}
            name="first_name"
            label="First name"
            placeholder="Ali"
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="last_name"
            label="Last name"
            placeholder="Khan"
            returnKeyType="next"
          />

          <PickerField
            label="Gender"
            placeholder="Select gender"
            value={sex || null}
            options={GENDERS}
            onChange={(value) => setValue('sex', value, { shouldValidate: true })}
            error={formState.errors.sex?.message}
          />

          <FormInput
            control={control}
            name="mobile"
            label="Mobile"
            placeholder="0300 1234567"
            type="phone"
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="email"
            label="Email (optional)"
            placeholder="patient@example.com"
            type="email"
            returnKeyType="next"
          />
          {/* A DOB typed as free text invites 1990-13-45 and, worse, plausible
              but wrong dates that end up in a medical record. The picker emits
              YYYY-MM-DD directly, so nothing downstream changes. */}
          <View style={{ marginBottom: spacing.lg }}>
            <DateOfBirthField
              label="Date of birth (optional)"
              value={dob ?? ''}
              onChange={(next) =>
                setValue('dob', next, { shouldDirty: true, shouldValidate: true })
              }
              optional
              error={formState.errors.dob?.message ?? null}
            />
          </View>

          {duplicates.length > 0 ? (
            <View
              style={{
                backgroundColor: colors.warningSoft,
                borderRadius: 12,
                padding: spacing.md,
                marginBottom: spacing.lg,
              }}
            >
              <Text variant="bodySmall" color={colors.warning}>
                A patient with this number already exists: {duplicates.join(', ')}. Please check
                before creating a second record.
              </Text>
            </View>
          ) : null}

          <Button
            label="Register patient"
            onPress={onSubmit}
            loading={create.isPending}
            disabled={create.isPending}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
