/**
 * Settings row: a small tinted icon tile, a label, and a chevron -- the
 * reference's profile list treatment.
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors, radius, spacing } from '@/theme';
import { Card } from './Card';
import { Text } from './Text';

export type SettingsRowProps = {
  icon: ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
  /** Renders in the warm red used for destructive actions. */
  destructive?: boolean;
  last?: boolean;
};

export function SettingsRow({
  icon,
  label,
  value,
  onPress,
  destructive = false,
  last = false,
}: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: '#F0EEE9',
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.sm,
          backgroundColor: destructive ? colors.dangerSoft : '#F2F2EE',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>

      <Text
        variant="bodySmall"
        color={destructive ? colors.danger : colors.ink}
        style={{ flex: 1 }}
      >
        {label}
      </Text>

      {value ? (
        <Text variant="caption" muted>
          {value}
        </Text>
      ) : null}
      {onPress && !destructive ? (
        <ChevronRight size={16} color="#AAA" strokeWidth={1.8} />
      ) : null}
    </Pressable>
  );
}

/** Groups rows into one rounded white block, as in the reference. */
export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <Card flush style={{ marginBottom: spacing.md }}>
      {children}
    </Card>
  );
}
