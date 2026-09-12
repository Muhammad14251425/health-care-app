/**
 * The Records tab: visit history, prescriptions and (where the clinic runs a
 * lab) diagnostic results.
 *
 * What appears here is decided by the SERVER. `patient_records.visit` builds a
 * patient-safe projection field by field -- clinical notes and internal
 * commentary are never in the response, so there is nothing for this screen to
 * hide. Diagnostics are shown only when `diagnostics_enabled` is true; a clinic
 * without a lab is a normal deployment, not an error state.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, FlaskConical, Pill, Stethoscope } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { FilterPillRow } from '@/components/ui/FilterPill';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { formatDate } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';

type Section = 'visits' | 'prescriptions' | 'diagnostics';

export default function PatientRecordsScreen() {
  const [section, setSection] = useState<Section>('visits');

  const summary = useQuery({
    queryKey: queryKeys.patientRecordsSummary,
    queryFn: patientApi.recordsSummary,
  });

  const visits = useQuery({
    queryKey: queryKeys.patientVisits,
    queryFn: () => patientApi.visits(),
    enabled: section === 'visits',
  });

  const prescriptions = useQuery({
    queryKey: queryKeys.patientPrescriptions,
    queryFn: () => patientApi.prescriptions(),
    enabled: section === 'prescriptions',
  });

  const diagnostics = useQuery({
    queryKey: queryKeys.patientDiagnostics,
    queryFn: () => patientApi.diagnostics(),
    enabled: section === 'diagnostics',
  });

  // The lab module is optional -- do not offer a tab the clinic cannot fill.
  const labEnabled = summary.data?.diagnostics_enabled ?? false;

  const sections: Array<{ value: Section; label: string; count?: number }> = [
    { value: 'visits', label: 'Visits', count: summary.data?.visits },
    {
      value: 'prescriptions',
      label: 'Prescriptions',
      count: summary.data?.prescriptions,
    },
    ...(labEnabled
      ? [
          {
            value: 'diagnostics' as const,
            label: 'Lab results',
            count: summary.data?.diagnostics,
          },
        ]
      : []),
  ];

  const active =
    section === 'visits' ? visits : section === 'prescriptions' ? prescriptions : diagnostics;

  return (
    <Screen
      withTabBar
      onRefresh={() => {
        void summary.refetch();
        void active.refetch();
      }}
      refreshing={active.isRefetching}
    >
      <ScreenHeader title="Records" subtitle="Your visits, medicines and results" />

      <View style={{ marginTop: spacing.md }}>
        <FilterPillRow options={sections} value={section} onChange={setSection} />
      </View>

      <View style={{ marginTop: spacing.lg }}>
        {active.isError ? (
          <ErrorState error={active.error} onRetry={() => void active.refetch()} />
        ) : active.isLoading ? (
          <SkeletonList count={4} />
        ) : section === 'visits' ? (
          <VisitList items={visits.data?.items ?? []} />
        ) : section === 'prescriptions' ? (
          <PrescriptionList items={prescriptions.data?.items ?? []} />
        ) : (
          <DiagnosticList items={diagnostics.data?.items ?? []} />
        )}
      </View>
    </Screen>
  );
}

function VisitList({ items }: { items: Awaited<ReturnType<typeof patientApi.visits>>['items'] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Stethoscope size={26} color={colors.green} strokeWidth={1.6} />}
        title="No visits yet"
        message="Your completed visits will appear here."
      />
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((visit) => {
        // Only a visit with a written-up encounter has anything to open.
        const openable = visit.has_record && visit.encounter;
        const body = (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar name={visit.practitioner_name ?? visit.practitioner ?? '?'} size={44} />
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1}>
                  {visit.practitioner_name ?? visit.practitioner ?? 'Clinic visit'}
                </Text>
                <Text variant="caption" muted numberOfLines={1}>
                  {formatDate(visit.date)} · {visit.department ?? 'General'}
                </Text>
                {visit.appointment_type ? (
                  <Text variant="micro" muted style={{ marginTop: 2 }}>
                    {visit.appointment_type}
                  </Text>
                ) : null}
              </View>
              {openable ? (
                <View
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 4,
                    borderRadius: radius.pill,
                    backgroundColor: colors.mint,
                  }}
                >
                  <Text variant="micro" color={colors.green}>
                    Record
                  </Text>
                </View>
              ) : null}
            </View>
          </Card>
        );

        if (!openable) return <View key={visit.id}>{body}</View>;
        return (
          <Pressable
            key={visit.id}
            onPress={() => router.push(`/(patient)/record/visit/${visit.encounter}`)}
            accessibilityRole="button"
            accessibilityLabel={`Visit record from ${formatDate(visit.date)}`}
          >
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}

function PrescriptionList({
  items,
}: {
  items: Awaited<ReturnType<typeof patientApi.prescriptions>>['items'];
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Pill size={26} color={colors.green} strokeWidth={1.6} />}
        title="No prescriptions"
        message="Medicines prescribed to you will appear here."
      />
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((item, index) => (
        <Card key={item.id ?? `${item.drug_name}-${index}`}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                backgroundColor: colors.peach,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Pill size={18} color={colors.brown} strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={2}>
                {item.drug_name ?? item.drug ?? 'Medicine'}
              </Text>
              {item.dosage || item.period ? (
                <Text variant="caption" muted style={{ marginTop: 2 }}>
                  {[item.dosage, item.period].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {item.comment ? (
                <Text variant="micro" muted style={{ marginTop: 2 }}>
                  {item.comment}
                </Text>
              ) : null}
              <Text variant="micro" muted style={{ marginTop: spacing.xs }}>
                {[item.practitioner_name, item.date ? formatDate(item.date) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

function DiagnosticList({
  items,
}: {
  items: Awaited<ReturnType<typeof patientApi.diagnostics>>['items'];
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConical size={26} color={colors.green} strokeWidth={1.6} />}
        title="No results yet"
        message="Completed lab and diagnostic results will appear here."
      />
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => router.push(`/(patient)/record/diagnostic/${item.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`${item.test_name ?? 'Result'} from ${
            item.date ? formatDate(item.date) : 'the clinic'
          }`}
        >
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.md,
                  backgroundColor: colors.mint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FileText size={18} color={colors.green} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1}>
                  {item.test_name ?? 'Result'}
                </Text>
                <Text variant="caption" muted>
                  {item.date ? formatDate(item.date) : '—'} · {item.status}
                </Text>
              </View>
            </View>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}
