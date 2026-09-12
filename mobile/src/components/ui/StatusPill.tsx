/**
 * Status pill.
 *
 * All colour comes from the central tone maps in theme/colors.ts, so a status
 * can never pick up a different colour on a different screen.
 */

import { View, type StyleProp, type ViewStyle } from 'react-native';
import {
  appointmentStatusTone,
  colors,
  invoiceStatusTone,
  radius,
  spacing,
  typography,
  type StatusTone,
} from '@/theme';
import type { AppointmentStatus, PaymentStatus } from '@/types/domain';
import { Text } from './Text';

const FALLBACK: StatusTone = { bg: colors.line, fg: colors.muted, label: 'Unknown' };

export type StatusPillProps = {
  /** Raw backend status value. */
  status: string;
  kind?: 'appointment' | 'invoice';
  /** Override the displayed text while keeping the tone. */
  label?: string;
  style?: StyleProp<ViewStyle>;
};

export function toneFor(status: string, kind: 'appointment' | 'invoice'): StatusTone {
  const map = kind === 'invoice' ? invoiceStatusTone : appointmentStatusTone;
  return map[status] ?? { ...FALLBACK, label: status || FALLBACK.label };
}

export function StatusPill({
  status,
  kind = 'appointment',
  label,
  style,
}: StatusPillProps) {
  const tone = toneFor(status, kind);
  return (
    <View
      style={[
        {
          backgroundColor: tone.bg,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          paddingVertical: 5,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Text style={[typography.micro, { color: tone.fg }]}>{label ?? tone.label}</Text>
    </View>
  );
}

export type { AppointmentStatus, PaymentStatus };
