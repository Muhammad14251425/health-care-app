/**
 * Editor for one weekday of the weekly working pattern.
 *
 * `practitioners.set_schedule` replaces the WHOLE pattern, so the screen owns
 * the full list and this sheet only edits one day's ranges; the caller merges
 * and submits. That keeps the "a timetable is edited as a whole" contract
 * without making the user retype every other day.
 *
 * Times are chosen from a generated list rather than typed. A free-text time
 * field means parsing, locale ambiguity and a validation round-trip for what is
 * really a pick from a short set -- and the backend only accepts times on the
 * clock anyway.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { PickerField } from '@/components/form/PickerField';
import { formatTime } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';
import type { ScheduleSlot } from '@/types/domain';

/** Every half hour from 06:00 to 21:00 -- clinic hours, not the full clock. */
const TIME_OPTIONS = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let minutes = 6 * 60; minutes <= 21 * 60; minutes += 30) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
      minutes % 60,
    ).padStart(2, '0')}:00`;
    out.push({ value, label: formatTime(value) });
  }
  return out;
})();

const DURATION_OPTIONS = [15, 20, 30, 45, 60].map((minutes) => ({
  value: String(minutes),
  label: `${minutes} min`,
}));

type Range = { from_time: string; to_time: string; duration: number };

export type ScheduleEditorSheetProps = {
  visible: boolean;
  day: string | null;
  /** The ranges currently configured for this day. */
  ranges: ScheduleSlot[];
  saving?: boolean;
  onClose: () => void;
  onSave: (day: string, ranges: Range[]) => void;
};

/** Normalise to "HH:MM:SS"; Marley hands back "9:00:00" unpadded. */
function normalise(time: string): string {
  const [h = '0', m = '0'] = time.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`;
}

export function ScheduleEditorSheet({
  visible,
  day,
  ranges,
  saving = false,
  onClose,
  onSave,
}: ScheduleEditorSheetProps) {
  const [draft, setDraft] = useState<Range[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from props each time the sheet opens for a different day, without
  // an effect: `key` on the sheet would remount and lose the open animation.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (visible && seededFor !== day) {
    setSeededFor(day);
    setDraft(
      ranges.map((slot) => ({
        from_time: normalise(slot.from_time),
        to_time: normalise(slot.to_time),
        duration: slot.duration || 30,
      })),
    );
    setError(null);
  }
  if (!visible && seededFor !== null) setSeededFor(null);

  const rows = draft ?? [];

  const update = (index: number, patch: Partial<Range>) => {
    setError(null);
    setDraft(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const overlapping = useMemo(() => {
    // Mirrors the server's check so the user sees it before a round-trip.
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (!a || !b) continue;
        if (a.from_time < b.to_time && b.from_time < a.to_time) return true;
      }
    }
    return false;
  }, [rows]);

  const inverted = rows.some((row) => row.to_time <= row.from_time);

  const submit = () => {
    if (!day) return;
    if (inverted) {
      setError('Each range must end after it starts.');
      return;
    }
    if (overlapping) {
      setError('Two ranges on this day overlap.');
      return;
    }
    onSave(day, rows);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={day ? `${day} hours` : 'Hours'}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {rows.length === 0 ? (
          <Text variant="caption" muted style={{ marginBottom: spacing.lg }}>
            The doctor is not working on {day}. Add a range to make them bookable.
          </Text>
        ) : null}

        {rows.map((row, index) => (
          <View
            key={index}
            style={{
              backgroundColor: colors.card,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.line,
              padding: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing.xs,
              }}
            >
              <Text variant="caption" muted>
                Range {index + 1}
              </Text>
              <Pressable
                onPress={() => {
                  setError(null);
                  setDraft(rows.filter((_, i) => i !== index));
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove range ${index + 1}`}
                hitSlop={8}
              >
                <Trash2 size={17} color={colors.danger} strokeWidth={1.8} />
              </Pressable>
            </View>

            <PickerField
              label="From"
              value={row.from_time}
              options={TIME_OPTIONS}
              onChange={(value) => update(index, { from_time: value })}
            />
            <PickerField
              label="To"
              value={row.to_time}
              options={TIME_OPTIONS}
              onChange={(value) => update(index, { to_time: value })}
            />
            <PickerField
              label="Appointment length"
              value={String(row.duration)}
              options={DURATION_OPTIONS}
              onChange={(value) => update(index, { duration: Number(value) })}
            />
          </View>
        ))}

        <Button
          label="Add a range"
          variant="ghost"
          icon={<Plus size={17} color={colors.green} strokeWidth={2} />}
          onPress={() => {
            setError(null);
            setDraft([...rows, { from_time: '09:00:00', to_time: '17:00:00', duration: 30 }]);
          }}
        />

        {error ? (
          <Text variant="caption" color={colors.danger} style={{ marginTop: spacing.md }}>
            {error}
          </Text>
        ) : null}

        <Button
          label="Save hours"
          onPress={submit}
          loading={saving}
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
    </BottomSheet>
  );
}
