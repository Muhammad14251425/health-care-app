/**
 * Page headers.
 *
 * `ScreenHeader` is the reference's top row: a compact bold title, a small muted
 * subtitle, and an optional action on the right (avatar or circular button).
 * `BackHeader` is the sub-page variant with a circular back button.
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { colors, radius, shadows, spacing } from '@/theme';
import { Text } from './Text';

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  /** Small label above the title, e.g. the clinic name. */
  eyebrow?: ReactNode;
  right?: ReactNode;
};

export function ScreenHeader({ title, subtitle, eyebrow, right }: ScreenHeaderProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
        marginBottom: spacing.lg,
      }}
    >
      <View style={{ flex: 1 }}>
        {eyebrow}
        <Text variant="heading1">{title}</Text>
        {subtitle ? (
          <Text variant="caption" muted style={{ marginTop: 4 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export type BackHeaderProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
};

export function BackHeader({ title, subtitle, right, onBack }: BackHeaderProps) {
  const router = useRouter();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        marginBottom: spacing.lg,
      }}
    >
      <Pressable
        onPress={onBack ?? (() => router.back())}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        // 40pt target: the reference draws 27px, too small to hit reliably.
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.pill,
          backgroundColor: colors.card,
          alignItems: 'center',
          justifyContent: 'center',
          ...shadows.card,
        }}
      >
        <ChevronLeft size={20} color={colors.ink} strokeWidth={2} />
      </Pressable>

      <View style={{ flex: 1 }}>
        <Text variant="heading2">{title}</Text>
        {subtitle ? (
          <Text variant="caption" muted style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: object;
};

/** "Your circles / See all" -- the reference's section title row. */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: SectionHeaderProps) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.md,
        },
        style,
      ]}
    >
      <Text variant="heading3">{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text variant="micro" color={colors.mutedStrong}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
