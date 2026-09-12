/**
 * Activity -- the doctor's replacement for the Billing tab.
 *
 * Only events the backend can actually evidence are listed: appointments and
 * encounters. There is no audit-log endpoint, so nothing here is invented to
 * fill the screen; see docs/06_KNOWN_LIMITATIONS.md.
 */

import { useMemo } from 'react';
import { SectionList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { CalendarCheck, FileText } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import * as appointmentsApi from '@/api/appointments';
import * as encountersApi from '@/api/encounters';
import { queryKeys } from '@/api/queryClient';
import { usePermissions } from '@/stores/auth';
import { addDays, formatTime, relativeDayLabel, toBackendDate, todayBackendDate } from '@/utils/date';
import { colors, radius, screenPadding, spacing, tabBarClearance } from '@/theme';

type ActivityItem = {
  id: string;
  date: string;
  title: string;
  detail: string;
  kind: 'appointment' | 'encounter';
};

export default function ActivityScreen() {
  const router = useRouter();
  const { canViewClinicalNotes } = usePermissions();

  const from = toBackendDate(addDays(new Date(), -7));
  const to = todayBackendDate();

  const [appointmentsQuery, encountersQuery] = useQueries({
    queries: [
      {
        queryKey: queryKeys.appointments({ activity: true, from, to }),
        queryFn: () =>
          appointmentsApi.listAppointments({ from_date: from, to_date: to, limit: 100 }),
      },
      {
        queryKey: queryKeys.encounters({ activity: true }),
        queryFn: () => encountersApi.listEncounters({ limit: 50 }),
        enabled: canViewClinicalNotes,
      },
    ],
  });

  const sections = useMemo(() => {
    const items: ActivityItem[] = [];

    for (const appointment of appointmentsQuery.data?.items ?? []) {
      items.push({
        id: `appt-${appointment.name}`,
        date: appointment.appointment_date,
        title: `${appointment.patient_name || appointment.patient}`,
        detail: `${appointment.status} · ${formatTime(appointment.appointment_time)}`,
        kind: 'appointment',
      });
    }

    for (const encounter of encountersQuery.data?.items ?? []) {
      items.push({
        id: `enc-${encounter.name}`,
        date: encounter.encounter_date,
        title: `Consultation note · ${encounter.patient_name || encounter.patient}`,
        detail: encounter.docstatus === 1 ? 'Submitted' : 'Draft',
        kind: 'encounter',
      });
    }

    const byDate = new Map<string, ActivityItem[]>();
    for (const item of items) {
      const bucket = byDate.get(item.date) ?? [];
      bucket.push(item);
      byDate.set(item.date, bucket);
    }

    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, data]) => ({ title: relativeDayLabel(date), data }));
  }, [appointmentsQuery.data, encountersQuery.data]);

  const isPending = appointmentsQuery.isPending;

  return (
    <Screen scroll={false} withTabBar padded={false}>
      <View style={{ paddingHorizontal: screenPadding }}>
        <ScreenHeader title="Activity" subtitle="The last seven days" />
      </View>

      {isPending ? (
        <View style={{ paddingHorizontal: screenPadding }}>
          <SkeletonList count={5} />
        </View>
      ) : appointmentsQuery.isError ? (
        <View style={{ paddingHorizontal: screenPadding }}>
          <ErrorState
            error={appointmentsQuery.error}
            onRetry={() => void appointmentsQuery.refetch()}
          />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{
            paddingHorizontal: screenPadding,
            paddingBottom: tabBarClearance,
          }}
          refreshing={appointmentsQuery.isRefetching}
          onRefresh={() => void appointmentsQuery.refetch()}
          renderSectionHeader={({ section }) => (
            <Text
              variant="label"
              muted
              style={{ marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.6 }}
            >
              {section.title.toUpperCase()}
            </Text>
          )}
          renderItem={({ item }) => (
            <Card style={{ marginBottom: spacing.sm }} padding={spacing.md}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.md,
                    backgroundColor: item.kind === 'encounter' ? colors.mint : colors.peach,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.kind === 'encounter' ? (
                    <FileText size={16} color={colors.green} strokeWidth={1.8} />
                  ) : (
                    <CalendarCheck size={16} color={colors.brown} strokeWidth={1.8} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="cardTitle" numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text variant="micro" muted style={{ marginTop: 2 }}>
                    {item.detail}
                  </Text>
                </View>
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              title="Nothing recent"
              message="Activity from the last week will appear here."
            />
          }
        />
      )}
    </Screen>
  );
}
