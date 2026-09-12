/**
 * Date/time helpers.
 *
 * The timezone cases matter most: parsing "2026-09-10" with `new Date()` treats
 * it as UTC midnight, which renders as the 9th anywhere west of Greenwich --
 * i.e. an appointment silently shown on the wrong day.
 */

import {
  addMinutesToTime,
  dateStripLabels,
  formatDate,
  formatDateLong,
  formatTime,
  formatTime24,
  minutesSinceMidnight,
  parseBackendDate,
  parseBackendTime,
  relativeDayLabel,
  toBackendDate,
  todayBackendDate,
} from '@/utils/date';

describe('parseBackendDate', () => {
  it('parses a backend date into local components, not UTC', () => {
    const date = parseBackendDate('2026-09-10');
    expect(date).not.toBeNull();
    // The calendar day must survive regardless of the machine's timezone.
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8); // September, zero-indexed
    expect(date?.getDate()).toBe(10);
  });

  it('returns null for malformed input rather than an Invalid Date', () => {
    expect(parseBackendDate('not-a-date')).toBeNull();
    expect(parseBackendDate('')).toBeNull();
  });
});

describe('toBackendDate', () => {
  it('round-trips through parseBackendDate without shifting the day', () => {
    expect(toBackendDate(parseBackendDate('2026-01-01') as Date)).toBe('2026-01-01');
    expect(toBackendDate(parseBackendDate('2026-12-31') as Date)).toBe('2026-12-31');
  });

  it('zero-pads month and day', () => {
    expect(toBackendDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('parseBackendTime', () => {
  it('accepts the non-zero-padded times Marley returns', () => {
    // Marley returns "9:00:00", not "09:00:00" -- this is the real shape.
    expect(parseBackendTime('9:00:00')).toEqual({ hours: 9, minutes: 0 });
    expect(parseBackendTime('09:00:00')).toEqual({ hours: 9, minutes: 0 });
  });

  it('rejects out-of-range values', () => {
    expect(parseBackendTime('25:00:00')).toBeNull();
    expect(parseBackendTime('12:99:00')).toBeNull();
  });
});

describe('formatTime', () => {
  it.each([
    ['09:00:00', '9:00 AM'],
    ['9:00:00', '9:00 AM'],
    ['13:30:00', '1:30 PM'],
    ['00:15:00', '12:15 AM'],
    ['12:00:00', '12:00 PM'],
    ['23:45:00', '11:45 PM'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });
});

describe('formatTime24', () => {
  it('zero-pads for the calendar rail', () => {
    expect(formatTime24('9:05:00')).toBe('09:05');
  });
});

describe('formatDate', () => {
  it('renders a short readable date', () => {
    expect(formatDate('2026-09-10')).toBe('10 Sep 2026');
  });

  it('passes malformed values through rather than showing NaN', () => {
    expect(formatDate('rubbish')).toBe('rubbish');
  });
});

describe('formatDateLong', () => {
  it('includes the weekday', () => {
    // 2026-09-10 is a Thursday.
    expect(formatDateLong('2026-09-10')).toBe('Thursday, 10 September');
  });
});

describe('dateStripLabels', () => {
  it('produces an uppercase weekday and padded day number', () => {
    expect(dateStripLabels('2026-09-10')).toEqual({ weekday: 'THU', day: '10' });
    expect(dateStripLabels('2026-09-07')).toEqual({ weekday: 'MON', day: '07' });
  });
});

describe('minutesSinceMidnight', () => {
  it('converts a backend time to minutes for timeline placement', () => {
    expect(minutesSinceMidnight('00:00:00')).toBe(0);
    expect(minutesSinceMidnight('9:30:00')).toBe(570);
    expect(minutesSinceMidnight('17:00:00')).toBe(1020);
  });
});

describe('addMinutesToTime', () => {
  it('advances within the hour', () => {
    expect(addMinutesToTime('09:00:00', 30)).toBe('09:30:00');
  });

  it('rolls over the hour boundary', () => {
    expect(addMinutesToTime('09:45:00', 30)).toBe('10:15:00');
  });

  it('wraps past midnight rather than producing hour 24', () => {
    expect(addMinutesToTime('23:45:00', 30)).toBe('00:15:00');
  });
});

describe('relativeDayLabel', () => {
  it('labels today', () => {
    expect(relativeDayLabel(todayBackendDate())).toBe('Today');
  });

  it('falls back to an absolute date for older days', () => {
    expect(relativeDayLabel('2020-03-01')).toBe('1 Mar 2020');
  });
});
