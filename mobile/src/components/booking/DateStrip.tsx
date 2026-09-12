/**
 * Horizontal date selector -- "MON 09" columns, dark green when selected, as in
 * the design brief. Days the doctor does not work are shown but disabled, so
 * the user can see the pattern rather than wondering where dates went.
 */

import { Pressable, ScrollView, View } from 'react-native';
import { colors, radius, screenPadding, spacing, typography } from '@/theme';
import { Text } from '@/components/ui/Text';
import type { PublicDay } from '@/types/domain';

export type DateStripProps = {
  days: PublicDay[];
  value: string | null;
  onChange: (date: string) => void;
};

export function DateStrip({ days, value, onChange }: DateStripProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: screenPadding }}
      style={{ marginHorizontal: -screenPadding, flexGrow: 0 }}
    >
      {days.map((day) => {
        const selected = day.date === value;
        const disabled = !day.available;

        return (
          <Pressable
            key={day.date}
            onPress={() => !disabled && onChange(day.date)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${day.weekday} ${day.day_number}${
              disabled ? ', unavailable' : ''
            }`}
            style={{
              width: 58,
              paddingVertical: spacing.md,
              borderRadius: radius.tile,
              alignItems: 'center',
              gap: 4,
              backgroundColor: selected ? colors.green : colors.card,
              borderWidth: 1,
              borderColor: selected ? colors.green : colors.line,
              opacity: disabled ? 0.4 : 1,
            }}
          >
            <Text
              style={[
                typography.micro,
                { color: selected ? 'rgba(255,255,255,0.75)' : colors.muted },
              ]}
            >
              {day.day_label}
            </Text>
            <Text
              style={[
                typography.cardTitle,
                { color: selected ? colors.white : colors.ink, fontSize: 15 },
              ]}
            >
              {day.day_number}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export type TimeSlotGridProps = {
  slots: Array<{ time: string; label: string; available: boolean }>;
  value: string | null;
  onChange: (time: string) => void;
};

/** Slot pills: dark green selected, muted and non-pressable when taken. */
export function TimeSlotGrid({ slots, value, onChange }: TimeSlotGridProps) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {slots.map((slot) => {
        const selected = slot.time === value;
        const disabled = !slot.available;

        return (
          <Pressable
            key={slot.time}
            onPress={() => !disabled && onChange(slot.time)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${slot.label}${disabled ? ', unavailable' : ''}`}
            style={{
              paddingHorizontal: spacing.lg,
              height: 44,
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: selected
                ? colors.green
                : disabled
                  ? colors.line
                  : colors.card,
              borderWidth: 1,
              borderColor: selected ? colors.green : colors.line,
              opacity: disabled ? 0.55 : 1,
            }}
          >
            <Text
              variant="bodySmall"
              color={selected ? colors.white : disabled ? colors.muted : colors.ink}
            >
              {slot.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
