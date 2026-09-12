/**
 * Rounded filter pill. Dark green when selected, white when not -- the
 * reference's `.tab` treatment.
 */

import { Pressable, ScrollView, View } from 'react-native';
import { colors, radius, screenPadding, spacing, typography } from '@/theme';
import { Text } from './Text';

export type FilterPillProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Small count shown after the label, e.g. "Waiting 4". */
  count?: number;
};

export function FilterPill({ label, selected = false, onPress, count }: FilterPillProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      style={{
        backgroundColor: selected ? colors.green : colors.card,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.lg,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
      }}
    >
      <Text
        style={[
          typography.micro,
          { color: selected ? colors.white : colors.muted, fontSize: 11 },
        ]}
      >
        {label}
      </Text>
      {typeof count === 'number' && count > 0 ? (
        <View
          style={{
            backgroundColor: selected ? 'rgba(255,255,255,0.22)' : colors.bg,
            borderRadius: radius.pill,
            minWidth: 18,
            paddingHorizontal: 5,
            alignItems: 'center',
          }}
        >
          <Text
            style={[
              typography.micro,
              { color: selected ? colors.white : colors.muted, fontSize: 10 },
            ]}
          >
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export type FilterOption<T extends string> = { value: T; label: string; count?: number };

export type FilterPillRowProps<T extends string> = {
  options: ReadonlyArray<FilterOption<T>>;
  value: T;
  onChange: (value: T) => void;
};

/** Horizontally scrollable row -- filters must never wrap or squash. */
export function FilterPillRow<T extends string>({
  options,
  value,
  onChange,
}: FilterPillRowProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: spacing.sm,
        paddingHorizontal: screenPadding,
      }}
      style={{ marginHorizontal: -screenPadding, flexGrow: 0 }}
    >
      {options.map((option) => (
        <FilterPill
          key={option.value}
          label={option.label}
          count={option.count}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ScrollView>
  );
}
