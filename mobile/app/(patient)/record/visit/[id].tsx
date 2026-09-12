/**
 * One visit's record, as the patient may see it.
 *
 * Everything rendered here arrived in the response. The clinician's private
 * notes are not filtered out on this screen -- they were never sent, because
 * `patient_records.visit` builds its payload from an allowlist server-side.
 * That distinction matters: filtering in the client would leave the text in the
 * JSON on the wire.
 */

import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Pill, Stethoscope, TestTube } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { BackHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { formatDateLong, formatTime } from '@/utils/date';
import { colors, radius, spacing, typography } from '@/theme';

export default function PatientVisitRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: queryKeys.patientVisit(id ?? ''),
    queryFn: () => patientApi.visit(id!),
    enabled: Boolean(id),
  });

  const record = query.data;

  return (
    <Screen>
      <BackHeader title="Visit record" />

      {query.isError ? (
        <View style={{ marginTop: spacing.lg }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </View>
      ) : query.isLoading || !record ? (
        <SkeletonList count={4} />
      ) : (
        <>
          <Card style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar
                name={record.practitioner_name ?? record.practitioner ?? '?'}
                size={48}
              />
              <View style={{ flex: 1 }}>
                <Text variant="body">
                  {record.practitioner_name ?? record.practitioner ?? 'Clinic visit'}
                </Text>
                <Text variant="caption" muted>
                  {record.medical_department ?? 'General'}
                </Text>
                <Text variant="caption" style={{ marginTop: 2 }}>
                  {formatDateLong(record.encounter_date)}
                  {record.encounter_time ? ` · ${formatTime(record.encounter_time)}` : ''}
                </Text>
              </View>
            </View>
          </Card>

          {/* Symptoms and diagnosis are lists: Marley stores them as child rows
              linking to the Complaint / Diagnosis masters. */}
          {record.symptoms?.length ? (
            <>
              <SectionHeader title="Reported symptoms" style={{ marginTop: spacing.xl }} />
              <Card>
                <ChipList items={record.symptoms} tint={colors.peach} fg={colors.brown} />
              </Card>
            </>
          ) : null}

          {record.diagnosis?.length ? (
            <>
              <SectionHeader title="Diagnosis" style={{ marginTop: spacing.xl }} />
              <Card>
                <ChipList items={record.diagnosis} tint={colors.mint} fg={colors.green} />
              </Card>
            </>
          ) : null}

          {record.prescriptions?.length ? (
            <>
              <SectionHeader title="Prescription" style={{ marginTop: spacing.xl }} />
              <View style={{ gap: spacing.sm }}>
                {record.prescriptions.map((item, index) => (
                  <Card key={`${item.drug_name ?? item.drug}-${index}`}>
                    <View style={{ flexDirection: 'row', gap: spacing.md }}>
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: radius.md,
                          backgroundColor: colors.peach,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Pill size={17} color={colors.brown} strokeWidth={1.8} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="body">{item.drug_name ?? item.drug}</Text>
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
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            </>
          ) : null}

          {record.lab_requests?.length ? (
            <>
              <SectionHeader title="Tests ordered" style={{ marginTop: spacing.xl }} />
              <View style={{ gap: spacing.sm }}>
                {record.lab_requests.map((item, index) => (
                  <Card key={`${item.test_name ?? item.template}-${index}`}>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
                    >
                      <TestTube size={17} color={colors.green} strokeWidth={1.8} />
                      <View style={{ flex: 1 }}>
                        <Text variant="caption">
                          {item.test_name ?? item.template}
                        </Text>
                        {item.comment ? (
                          <Text variant="micro" muted>
                            {item.comment}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            </>
          ) : null}

          {!record.symptoms?.length &&
          !record.diagnosis?.length &&
          !record.prescriptions?.length &&
          !record.lab_requests?.length ? (
            <Card style={{ marginTop: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
              <Stethoscope size={24} color={colors.green} strokeWidth={1.6} />
              <Text variant="caption" muted align="center">
                This visit has no shared details. Ask the clinic if you need a
                copy of your record.
              </Text>
            </Card>
          ) : null}

          <Text variant="micro" muted style={{ marginTop: spacing.xl }} align="center">
            This is a summary for your reference. Speak to your doctor about
            anything you are unsure of.
          </Text>
        </>
      )}
    </Screen>
  );
}

function ChipList({
  items,
  tint,
  fg,
}: {
  items: string[];
  tint: string;
  fg: string;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {items.map((item) => (
        <View
          key={item}
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: 6,
            borderRadius: radius.pill,
            backgroundColor: tint,
          }}
        >
          <Text style={[typography.micro, { color: fg }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}
