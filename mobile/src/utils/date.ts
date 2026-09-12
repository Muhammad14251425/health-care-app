/**
 * Date and time helpers.
 *
 * The backend speaks two formats and neither is a JS Date:
 *   dates  "YYYY-MM-DD"
 *   times  "HH:MM:SS" -- and sometimes "H:MM:SS" (Marley does not zero-pad)
 *
 * Appointment dates are wall-clock values in the clinic's own timezone. Parsing
 * "2026-09-10" with `new Date()` treats it as UTC midnight, which renders as the
 * 9th anywhere west of Greenwich -- an appointment silently shown on the wrong
 * day. Everything here therefore parses into LOCAL components explicitly and
 * never round-trips an appointment through UTC.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = DAYS.map((d) => d.slice(0, 3));

/** Parse "YYYY-MM-DD" into a local-midnight Date (never UTC). */
export function parseBackendDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/** Format a Date as the backend's "YYYY-MM-DD", using local components. */
export function toBackendDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayBackendDate(): string {
  return toBackendDate(new Date());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Parse "H:MM:SS" or "HH:MM:SS" into {hours, minutes}. */
export function parseBackendTime(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/** "14:30:00" -> "2:30 PM" */
export function formatTime(value: string): string {
  const parsed = parseBackendTime(value);
  if (!parsed) return value ?? '';
  const { hours, minutes } = parsed;
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

/** "14:30:00" -> "14:30" (for compact timeline rails). */
export function formatTime24(value: string): string {
  const parsed = parseBackendTime(value);
  if (!parsed) return value ?? '';
  return `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`;
}

/** "2026-09-10" -> "10 Sep 2026" */
export function formatDate(value: string): string {
  const date = parseBackendDate(value);
  if (!date) return value ?? '';
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** "2026-09-10" -> "Thursday, 10 September" */
export function formatDateLong(value: string): string {
  const date = parseBackendDate(value);
  if (!date) return value ?? '';
  return `${DAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "2026-09-10" -> "September 2026" */
export function formatMonthYear(value: string | Date): string {
  const date = typeof value === 'string' ? parseBackendDate(value) : value;
  if (!date) return '';
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Short weekday + day-of-month, for the horizontal date strip. */
export function dateStripLabels(value: string | Date): { weekday: string; day: string } {
  const date = typeof value === 'string' ? parseBackendDate(value) : value;
  if (!date) return { weekday: '', day: '' };
  return {
    weekday: (DAYS_SHORT[date.getDay()] ?? '').toUpperCase(),
    day: String(date.getDate()).padStart(2, '0'),
  };
}

export function isToday(value: string): boolean {
  return value === todayBackendDate();
}

/** "Today" / "Yesterday" / "10 Sep 2026" -- for activity groupings. */
export function relativeDayLabel(value: string): string {
  const today = todayBackendDate();
  if (value === today) return 'Today';
  if (value === toBackendDate(addDays(new Date(), -1))) return 'Yesterday';
  return formatDate(value);
}

/** Minutes since midnight -- used to lay appointments onto a timeline. */
export function minutesSinceMidnight(time: string): number {
  const parsed = parseBackendTime(time);
  if (!parsed) return 0;
  return parsed.hours * 60 + parsed.minutes;
}

/** Add minutes to "HH:MM:SS", returning the same format. */
export function addMinutesToTime(time: string, minutes: number): string {
  const total = minutesSinceMidnight(time) + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
