/**
 * Clinical notes for one patient.
 *
 * The route is only linked for roles with clinical access, but it re-checks
 * anyway -- and if someone reaches it regardless, the backend's 403 renders as a
 * clean permission message.
 */

import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, Lock, Plus } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import * as encountersApi from '@/api/encounters';
import { queryKeys } from '@/api/queryClient';
import { usePermissions } from '@/stores/auth';
import { formatDate } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';
import { Pressable } from 'react-native';

export default function PatientNotes() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const permissions = usePermissions();
  const patientId = decodeURIComponent(String(id ?? ''));

  const query = useQuery({
    queryKey: queryKeys.encounters({ patient: patientId }),
    queryFn: () => encountersApi.listEncounters({ patient: patientId, limit: 50 }),
    enabled: Boolean(patientId) && permissions.canViewClinicalNotes,
  });

  if (!permissions.canViewClinicalNotes) {
    return (
      <Screen>
        <BackHeader title="Clinical notes" />
        <EmptyState
          icon={<Lock size={24} color={colors.brown} strokeWidth={1.6} />}
          title="Not available to you"
          message="Clinical notes are restricted to the treating clinician."
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <BackHeader title="Clinical notes" subtitle={patientId} />

      {query.isPending ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No notes yet"
          message="Consultation notes for this patient will appear here."
          action={
            permissions.canCreateEncounter
              ? {
                  label: 'Write a note',
                  onPress: () =>
                    router.push(
                      `/(app)/encounter/new?patient=${encodeURIComponent(patientId)}`,
                    ),
                }
              : undefined
          }
        />
      ) : (
        <>
          {query.data?.items.map((encounter) => (
            <Pressable
              key={encounter.name}
              onPress={() =>
                router.push(`/(app)/encounter/${encodeURIComponent(encounter.name)}`)
              }
              accessibilityRole="button"
              accessibilityLabel={`Note from ${formatDate(encounter.encounter_date)}`}
            >
              <Card style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: radius.md,
                      backgroundColor: colors.mint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <FileText size={17} color={colors.green} strokeWidth={1.8} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="cardTitle">{formatDate(encounter.encounter_date)}</Text>
                    <Text variant="caption" muted style={{ marginTop: 2 }}>
                      {encounter.practitioner_name || encounter.practitioner}
                    </Text>
                  </View>
                  <Text variant="micro" muted>
                    {encounter.docstatus === 1 ? 'Signed' : 'Draft'}
                  </Text>
                </View>
              </Card>
            </Pressable>
          ))}

          {permissions.canCreateEncounter ? (
            <View style={{ marginTop: spacing.lg }}>
              <Button
                label="New note"
                icon={<Plus size={16} color={colors.white} strokeWidth={2.2} />}
                onPress={() =>
                  router.push(`/(app)/encounter/new?patient=${encodeURIComponent(patientId)}`)
                }
              />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
