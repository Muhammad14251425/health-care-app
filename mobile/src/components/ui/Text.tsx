/**
 * Typed text primitive.
 *
 * Every piece of copy goes through a named variant so font sizes are never
 * hand-typed per screen. `color` accepts a palette token or a raw colour.
 */

import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, typography, type TypographyVariant } from '@/theme';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  /** Convenience for muted secondary copy. */
  muted?: boolean;
};

export function Text({
  variant = 'body',
  color,
  align,
  muted,
  style,
  ...rest
}: TextProps) {
  const resolved = color ?? (muted ? colors.muted : colors.ink);
  return (
    <RNText
      {...rest}
      style={[typography[variant], { color: resolved, textAlign: align }, style]}
    />
  );
}
