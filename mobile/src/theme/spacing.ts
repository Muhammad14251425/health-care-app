/**
 * Spacing scale.
 *
 * The reference HTML renders inside a 300px-wide fake phone, so its raw pixel
 * values (5px gaps, 8px padding) are roughly 0.75x of what the same design needs
 * on a real ~390pt device. These values are the reference proportions scaled up,
 * not the literal numbers -- copying those would produce a cramped app.
 */

export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Horizontal page gutter. The reference uses 14/300; this is the same ratio. */
export const screenPadding = 18;

/**
 * Height reserved at the bottom of scroll views so content clears the floating
 * tab bar. The bar is 62 tall and sits 12 above the safe area.
 */
export const tabBarClearance = 96;

export type Spacing = keyof typeof spacing;
