/**
 * Encounter detail.
 *
 * The backend omits symptoms/diagnosis entirely (rather than blanking them) when
 * the caller lacks clinical access, and signals that with `clinical_access`.
 * This screen honours that: absent means not shown, never "shown as empty".
 *
 * Signing is irreversible -- Marley makes a submitted encounter immutable -- so
 * it is behind a confirmation.
 */

import { Alert, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { SummaryRow } from '@/components/ui/SummaryRow';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as encountersApi from '@/api/encounters';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { usePermissions } from '@/stores/auth';
import { formatDate } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';

export default function EncounterDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const encounterId = decodeURIComponent(String(id ?? ''));

  const query = useQuery({
    queryKey: queryKeys.encounter(encounterId),
    queryFn: () => encountersApi.getEncounter(encounterId),
    enabled: Boolean(encounterId),
  });

  const submit = useMutation({
    mutationFn: () => encountersApi.submitEncounter(encounterId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.encounter(encounterId) });
      await queryClient.invalidateQueries({ queryKey: ['encounters'] });
      toast.success('Note signed');
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not sign the note.');
    },
  });

  const encounter = query.data;
  const signed = encounter?.docstatus === 1;
  // `clinical_access: false` means the clinical keys were withheld server-side.
  const clinicalVisible = encounter?.clinical_access !== false;

  const confirmSign = () => {
    Alert.alert(
      'Sign note',
      'Once signed, this note cannot be edited. Continue?',
      [
        { text: 'Keep as draft', style: 'cancel' },
        { text: 'Sign', style: 'default', onPress: () => submit.mutate() },
      ],
    );
  };

  return (
    <Screen>
      <BackHeader
        title="Consultation note"
        subtitle={encounter ? formatDate(encounter.encounter_date) : undefined}
        right={
          encounter ? (
            <View
              style={{
                backgroundColor: signed ? colors.mint : colors.paleYellow,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: 5,
              }}
            >
              <Text variant="micro" color={signed ? colors.green : colors.warning}>
                {signed ? 'Signed' : 'Draft'}
              </Text>
            </View>
          ) : undefined
        }
      />

      {query.isPending ? (
        <SkeletonList count={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : encounter ? (
        <>
          <Card flush>
            <View style={{ paddingHorizontal: spacing.lg }}>
              <SummaryRow
                label="Patient"
                value={encounter.patient_name || encounter.patient}
                strong
              />
              <SummaryRow
                label="Clinician"
                value={encounter.practitioner_name || encounter.practitioner}
              />
              <SummaryRow
                label="Date"
                value={formatDate(encounter.encounter_date)}
                last={!encounter.entered_on_behalf}
              />
              {/* Only shown when the typist is not the clinician -- for a doctor's
                  own note it is noise, but where they differ a clinical record
                  must say who entered it. */}
              {encounter.entered_on_behalf ? (
                <SummaryRow
                  label="Entered by"
                  value={encounter.entered_by_name || encounter.entered_by || '—'}
                  last
                />
              ) : null}
            </View>
          </Card>

          {clinicalVisible ? (
            <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
              <Card>
                <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
                  SYMPTOMS
                </Text>
                <Text variant="body">
                  {encounter.symptoms?.length ? encounter.symptoms.join(', ') : 'None recorded'}
                </Text>
              </Card>

              <Card>
                <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
                  ASSESSMENT
                </Text>
                <Text variant="body">
                  {encounter.diagnosis?.length ? encounter.diagnosis.join(', ') : 'None recorded'}
                </Text>
              </Card>

              <Card>
                <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
                  CLINICAL NOTES
                </Text>
                <Text variant="body">
                  {encounter.encounter_comment || 'No further notes.'}
                </Text>
              </Card>
            </View>
          ) : (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="bodySmall" muted>
                Clinical details are restricted to the treating clinician.
              </Text>
            </Card>
          )}

          {!signed && permissions.canCreateEncounter ? (
            <View style={{ marginTop: spacing.xxl }}>
              <Button
                label="Sign note"
                onPress={confirmSign}
                loading={submit.isPending}
                disabled={submit.isPending}
              />
              <Text variant="micro" muted align="center" style={{ marginTop: spacing.md }}>
                Signing locks the note permanently.
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
