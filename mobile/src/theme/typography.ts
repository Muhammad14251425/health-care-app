/**
 * Type scale.
 *
 * The reference uses font-weight 850 for headings. That is not a real Poppins
 * weight -- browsers synthesise it between 800 and 900. Here headings use the
 * genuine 800 face plus tight letter spacing, which reproduces the same dense,
 * confident look without relying on synthetic weights.
 *
 * Sizes are the reference's proportions scaled from its 300px canvas to a real
 * device, so the hierarchy is preserved while staying legible.
 */

export const fontFamily = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  extrabold: 'Poppins_800ExtraBold',
} as const;

type Variant = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
};

export const typography = {
  /** The big number on the hero card. */
  display: {
    fontFamily: fontFamily.extrabold,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1.4,
  },
  /** Page titles: "Hello Peace", "Your circles". */
  heading1: {
    fontFamily: fontFamily.extrabold,
    fontSize: 27,
    lineHeight: 29,
    letterSpacing: -0.9,
  },
  /** Sub-page titles, e.g. the Activity screen header. */
  heading2: {
    fontFamily: fontFamily.extrabold,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.5,
  },
  /** Section titles: "Your circles", "Grow your money". */
  heading3: {
    fontFamily: fontFamily.extrabold,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: -0.3,
  },
  /** Card titles, list row names. */
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 19,
  },
  bodySmall: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
  },
  /** Muted metadata under a title. */
  caption: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 15,
  },
  /** Smallest text: tab labels, tile meta. */
  micro: {
    fontFamily: fontFamily.semibold,
    fontSize: 10,
    lineHeight: 13,
  },
  /** Field labels, eyebrows, section date separators. */
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  button: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.1,
  },
} satisfies Record<string, Variant>;

export type TypographyVariant = keyof typeof typography;
