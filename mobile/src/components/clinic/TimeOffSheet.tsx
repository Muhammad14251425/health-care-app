/**
 * Book leave (whole days) or block part of a day.
 *
 * Both write the same Practitioner Availability record -- a full day is simply
 * 00:00-23:59 -- so this is one sheet with a mode switch rather than two
 * screens. The distinction only changes which fields are asked for.
 *
 * The server refuses a window that already holds appointments (409) and one
 * that falls outside working hours (422); both come back as readable messages,
 * which the caller surfaces.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { PickerField } from '@/components/form/PickerField';
import { addDays, formatDate, formatTime, toBackendDate } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';
import { BLOCK_REASONS, type BlockReason } from '@/types/domain';

export type TimeOffMode = 'leave' | 'block';

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

/** 60 days forward: far enough to plan leave, short enough to stay a picker. */
function dateOptions() {
  return Array.from({ length: 60 }, (_, offset) => {
    const value = toBackendDate(addDays(new Date(), offset));
    return { value, label: formatDate(value) };
  });
}

export type TimeOffSheetProps = {
  visible: boolean;
  mode: TimeOffMode;
  saving?: boolean;
  /** Server-side rejection (already booked, outside hours) to show in place. */
  error?: string | null;
  onClose: () => void;
  onModeChange: (mode: TimeOffMode) => void;
  onSubmit: (values: {
    mode: TimeOffMode;
    from_date: string;
    to_date: string;
    from_time: string;
    to_time: string;
    reason: BlockReason;
  }) => void;
};

export function TimeOffSheet({
  visible,
  mode,
  saving = false,
  error,
  onClose,
  onModeChange,
  onSubmit,
}: TimeOffSheetProps) {
  const dates = useMemo(dateOptions, []);
  const today = dates[0]?.value ?? toBackendDate(new Date());

  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [fromTime, setFromTime] = useState('09:00:00');
  const [toTime, setToTime] = useState('12:00:00');
  const [reason, setReason] = useState<BlockReason>('Time Off');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    if (toDate < fromDate) {
      setLocalError('The end date is before the start date.');
      return;
    }
    if (mode === 'block' && toTime <= fromTime) {
      setLocalError('The end time must be after the start time.');
      return;
    }
    setLocalError(null);
    onSubmit({ mode, from_date: fromDate, to_date: toDate, from_time: fromTime, to_time: toTime, reason });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'leave' ? 'Add leave' : 'Block time'}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Mode switch: the two write the same record, so switching keeps the
            dates the user already picked. */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: colors.line,
            borderRadius: radius.pill,
            padding: 3,
            marginBottom: spacing.lg,
          }}
        >
          {(['leave', 'block'] as const).map((option) => {
            const active = option === mode;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  setLocalError(null);
                  onModeChange(option);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  flex: 1,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.pill,
                  backgroundColor: active ? colors.card : 'transparent',
                }}
              >
                <Text variant="micro" color={active ? colors.green : colors.muted}>
                  {option === 'leave' ? 'Whole days' : 'Part of a day'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <PickerField
          label={mode === 'leave' ? 'First day' : 'Date'}
          value={fromDate}
          options={dates}
          searchable
          onChange={(value) => {
            setLocalError(null);
            setFromDate(value);
            // Keep the range valid rather than rejecting it later.
            if (toDate < value) setToDate(value);
          }}
        />

        <PickerField
          label={mode === 'leave' ? 'Last day' : 'Repeat until'}
          value={toDate}
          options={dates.filter((option) => option.value >= fromDate)}
          searchable
          onChange={(value) => {
            setLocalError(null);
            setToDate(value);
          }}
        />

        {mode === 'block' ? (
          <>
            <PickerField
              label="From"
              value={fromTime}
              options={TIME_OPTIONS}
              onChange={(value) => {
                setLocalError(null);
                setFromTime(value);
              }}
            />
            <PickerField
              label="To"
              value={toTime}
              options={TIME_OPTIONS}
              onChange={(value) => {
                setLocalError(null);
                setToTime(value);
              }}
            />
          </>
        ) : null}

        <PickerField
          label="Reason"
          value={reason}
          options={BLOCK_REASONS.map((value) => ({ value, label: value }))}
          onChange={(value) => setReason(value as BlockReason)}
        />

        {localError || error ? (
          <View
            style={{
              backgroundColor: colors.dangerSoft,
              borderRadius: radius.card,
              padding: spacing.md,
              marginTop: spacing.sm,
            }}
          >
            <Text variant="caption" color={colors.danger}>
              {localError ?? error}
            </Text>
          </View>
        ) : null}

        <Button
          label={mode === 'leave' ? 'Add leave' : 'Block this time'}
          onPress={submit}
          loading={saving}
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
    </BottomSheet>
  );
}
