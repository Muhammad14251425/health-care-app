/**
 * Appointment row/card.
 *
 * `compact` is the dashboard variant (a time rail on the left, name, status);
 * the full variant adds the doctor, type and a notes preview for the list screen.
 */

import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatTime } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';
import type { Appointment } from '@/types/domain';

export type AppointmentCardProps = {
  appointment: Appointment;
  onPress?: () => void;
  compact?: boolean;
  /** Hide the practitioner line when the list is already scoped to one doctor. */
  hidePractitioner?: boolean;
};

/** Soft thumbnail tints, cycled so a list does not read as one grey block. */
const TINTS = [colors.peach, colors.mint, colors.paleYellow];

export function AppointmentCard({
  appointment,
  onPress,
  compact = false,
  hidePractitioner = false,
}: AppointmentCardProps) {
  // Stable per appointment so a row keeps its colour across refetches.
  const tint = TINTS[appointment.name.length % TINTS.length];

  const body = (
    <Card style={{ marginBottom: spacing.sm }} padding={compact ? spacing.md : spacing.lg}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: 54,
            paddingVertical: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: tint,
            alignItems: 'center',
          }}
        >
          <Text variant="micro" style={{ fontSize: 11, color: '#4A4B45' }}>
            {formatTime(appointment.appointment_time)}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text variant="cardTitle" numberOfLines={1}>
            {appointment.patient_name || appointment.patient}
          </Text>
          <Text variant="caption" muted numberOfLines={1} style={{ marginTop: 2 }}>
            {[
              appointment.appointment_type || 'Consultation',
              hidePractitioner ? null : appointment.practitioner_name,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          {!compact && appointment.notes ? (
            <Text variant="micro" muted numberOfLines={1} style={{ marginTop: 4 }}>
              {appointment.notes}
            </Text>
          ) : null}
        </View>

        <StatusPill status={appointment.status} kind="appointment" />
      </View>
    </Card>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Appointment for ${appointment.patient_name} at ${formatTime(
        appointment.appointment_time,
      )}`}
    >
      {body}
    </Pressable>
  );
}
