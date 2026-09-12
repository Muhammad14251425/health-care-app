/**
 * Edit patient contact details.
 *
 * Only the four fields the backend's update allowlist accepts are editable.
 * Name, gender and date of birth are deliberately absent: the API refuses them,
 * so offering the inputs would only produce a silent no-op.
 */

import { useEffect } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FormInput } from '@/components/form/FormInput';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as patientsApi from '@/api/patients';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { patientContactSchema, type PatientContactForm } from '@/validation/schemas';
import { spacing } from '@/theme';

export default function EditPatient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const patientId = decodeURIComponent(String(id ?? ''));

  const query = useQuery({
    queryKey: queryKeys.patient(patientId),
    queryFn: () => patientsApi.getPatient(patientId),
    enabled: Boolean(patientId),
  });

  const { control, handleSubmit, reset } = useForm<PatientContactForm>({
    resolver: zodResolver(patientContactSchema),
    defaultValues: { mobile: '', email: '', phone: '', blood_group: '' },
  });

  // Populate once the record arrives.
  useEffect(() => {
    if (query.data) {
      reset({
        mobile: query.data.mobile ?? '',
        email: query.data.email ?? '',
        phone: query.data.phone ?? '',
        blood_group: query.data.blood_group ?? '',
      });
    }
  }, [query.data, reset]);

  const update = useMutation({
    mutationFn: (values: PatientContactForm) =>
      patientsApi.updatePatient(patientId, {
        mobile: values.mobile.trim(),
        email: values.email?.trim() || undefined,
        phone: values.phone?.trim() || undefined,
        blood_group: values.blood_group?.trim() || undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.patient(patientId) });
      await queryClient.invalidateQueries({ queryKey: ['patients'] });
      toast.success('Patient updated');
      router.back();
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not save the changes.',
      );
    },
  });

  const onSubmit = handleSubmit((values) => update.mutate(values));

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
          <BackHeader title="Edit contact" subtitle={query.data?.patient_name} />

          {query.isPending ? (
            <SkeletonList count={3} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <>
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
                name="phone"
                label="Alternative phone (optional)"
                placeholder="021 1234567"
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
              <FormInput
                control={control}
                name="blood_group"
                label="Blood group (optional)"
                placeholder="O+"
              />

              <Text variant="micro" muted style={{ marginBottom: spacing.lg }}>
                Name, gender and date of birth can only be changed by an administrator in the
                clinic system.
              </Text>

              <Button
                label="Save changes"
                onPress={onSubmit}
                loading={update.isPending}
                disabled={update.isPending}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
