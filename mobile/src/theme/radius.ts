/**
 * Corner radii, read off the reference and scaled to real device widths.
 *
 * The reference's radii (11-17px at 300px wide) map to roughly 14-22 here. The
 * relationship between them is what matters: tiles are rounder than rows, the
 * hero is the roundest rectangle, and pills are fully round.
 */

export const radius = {
  /** Small chips, icon tiles. */
  sm: 8,
  /** Icon containers, tokens. */
  md: 10,
  /** Soft category tiles ("Your circles" style). */
  tile: 14,
  /** White information cards and list containers. */
  card: 16,
  /** The dark-green hero card. */
  hero: 20,
  /** The floating bottom navigation bar. */
  nav: 20,
  /** Fully rounded: filter pills, avatars, circular buttons. */
  pill: 999,
} as const;

export type Radius = keyof typeof radius;
