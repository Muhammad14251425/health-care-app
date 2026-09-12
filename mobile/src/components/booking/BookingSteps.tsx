/**
 * Booking wizard chrome: a slim progress rail plus the shared step header.
 * Restrained on purpose -- this is a form, not a game.
 */

import { View } from 'react-native';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/components/ui/Text';

export const BOOKING_STEPS = [
  'department',
  'practitioner',
  'date',
  'slot',
  'details',
  'confirm',
] as const;

export type BookingStep = (typeof BOOKING_STEPS)[number];

export function BookingProgress({ step }: { step: BookingStep }) {
  const index = BOOKING_STEPS.indexOf(step);

  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {BOOKING_STEPS.map((name, position) => (
          <View
            key={name}
            style={{
              flex: 1,
              height: 3,
              borderRadius: radius.pill,
              backgroundColor: position <= index ? colors.green : colors.line,
            }}
          />
        ))}
      </View>
      <Text variant="micro" muted>
        Step {index + 1} of {BOOKING_STEPS.length}
      </Text>
    </View>
  );
}
