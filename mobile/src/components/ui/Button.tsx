/**
 * Buttons.
 *
 * Variants map to the reference: dark green primary, gold accent, soft green
 * secondary, and a plain ghost. Press feedback is a small scale -- calm, as
 * healthcare software should be.
 *
 * Touch targets stay at least 44pt tall even though the reference renders
 * buttons at ~30px on its 300px canvas; a visually compact design must not
 * become an unusable one.
 */

import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

const HEIGHTS: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 54 };

function palette(variant: ButtonVariant): { bg: string; fg: string; border?: string } {
  switch (variant) {
    case 'primary':
      return { bg: colors.green, fg: colors.white };
    case 'gold':
      return { bg: colors.gold, fg: '#2E2A1D' };
    case 'secondary':
      return { bg: '#DDE7D8', fg: '#31523F' };
    case 'danger':
      return { bg: colors.dangerSoft, fg: colors.danger };
    case 'ghost':
    default:
      return { bg: 'transparent', fg: colors.ink, border: colors.line };
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  fullWidth = true,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const tone = palette(variant);
  const inactive = disabled || loading;

  const animate = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();

  return (
    <Animated.View style={[{ transform: [{ scale }] }, fullWidth && { width: '100%' }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        style={{
          height: HEIGHTS[size],
          borderRadius: radius.pill,
          backgroundColor: tone.bg,
          borderWidth: tone.border ? 1 : 0,
          borderColor: tone.border,
          opacity: inactive ? 0.55 : 1,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          paddingHorizontal: spacing.xl,
          gap: spacing.sm,
        }}
      >
        {loading ? (
          <ActivityIndicator color={tone.fg} size="small" />
        ) : (
          <>
            {icon ? <View>{icon}</View> : null}
            <Text style={[typography.button, { color: tone.fg }]}>{label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}
