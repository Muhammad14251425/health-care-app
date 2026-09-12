/**
 * Patient profile.
 *
 * Modelled on the reference's profile screen: large avatar, name, contact line,
 * three stats, then grouped rows with small icon tiles.
 *
 * Clinical sections appear only for roles the backend actually grants them to
 * (Physician). Reception and admin see scheduling and billing, not notes.
 */

import { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import {
  CalendarClock,
  FileText,
  History,
  Mail,
  Phone,
  Receipt,
  Stethoscope,
} from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { ProfileStat } from '@/components/ui/StatCard';
import { SettingsGroup, SettingsRow } from '@/components/ui/SettingsRow';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import * as patientsApi from '@/api/patients';
import * as invoicesApi from '@/api/invoices';
import { queryKeys } from '@/api/queryClient';
import { usePermissions } from '@/stores/auth';
import { formatCurrencyCompact } from '@/utils/currency';
import { todayBackendDate } from '@/utils/date';
import { colors, spacing } from '@/theme';

export default function PatientProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const permissions = usePermissions();

  const patientId = decodeURIComponent(String(id ?? ''));

  const [patientQuery, historyQuery, outstandingQuery, invoicesQuery] = useQueries({
    queries: [
      {
        queryKey: queryKeys.patient(patientId),
        queryFn: () => patientsApi.getPatient(patientId),
        enabled: Boolean(patientId),
      },
      {
        queryKey: queryKeys.visitHistory(patientId),
        queryFn: () => patientsApi.visitHistory(patientId),
        enabled: Boolean(patientId),
      },
      {
        queryKey: queryKeys.outstanding(patientId),
        queryFn: () => invoicesApi.outstanding(patientId),
        enabled: Boolean(patientId) && permissions.canViewBilling,
      },
      {
        // The Invoices row counts what the Invoices SCREEN will show, so the
        // two cannot disagree. `outstanding` above is a money figure and counts
        // submitted invoices only (docstatus 1) -- right for "Due", wrong for a
        // row that says "Invoices" and opens a list containing drafts too.
        queryKey: queryKeys.invoices({ scope: patientId }),
        queryFn: () => invoicesApi.listInvoices({ patient: patientId, limit: 200 }),
        enabled: Boolean(patientId) && permissions.canViewBilling,
      },
    ],
  });

  const patient = patientQuery.data;

  const stats = useMemo(() => {
    const appointments = historyQuery.data?.appointments ?? [];
    const today = todayBackendDate();
    const visits = appointments.filter((a) => a.status === 'Closed').length;
    const upcoming = appointments.filter(
      (a) => a.appointment_date >= today && a.status === 'Scheduled',
    ).length;

    return { visits, upcoming, due: outstandingQuery.data?.total_outstanding ?? 0 };
  }, [historyQuery.data, outstandingQuery.data]);

  return (
    <Screen
      onRefresh={() => {
        void patientQuery.refetch();
        void historyQuery.refetch();
      }}
      refreshing={patientQuery.isRefetching}
    >
      <BackHeader title="Patient" subtitle={patient?.name} />

      {patientQuery.isPending ? (
        <SkeletonList count={4} />
      ) : patientQuery.isError ? (
        <ErrorState error={patientQuery.error} onRetry={() => void patientQuery.refetch()} />
      ) : patient ? (
        <>
          <View style={{ alignItems: 'center', paddingBottom: spacing.xl }}>
            <Avatar name={patient.patient_name} size={72} />
            <Text variant="heading3" style={{ marginTop: spacing.md }}>
              {patient.patient_name}
            </Text>
            <Text variant="caption" muted style={{ marginTop: 3 }}>
              {[patient.mobile, patient.email].filter(Boolean).join(' · ') || 'No contact details'}
            </Text>

            {permissions.canEditPatient ? (
              <View style={{ marginTop: spacing.md, minWidth: 150 }}>
                <Button
                  label="Edit contact"
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    router.push(`/(app)/patient/${encodeURIComponent(patient.name)}/edit`)
                  }
                />
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl }}>
            <ProfileStat label="Visits" value={stats.visits} />
            <ProfileStat label="Upcoming" value={stats.upcoming} />
            {permissions.canViewBilling ? (
              <ProfileStat
                label="Due"
                value={formatCurrencyCompact(stats.due)}
              />
            ) : (
              <ProfileStat
                label="Records"
                value={historyQuery.data?.encounters.length ?? 0}
              />
            )}
          </View>

          <SectionHeader title="Contact information" />
          <SettingsGroup>
            <SettingsRow
              icon={<Phone size={16} color="#566057" strokeWidth={1.8} />}
              label="Phone"
              value={patient.mobile ?? '—'}
            />
            <SettingsRow
              icon={<Mail size={16} color="#566057" strokeWidth={1.8} />}
              label="Email"
              value={patient.email ?? '—'}
              last
            />
          </SettingsGroup>

          <SectionHeader title="Records" />
          <SettingsGroup>
            <SettingsRow
              icon={<History size={16} color="#566057" strokeWidth={1.8} />}
              label="Visit history"
              onPress={() =>
                router.push(`/(app)/patient/${encodeURIComponent(patient.name)}/history`)
              }
            />
            {permissions.canViewClinicalNotes ? (
              <SettingsRow
                icon={<FileText size={16} color="#566057" strokeWidth={1.8} />}
                label="Clinical notes"
                onPress={() =>
                  router.push(`/(app)/patient/${encodeURIComponent(patient.name)}/notes`)
                }
              />
            ) : null}
            {permissions.canViewBilling ? (
              <SettingsRow
                icon={<Receipt size={16} color="#566057" strokeWidth={1.8} />}
                label="Invoices"
                value={
                  invoicesQuery.data ? `${invoicesQuery.data.total}` : undefined
                }
                // This patient's own invoices, not the clinic-wide ledger. Its
                // own route (not the Billing tab) so back returns here.
                onPress={() =>
                  router.push(
                    `/(app)/patient/${encodeURIComponent(patient.name)}/invoices`,
                  )
                }
              />
            ) : null}
            <SettingsRow
              icon={<CalendarClock size={16} color="#566057" strokeWidth={1.8} />}
              label="Book appointment"
              onPress={() =>
                router.push(
                  `/(app)/appointment/new?patient=${encodeURIComponent(patient.name)}`,
                )
              }
              last
            />
          </SettingsGroup>

          {permissions.canCreateEncounter ? (
            <View style={{ marginTop: spacing.md }}>
              <Button
                label="New consultation note"
                variant="ghost"
                onPress={() =>
                  router.push(
                    `/(app)/encounter/new?patient=${encodeURIComponent(patient.name)}`,
                  )
                }
              />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
