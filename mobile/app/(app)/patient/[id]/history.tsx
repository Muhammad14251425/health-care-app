/**
 * Visit history -- a vertical timeline of appointments and encounters.
 *
 * Clinical detail is not shown here even to a doctor: the list endpoint does not
 * return it. Tapping a note opens the encounter screen, where the backend
 * decides what the caller may see.
 */

import { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import * as patientsApi from '@/api/patients';
import { queryKeys } from '@/api/queryClient';
import { usePermissions } from '@/stores/auth';
import { formatDate, formatTime } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';

type TimelineEntry = {
  id: string;
  date: string;
  kind: 'appointment' | 'encounter';
  title: string;
  detail: string;
  status?: string;
};

export default function VisitHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const permissions = usePermissions();
  const patientId = decodeURIComponent(String(id ?? ''));

  const query = useQuery({
    queryKey: queryKeys.visitHistory(patientId),
    queryFn: () => patientsApi.visitHistory(patientId),
    enabled: Boolean(patientId),
  });

  const entries = useMemo<TimelineEntry[]>(() => {
    const items: TimelineEntry[] = [];

    for (const appointment of query.data?.appointments ?? []) {
      items.push({
        id: `appt-${appointment.name}`,
        date: appointment.appointment_date,
        kind: 'appointment',
        title: appointment.practitioner,
        detail: `${appointment.department ?? 'Consultation'} · ${formatTime(
          appointment.appointment_time,
        )}`,
        status: appointment.status,
      });
    }

    // Encounters are only listed for roles that may open them.
    if (permissions.canViewClinicalNotes) {
      for (const encounter of query.data?.encounters ?? []) {
        items.push({
          id: `enc-${encounter.name}`,
          date: encounter.encounter_date,
          kind: 'encounter',
          title: `Consultation note · ${encounter.practitioner}`,
          detail: encounter.docstatus === 1 ? 'Signed' : 'Draft',
        });
      }
    }

    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [query.data, permissions.canViewClinicalNotes]);

  return (
    <Screen onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <BackHeader title="Visit history" subtitle={patientId} />

      {query.isPending ? (
        <SkeletonList count={5} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No visits yet"
          message="This patient has no recorded appointments."
        />
      ) : (
        entries.map((entry, index) => (
          <View key={entry.id} style={{ flexDirection: 'row', gap: spacing.md }}>
            {/* Timeline rail */}
            <View style={{ alignItems: 'center', width: 14 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  marginTop: spacing.lg,
                  backgroundColor:
                    entry.kind === 'encounter' ? colors.green : colors.gold,
                }}
              />
              {index < entries.length - 1 ? (
                <View style={{ flex: 1, width: 2, backgroundColor: colors.line }} />
              ) : null}
            </View>

            <View style={{ flex: 1 }}>
              <Text variant="micro" muted style={{ marginTop: spacing.md }}>
                {formatDate(entry.date)}
              </Text>
              <Card
                style={{ marginTop: 4, marginBottom: spacing.md }}
                padding={spacing.md}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="cardTitle" numberOfLines={1}>
                      {entry.title}
                    </Text>
                    <Text variant="caption" muted style={{ marginTop: 2 }}>
                      {entry.detail}
                    </Text>
                  </View>
                  {entry.status ? (
                    <StatusPill status={entry.status} kind="appointment" />
                  ) : (
                    <View
                      style={{
                        backgroundColor: colors.mint,
                        borderRadius: radius.pill,
                        paddingHorizontal: spacing.md,
                        paddingVertical: 5,
                      }}
                    >
                      <Text variant="micro" color={colors.green}>
                        Note
                      </Text>
                    </View>
                  )}
                </View>
              </Card>
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}
