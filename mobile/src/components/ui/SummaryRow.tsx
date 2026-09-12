/**
 * Label/value row used on confirmation and detail screens. Values wrap; labels
 * never do, so the two columns stay aligned down the card.
 */

import { View } from 'react-native';
import { colors, spacing } from '@/theme';
import { Text } from './Text';

export type SummaryRowProps = {
  label: string;
  value: string;
  /** Emphasise the value (totals, outstanding amounts). */
  strong?: boolean;
  valueColor?: string;
  last?: boolean;
};

export function SummaryRow({
  label,
  value,
  strong = false,
  valueColor,
  last = false,
}: SummaryRowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text
        variant={strong ? 'cardTitle' : 'bodySmall'}
        color={valueColor}
        align="right"
        style={{ flex: 1 }}
      >
        {value}
      </Text>
    </View>
  );
}
