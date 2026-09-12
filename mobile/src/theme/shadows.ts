/**
 * Shadows.
 *
 * The reference is very restrained: `0 2px 8px rgba(36,39,34,.05)` on the nav,
 * a slightly stronger drop on the avatar, and nothing at all on most cards --
 * separation comes from the warm background against white, not from elevation.
 *
 * Android renders `shadow*` props inconsistently and needs `elevation`, which
 * ignores colour and offset. So each token carries both, and cards that rely on
 * a hairline instead of a shadow use `colors.line` borders (see `surfaces.ts`).
 */

import { Platform } from 'react-native';
import { palette } from './colors';

type Shadow = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

const shadow = (
  height: number,
  radius: number,
  opacity: number,
  elevation: number,
): Shadow => ({
  shadowColor: '#282923',
  shadowOffset: { width: 0, height },
  shadowOpacity: opacity,
  shadowRadius: radius,
  elevation,
});

export const shadows = {
  /** No elevation -- for cards that use a hairline border instead. */
  none: shadow(0, 0, 0, 0),
  /** Barely-there lift for white cards. */
  card: shadow(2, 8, 0.05, 1),
  /** The floating bottom navigation. */
  nav: shadow(4, 14, 0.08, 8),
  /** Avatar / circular buttons. */
  raised: shadow(4, 10, 0.11, 4),
  /** Modals and bottom sheets. */
  overlay: shadow(12, 32, 0.16, 16),
} as const;

/**
 * Android's `elevation` paints a grey box shadow that muddies the warm palette
 * on soft-coloured tiles. Those use a hairline border there instead.
 */
export const preferBorderOnAndroid = Platform.OS === 'android';

export const hairline = {
  borderWidth: 1,
  borderColor: palette.line,
} as const;

export type ShadowToken = keyof typeof shadows;
