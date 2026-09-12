/**
 * Appointment detail.
 *
 * Actions are driven by Marley's real status model, not invented transitions.
 * The backend's `set_status` allowlist is exactly: Scheduled, Open, Closed,
 * Cancelled, No Show, Checked In -- so the buttons below only ever move an
 * appointment between those, and only the ones that make sense from the current
 * status are shown.
 */

import { useMemo } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { SummaryRow } from '@/components/ui/SummaryRow';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as appointmentsApi from '@/api/appointments';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { usePermissions } from '@/stores/auth';
import { formatDateLong, formatTime } from '@/utils/date';
import { spacing } from '@/theme';
import type { AppointmentStatus } from '@/types/domain';

/**
 * Which status changes are offered from where. Marley does not publish a formal
 * state machine, so this encodes the sensible clinical path and nothing more --
 * every one of these targets is in the backend's allowlist.
 */
const NEXT_ACTIONS: Partial<
  Record<AppointmentStatus, Array<{ status: AppointmentStatus; label: string }>>
> = {
  Scheduled: [
    { status: 'Checked In', label: 'Check in' },
    { status: 'No Show', label: 'Mark no show' },
  ],
  'Checked In': [
    { status: 'Open', label: 'Start visit' },
    { status: 'Closed', label: 'Complete' },
  ],
  Open: [{ status: 'Closed', label: 'Complete' }],
};

export default function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const permissions = usePermissions();

  const appointmentId = decodeURIComponent(String(id ?? ''));

  const query = useQuery({
    queryKey: queryKeys.appointment(appointmentId),
    queryFn: () => appointmentsApi.getAppointment(appointmentId),
    enabled: Boolean(appointmentId),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.appointment(appointmentId) }),
      queryClient.invalidateQueries({ queryKey: ['appointments'] }),
    ]);
  };

  const statusMutation = useMutation({
    mutationFn: (status: AppointmentStatus) =>
      appointmentsApi.setStatus(appointmentId, status),
    onSuccess: async (_data, status) => {
      await invalidate();
      toast.success(`Appointment marked ${status.toLowerCase()}`);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not update the appointment.',
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => appointmentsApi.cancelAppointment(appointmentId),
    onSuccess: async () => {
      await invalidate();
      toast.success('Appointment cancelled');
      router.back();
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not cancel the appointment.',
      );
    },
  });

  const appointment = query.data;

  const actions = useMemo(() => {
    if (!appointment || !permissions.canManageAppointmentStatus) return [];
    return NEXT_ACTIONS[appointment.status] ?? [];
  }, [appointment, permissions.canManageAppointmentStatus]);

  const confirmCancel = () => {
    Alert.alert(
      'Cancel appointment',
      'This will free the slot and notify the clinic. Continue?',
      [
        { text: 'Keep appointment', style: 'cancel' },
        {
          text: 'Cancel appointment',
          style: 'destructive',
          onPress: () => cancelMutation.mutate(),
        },
      ],
    );
  };

  const closed =
    appointment?.status === 'Cancelled' ||
    appointment?.status === 'Closed' ||
    appointment?.status === 'No Show';

  return (
    <Screen>
      <BackHeader
        title="Appointment"
        subtitle={appointment?.name}
        right={
          appointment ? (
            <StatusPill status={appointment.status} kind="appointment" />
          ) : undefined
        }
      />

      {query.isPending ? (
        <SkeletonList count={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : appointment ? (
        <>
          <Card flush>
            <View style={{ paddingHorizontal: spacing.lg }}>
              <SummaryRow
                label="Patient"
                value={appointment.patient_name || appointment.patient}
                strong
              />
              <SummaryRow label="Doctor" value={appointment.practitioner_name} />
              <SummaryRow label="Department" value={appointment.department ?? '—'} />
              <SummaryRow label="Date" value={formatDateLong(appointment.appointment_date)} />
              <SummaryRow
                label="Time"
                value={formatTime(appointment.appointment_time)}
                strong
              />
              <SummaryRow label="Duration" value={`${appointment.duration} minutes`} />
              <SummaryRow
                label="Type"
                value={appointment.appointment_type ?? 'Consultation'}
                last={!appointment.notes}
              />
              {appointment.notes ? (
                <SummaryRow label="Notes" value={appointment.notes} last />
              ) : null}
            </View>
          </Card>

          {!closed ? (
            <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
              {actions.map((action) => (
                <Button
                  key={action.status}
                  label={action.label}
                  loading={statusMutation.isPending}
                  disabled={statusMutation.isPending || cancelMutation.isPending}
                  onPress={() => statusMutation.mutate(action.status)}
                />
              ))}

              {permissions.canCreateAppointment ? (
                <Button
                  label="Reschedule"
                  variant="secondary"
                  disabled={statusMutation.isPending || cancelMutation.isPending}
                  onPress={() =>
                    router.push(
                      `/(app)/appointment/${encodeURIComponent(appointment.name)}/reschedule`,
                    )
                  }
                />
              ) : null}

              {permissions.canManageAppointmentStatus ? (
                <Button
                  label="Cancel appointment"
                  variant="danger"
                  loading={cancelMutation.isPending}
                  disabled={statusMutation.isPending || cancelMutation.isPending}
                  onPress={confirmCancel}
                />
              ) : null}
            </View>
          ) : (
            <Text variant="caption" muted align="center" style={{ marginTop: spacing.xl }}>
              This appointment is {appointment.status.toLowerCase()} and can no longer be changed.
            </Text>
          )}

          {permissions.canCreateEncounter && !closed ? (
            <View style={{ marginTop: spacing.md }}>
              <Button
                label="Write consultation note"
                variant="ghost"
                onPress={() =>
                  router.push(
                    `/(app)/encounter/new?patient=${encodeURIComponent(
                      appointment.patient,
                    )}&appointment=${encodeURIComponent(appointment.name)}`,
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
