/**
 * One of the patient's own appointments.
 *
 * The id in the URL is a lookup key, not a claim of ownership: the server
 * re-derives the owning patient and returns the same "not found" for someone
 * else's appointment as for one that does not exist. Nothing here depends on
 * the id having been reached through the app's own navigation.
 *
 * `notes` is the reason the patient gave at booking. Internal staff commentary
 * is not part of the response.
 */

import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, X } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { messageForError } from '@/api/errors';
import { formatDateLong, formatTime } from '@/utils/date';
import { colors, spacing, typography } from '@/theme';

export default function PatientAppointmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.patientAppointment(id ?? ''),
    queryFn: () => patientApi.getAppointment(id!),
    enabled: Boolean(id),
  });

  const appointment = query.data;

  const cancel = useMutation({
    mutationFn: () => patientApi.cancelAppointment(id!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['patient'] });
      toast.success('Appointment cancelled.');
      router.back();
    },
    onError: (error) => toast.error(messageForError(error)),
  });

  const confirmCancel = () => {
    Alert.alert(
      'Cancel appointment?',
      'This frees the slot for someone else. You can book again if you change your mind.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel appointment',
          style: 'destructive',
          onPress: () => cancel.mutate(),
        },
      ],
    );
  };

  return (
    <Screen>
      <BackHeader title="Appointment" />

      {query.isError ? (
        <View style={{ marginTop: spacing.lg }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </View>
      ) : query.isLoading || !appointment ? (
        <SkeletonList count={3} />
      ) : (
        <>
          <Card style={{ marginTop: spacing.lg, alignItems: 'center' }}>
            <Avatar
              name={appointment.practitioner_name ?? appointment.practitioner}
              size={64}
            />
            <Text style={[typography.heading2, { marginTop: spacing.md }]}>
              {appointment.practitioner_name ?? appointment.practitioner}
            </Text>
            <Text variant="caption" muted style={{ marginTop: 2 }}>
              {appointment.department ??
                appointment.practitioner_department ??
                'General'}
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <StatusPill status={appointment.status} kind="appointment" />
            </View>
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Row label="Date" value={formatDateLong(appointment.appointment_date)} />
            <Row label="Time" value={formatTime(appointment.appointment_time)} />
            <Row
              label="Duration"
              value={appointment.duration ? `${appointment.duration} minutes` : '—'}
            />
            <Row label="Type" value={appointment.appointment_type ?? 'Consultation'} />
            <Row label="Reference" value={appointment.name} last={!appointment.notes} />
            {appointment.notes ? (
              <View style={{ paddingTop: spacing.sm }}>
                <Text variant="caption" muted>
                  Reason for visit
                </Text>
                <Text variant="caption" style={{ marginTop: 4 }}>
                  {appointment.notes}
                </Text>
              </View>
            ) : null}
          </Card>

          {/* Actions appear only when the server says they are allowed. */}
          {appointment.can_reschedule ? (
            <Button
              label="Reschedule"
              variant="secondary"
              icon={<CalendarClock size={17} color={colors.green} strokeWidth={1.9} />}
              onPress={() =>
                router.push(`/(patient)/appointment/${appointment.name}/reschedule`)
              }
              fullWidth
              style={{ marginTop: spacing.lg }}
            />
          ) : null}

          {appointment.can_cancel ? (
            <Button
              label="Cancel appointment"
              variant="danger"
              icon={<X size={17} color={colors.white} strokeWidth={2} />}
              onPress={confirmCancel}
              loading={cancel.isPending}
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          ) : null}

          {!appointment.can_cancel && !appointment.can_reschedule ? (
            <Text variant="micro" muted style={{ marginTop: spacing.lg }} align="center">
              This appointment can no longer be changed. Contact the clinic if you
              need help.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="caption" style={{ flexShrink: 1 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
