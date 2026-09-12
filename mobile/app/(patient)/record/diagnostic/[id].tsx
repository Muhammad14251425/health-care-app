/**
 * One lab / diagnostic result.
 *
 * Only signed-off results reach this screen -- the server refuses anything still
 * mid-workflow, because showing a patient an unvalidated number is precisely the
 * harm the filtering exists to prevent.
 */

import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import { BackHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { formatDateLong } from '@/utils/date';
import { colors, spacing, typography } from '@/theme';

export default function PatientDiagnosticScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: queryKeys.patientDiagnostic(id ?? ''),
    queryFn: () => patientApi.diagnostic(id!),
    enabled: Boolean(id),
  });

  const result = query.data;

  return (
    <Screen>
      <BackHeader title="Result" />

      {query.isError ? (
        <View style={{ marginTop: spacing.lg }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </View>
      ) : query.isLoading || !result ? (
        <SkeletonList count={3} />
      ) : (
        <>
          <Card style={{ marginTop: spacing.lg }}>
            <Text style={typography.heading2}>{result.test_name ?? 'Result'}</Text>
            <Text variant="caption" muted style={{ marginTop: 4 }}>
              {result.date ? formatDateLong(result.date) : '—'}
              {result.practitioner_name ? ` · ${result.practitioner_name}` : ''}
            </Text>
            <View style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
              <StatusPill status={result.status} kind="appointment" label={result.status} />
            </View>
          </Card>

          {result.results?.length ? (
            <>
              <SectionHeader title="Results" style={{ marginTop: spacing.xl }} />
              <Card flush>
                {result.results.map((row, index) => (
                  <View
                    key={`${row.test}-${index}`}
                    style={{
                      paddingVertical: spacing.md,
                      paddingHorizontal: spacing.lg,
                      borderBottomWidth: index === result.results.length - 1 ? 0 : 1,
                      borderBottomColor: colors.line,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text variant="caption" style={{ flex: 1 }}>
                        {row.test}
                      </Text>
                      <Text variant="body">
                        {row.result ?? '—'}
                        {row.uom ? ` ${row.uom}` : ''}
                      </Text>
                    </View>
                    {row.reference ? (
                      <Text variant="micro" muted style={{ marginTop: 2 }}>
                        Reference: {row.reference}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </Card>
            </>
          ) : (
            <Card style={{ marginTop: spacing.xl }}>
              <Text variant="caption" muted>
                The detailed values for this test are not available in the app.
                Please ask the clinic for a printed copy.
              </Text>
            </Card>
          )}

          {result.comment ? (
            <>
              <SectionHeader title="Comment" style={{ marginTop: spacing.xl }} />
              <Card>
                <Text variant="caption">{result.comment}</Text>
              </Card>
            </>
          ) : null}

          <Text variant="micro" muted style={{ marginTop: spacing.xl }} align="center">
            Results are best understood with your doctor. Please do not act on
            them alone.
          </Text>
        </>
      )}
    </Screen>
  );
}
