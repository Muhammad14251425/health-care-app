/**
 * Date-of-birth picker.
 *
 * Why not a text field: "YYYY-MM-DD" asks a patient to know a format, lets them
 * type 1990-13-45, and on a phone it opens the wrong keyboard. Every wrong value
 * is either a validation error they have to decode or -- worse -- a plausible
 * but wrong date that lands in their medical record.
 *
 * Why not a calendar grid: a DOB is typically decades back. A month-by-month
 * calendar means ~500 taps to reach 1985. Three scrolling columns (day / month /
 * year) get anywhere in three flicks, which is what the platform pickers do too.
 *
 * Why not @react-native-community/datetimepicker: it is a native module, so it
 * would need a rebuild of the dev client. This screen set already owns a
 * BottomSheet, and the whole control is ~200 lines of ordinary RN -- not worth
 * a native dependency and an Expo Go incompatibility.
 *
 * The value is held and emitted as `YYYY-MM-DD`, which is what Frappe stores,
 * so nothing downstream has to parse a display string.
 */

import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '@/theme';
import { Text } from '@/components/ui/Text';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Nobody booking a clinic appointment was born more than 120 years ago. */
const MAX_AGE_YEARS = 120;

const ITEM_HEIGHT = 44;

function daysInMonth(year: number, month1: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month1, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `1990-01-15` -> "15 January 1990"; anything unparseable -> null. */
export function formatDob(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const month = MONTHS[Number(m) - 1];
  if (!month) return null;
  return `${Number(d)} ${month} ${y}`;
}

export type DateOfBirthFieldProps = {
  label?: string;
  /** `YYYY-MM-DD`, or empty for "not set". */
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string | null;
  optional?: boolean;
};

export function DateOfBirthField({
  label = 'Date of birth',
  value,
  onChange,
  hint,
  error,
  optional = false,
}: DateOfBirthFieldProps) {
  const [open, setOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const maxYear = today.getFullYear();
  const minYear = maxYear - MAX_AGE_YEARS;

  // Seed the wheels from the current value, else a sensible middle-aged default
  // so the year column does not open at "this year" (implying a newborn).
  const seed = useMemo(() => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? '');
    if (match) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
    }
    return { year: maxYear - 30, month: 1, day: 1 };
  }, [value, maxYear]);

  const [year, setYear] = useState(seed.year);
  const [month, setMonth] = useState(seed.month);
  const [day, setDay] = useState(seed.day);

  const years = useMemo(
    // Newest first: a patient scrolls down into the past, not up.
    () => Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i),
    [maxYear, minYear],
  );

  const maxDay = daysInMonth(year, month);
  const days = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => i + 1),
    [maxDay],
  );

  // 31 January -> switch to February must not leave "31 February" selected.
  const safeDay = Math.min(day, maxDay);

  const isFuture = useMemo(() => {
    const picked = new Date(year, month - 1, safeDay);
    picked.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return picked > now;
  }, [year, month, safeDay]);

  const openSheet = () => {
    setYear(seed.year);
    setMonth(seed.month);
    setDay(seed.day);
    setOpen(true);
  };

  const confirm = () => {
    if (isFuture) return;
    onChange(`${year}-${pad(month)}-${pad(safeDay)}`);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  const display = formatDob(value);

  return (
    <View>
      <Text variant="label" muted>
        {label}
      </Text>

      <Pressable
        onPress={openSheet}
        accessibilityRole="button"
        accessibilityLabel={
          display ? `${label}: ${display}. Tap to change.` : `Choose your ${label.toLowerCase()}`
        }
        style={{
          marginTop: spacing.sm,
          height: 52,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.line,
          backgroundColor: colors.card,
          paddingHorizontal: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        <CalendarDays size={18} color={colors.muted} strokeWidth={1.7} />
        <Text
          style={[typography.body, { flex: 1 }]}
          color={display ? colors.ink : colors.muted}
        >
          {display ?? (optional ? 'Select a date (optional)' : 'Select a date')}
        </Text>
      </Pressable>

      {error ? (
        <Text variant="micro" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="micro" muted style={{ marginTop: spacing.xs }}>
          {hint}
        </Text>
      ) : null}

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={label}
        maxHeightRatio={0.72}
      >
        <View style={{ flexDirection: 'row', gap: spacing.sm, height: 240 }}>
          <Wheel
            label="Day"
            items={days}
            selected={safeDay}
            onSelect={setDay}
            render={(d) => String(d)}
          />
          <Wheel
            label="Month"
            items={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
            selected={month}
            onSelect={setMonth}
            render={(m) => MONTHS[m - 1]?.slice(0, 3) ?? String(m)}
          />
          <Wheel
            label="Year"
            items={years}
            selected={year}
            onSelect={setYear}
            render={(y) => String(y)}
          />
        </View>

        <View
          style={{
            marginTop: spacing.md,
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: isFuture ? colors.dangerSoft : colors.mint,
          }}
        >
          <Text
            variant="caption"
            color={isFuture ? colors.danger : colors.green}
            align="center"
          >
            {isFuture
              ? 'That date is in the future'
              : `${safeDay} ${MONTHS[month - 1]} ${year}`}
          </Text>
        </View>

        <Button
          label="Confirm"
          onPress={confirm}
          disabled={isFuture}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.md }}
        />

        {optional && value ? (
          <Button
            label="Clear"
            variant="ghost"
            onPress={clear}
            fullWidth
            style={{ marginTop: spacing.xs }}
          />
        ) : null}
      </BottomSheet>
    </View>
  );
}

/** One scrolling column. */
function Wheel<T extends number>({
  label,
  items,
  selected,
  onSelect,
  render,
}: {
  label: string;
  items: T[];
  selected: T;
  onSelect: (value: T) => void;
  render: (value: T) => string;
}) {
  const ref = useRef<ScrollView>(null);
  const initialIndex = Math.max(0, items.indexOf(selected));

  return (
    <View style={{ flex: 1 }}>
      <Text variant="micro" muted align="center" style={{ marginBottom: spacing.xs }}>
        {label}
      </Text>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        // Land the current value in view without animating on first paint.
        contentOffset={{ x: 0, y: initialIndex * ITEM_HEIGHT }}
        contentContainerStyle={{ paddingVertical: spacing.sm }}
        style={{
          backgroundColor: colors.bg,
          borderRadius: radius.md,
        }}
      >
        {items.map((item) => {
          const active = item === selected;
          return (
            <Pressable
              key={item}
              onPress={() => onSelect(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label} ${render(item)}`}
              style={{
                height: ITEM_HEIGHT,
                alignItems: 'center',
                justifyContent: 'center',
                marginHorizontal: spacing.xs,
                borderRadius: radius.sm,
                backgroundColor: active ? colors.green : 'transparent',
              }}
            >
              <Text
                variant="caption"
                color={active ? colors.white : colors.ink}
                numberOfLines={1}
              >
                {render(item)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
