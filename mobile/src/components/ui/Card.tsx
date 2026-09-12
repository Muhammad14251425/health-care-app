/**
 * White rounded card -- the app's primary content surface.
 *
 * The reference gets separation from the warm background against white, not
 * from elevation, so the default shadow is deliberately almost invisible. On
 * Android `elevation` paints a grey halo that muddies the warm palette, so
 * cards there lean on a hairline border instead.
 */

import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing } from '@/theme';
import { Platform } from 'react-native';

export type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Remove inner padding for list containers that manage their own rows. */
  flush?: boolean;
  padding?: number;
  backgroundColor?: string;
  borderRadius?: number;
};

export function Card({
  children,
  style,
  flush = false,
  padding,
  backgroundColor = colors.card,
  borderRadius = radius.card,
}: CardProps) {
  return (
    <View
      style={[
        {
          backgroundColor,
          borderRadius,
          padding: flush ? 0 : (padding ?? spacing.lg),
          overflow: 'hidden',
        },
        Platform.OS === 'android'
          ? { borderWidth: 1, borderColor: colors.line }
          : shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}
