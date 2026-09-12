/**
 * Soft coloured stat tiles -- the reference's "Your circles" grid, reused for
 * clinic counts (New / Waiting / Completed).
 */

import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';
import { Text } from './Text';

export type StatCardProps = {
  label: string;
  value: string | number;
  /** One of the soft palette tints. */
  backgroundColor?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function StatCard({
  label,
  value,
  backgroundColor = colors.mint,
  onPress,
  style,
}: StatCardProps) {
  const body = (
    <View
      style={[
        {
          backgroundColor,
          borderRadius: radius.tile,
          padding: spacing.md,
          minHeight: 78,
          justifyContent: 'space-between',
          flex: 1,
        },
        style,
      ]}
    >
      <Text style={[typography.heading2, { fontSize: 22, lineHeight: 26 }]}>{value}</Text>
      <Text variant="micro" color="#676961" numberOfLines={2}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={{ flex: 1 }}
    >
      {body}
    </Pressable>
  );
}

/** Three tiles side by side, as in the reference. */
export function StatCardRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: spacing.sm }}>{children}</View>;
}

/** The white bordered stat used on profile screens (Visits / Upcoming / Due). */
export function ProfileStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: radius.tile,
        paddingVertical: spacing.lg,
        alignItems: 'center',
        gap: 3,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Text variant="cardTitle" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="micro" muted>
        {label}
      </Text>
    </View>
  );
}
