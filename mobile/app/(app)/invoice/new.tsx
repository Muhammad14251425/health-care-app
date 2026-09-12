/**
 * Create a consultation invoice.
 *
 * The backend exposes consultation invoicing specifically: pick the patient and
 * the practitioner, optionally override the rate, and ERPNext builds the
 * document (creating the `Consultation Charge` item on first use). Totals and
 * tax are ERPNext's business, not this screen's -- the amount shown here is a
 * preview of what was entered, never a computed authority.
 */

import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormInput } from '@/components/form/FormInput';
import { PickerField } from '@/components/form/PickerField';
import { useToast } from '@/components/ui/Toast';
import * as invoicesApi from '@/api/invoices';
import * as patientsApi from '@/api/patients';
import * as practitionersApi from '@/api/practitioners';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatCurrency, parseAmount } from '@/utils/currency';
import { invoiceSchema, type InvoiceForm } from '@/validation/schemas';
import { colors, radius, spacing } from '@/theme';
import { useState } from 'react';

export default function NewInvoice() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Reached from a patient's own invoice list, so the patient is already known.
  const params = useLocalSearchParams<{ patient?: string }>();
  const presetPatient = params.patient ? decodeURIComponent(params.patient) : null;

  const [patientSearch, setPatientSearch] = useState('');
  const debouncedSearch = useDebouncedValue(patientSearch, 350);

  const { control, handleSubmit, watch, setValue, formState } = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: { patient: presetPatient ?? '', practitioner: '', rate: '' },
  });

  const patient = watch('patient');
  const practitioner = watch('practitioner');
  const rate = watch('rate');

  const patientsQuery = useQuery({
    queryKey: queryKeys.patients(debouncedSearch),
    queryFn: () => patientsApi.listPatients({ search: debouncedSearch || undefined, limit: 50 }),
    // Nothing to choose when the patient came in with the route.
    enabled: !presetPatient,
  });

  const practitionersQuery = useQuery({
    queryKey: queryKeys.practitioners(),
    queryFn: () => practitionersApi.listPractitioners(),
  });

  const selectedPractitioner = practitionersQuery.data?.items.find(
    (item) => item.name === practitioner,
  );

  // Shown as guidance only; if the field is left blank the backend uses the
  // practitioner's configured charge.
  const previewAmount =
    parseAmount(rate ?? '') ?? selectedPractitioner?.op_consulting_charge ?? null;

  const create = useMutation({
    mutationFn: (values: InvoiceForm) =>
      invoicesApi.createConsultationInvoice({
        patient: values.patient,
        practitioner: values.practitioner,
        rate: parseAmount(values.rate ?? '') ?? undefined,
        submit: true,
      }),
    onSuccess: async (invoice) => {
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice created');
      router.replace(`/(app)/invoice/${encodeURIComponent(invoice.name)}`);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not create the invoice.',
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
          <BackHeader title="New invoice" subtitle="Consultation charge" />

          {presetPatient ? (
            // Came from this patient's invoice list -- showing a dropdown here
            // would ask the user to re-answer a question they already answered.
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
              value={patient || null}
              searchable
              onSearchChange={setPatientSearch}
              loading={patientsQuery.isPending}
              options={(patientsQuery.data?.items ?? []).map((item) => ({
                value: item.name,
                label: item.patient_name,
                description: item.mobile ?? undefined,
              }))}
              onChange={(value) => setValue('patient', value, { shouldValidate: true })}
              error={formState.errors.patient?.message}
            />
          )}

          <PickerField
            label="Doctor"
            placeholder="Choose a doctor"
            value={practitioner || null}
            loading={practitionersQuery.isPending}
            options={(practitionersQuery.data?.items ?? []).map((item) => ({
              value: item.name,
              label: item.practitioner_name,
              description: item.op_consulting_charge
                ? formatCurrency(item.op_consulting_charge)
                : undefined,
            }))}
            onChange={(value) => setValue('practitioner', value, { shouldValidate: true })}
            error={formState.errors.practitioner?.message}
          />

          <FormInput
            control={control}
            name="rate"
            label="Amount (optional)"
            placeholder={
              selectedPractitioner?.op_consulting_charge
                ? String(selectedPractitioner.op_consulting_charge)
                : 'Use the standard consultation fee'
            }
            type="number"
            hint="Leave blank to use this doctor's standard consultation fee."
          />

          {previewAmount ? (
            <Card style={{ marginBottom: spacing.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="bodySmall" muted>
                  Estimated total
                </Text>
                <Text variant="cardTitle">{formatCurrency(previewAmount)}</Text>
              </View>
              <Text variant="micro" muted style={{ marginTop: spacing.sm }}>
                The final amount, including any tax, is calculated by the clinic&apos;s
                accounting system when the invoice is created.
              </Text>
            </Card>
          ) : null}

          <Button
            label="Create invoice"
            onPress={onSubmit}
            loading={create.isPending}
            disabled={create.isPending}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
