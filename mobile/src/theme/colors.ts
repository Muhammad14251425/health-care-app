/**
 * Colour tokens extracted from the supplied Baobab reference (the `:root` block
 * of baobab_html_css_clone_poppins.html). These are the design system -- do not
 * introduce colours outside this file.
 */

export const palette = {
  // Core surfaces
  bg: '#F3F2ED',
  card: '#FFFFFF',
  line: '#EBE9E2',

  // Text
  ink: '#10110F',
  muted: '#73756F',
  /** Slightly darker muted, used for eyebrow/section actions in the reference. */
  mutedStrong: '#596059',

  // Brand greens
  green: '#124F3D',
  greenSecondary: '#1F6A53',
  /** The lighter green used for the hero card's action buttons. */
  greenAction: '#285D4C',
  /** Hero gradient stops, read off .balance-card. */
  greenGradient: ['#0B4B38', '#164F3F', '#1D5A46'] as const,
  /** The soft disc bleeding off the top-right of the hero card. */
  greenGlow: '#5F9982',

  // Accents
  gold: '#F4BF52',
  /** The avatar gold, marginally deeper than the accent gold. */
  goldAvatar: '#F2C65E',
  peach: '#F8DDC7',
  mint: '#E8EFE7',
  paleYellow: '#F8ECC2',
  brown: '#965C33',

  // Status / feedback.
  // The reference has no error colour except .logout (#AD4F49); that muted warm
  // red is reused so feedback stays inside the palette's temperature.
  danger: '#AD4F49',
  dangerSoft: '#FFF0EE',
  success: '#2D775F',
  successSoft: '#E3F0E8',
  warning: '#98721F',
  warningSoft: '#F3E0A4',

  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

/**
 * One central status system. Every pill in the app resolves through here so a
 * status can never pick up a different colour on a different screen.
 */
export type StatusTone = {
  bg: string;
  fg: string;
  label: string;
};

/** Marley `Patient Appointment` statuses -- the allowlist the backend accepts. */
export const appointmentStatusTone: Record<string, StatusTone> = {
  Scheduled: { bg: palette.mint, fg: palette.green, label: 'Confirmed' },
  Open: { bg: palette.paleYellow, fg: palette.warning, label: 'Waiting' },
  'Checked In': { bg: palette.paleYellow, fg: palette.warning, label: 'Checked in' },
  Closed: { bg: palette.successSoft, fg: palette.success, label: 'Completed' },
  Cancelled: { bg: palette.dangerSoft, fg: palette.danger, label: 'Cancelled' },
  'No Show': { bg: palette.peach, fg: palette.brown, label: 'No show' },
};

/** Normalised `payment_status` from the invoices API. */
export const invoiceStatusTone: Record<string, StatusTone> = {
  paid: { bg: palette.mint, fg: palette.green, label: 'Paid' },
  partially_paid: { bg: palette.paleYellow, fg: palette.warning, label: 'Partial' },
  unpaid: { bg: palette.peach, fg: palette.brown, label: 'Unpaid' },
  draft: { bg: palette.line, fg: palette.muted, label: 'Draft' },
  cancelled: { bg: palette.dangerSoft, fg: palette.danger, label: 'Cancelled' },
};

/** Soft tile backgrounds, cycled for category cards (departments, stats). */
export const softTiles = [palette.peach, palette.mint, palette.paleYellow] as const;

export const colors = palette;
