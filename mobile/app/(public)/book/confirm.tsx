/**
 * Step 6 -- confirm.
 *
 * The one place in the public flow that writes. Two behaviours matter here:
 *
 *   * No optimistic success. The appointment is only real once the backend says
 *     so; showing a booked state before that would be a lie about a medical
 *     appointment.
 *   * A 409 means the slot went while the user was filling in the form. That is
 *     an expected outcome, not a crash: the slot cache is invalidated and the
 *     user is sent back to pick again, with a plain explanation.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { SummaryRow } from '@/components/ui/SummaryRow';
import { BookingProgress } from '@/components/booking/BookingSteps';
import * as publicApi from '@/api/publicBooking';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { useBookingStore } from '@/stores/booking';
import { formatDateLong, formatTime } from '@/utils/date';
import { colors, spacing } from '@/theme';

export default function ConfirmBooking() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { practitioner, department, date, time, details, setResult } = useBookingStore();

  const booking = useMutation({
    mutationFn: () =>
      publicApi.createBooking({
        first_name: details?.first_name ?? '',
        last_name: details?.last_name || undefined,
        phone: details?.phone ?? '',
        email: details?.email || undefined,
        reason: details?.reason || undefined,
        department: department ?? undefined,
        practitioner: practitioner?.name ?? '',
        date: date ?? '',
        time: time ?? '',
      }),
    onSuccess: (result) => {
      setResult(result);
      router.replace('/(public)/book/success');
    },
    onError: async (cause) => {
      const apiError = cause instanceof ApiError ? cause : null;

      if (apiError?.isConflict) {
        // Someone took the slot first. Drop the stale list and send them back.
        await queryClient.invalidateQueries({
          queryKey: queryKeys.publicSlots(practitioner?.name ?? '', date ?? ''),
        });
        setError('That time was just booked. Please choose another time.');
        router.replace('/(public)/book/slot');
        return;
      }

      setError(apiError?.message ?? 'We could not complete your booking. Please try again.');
    },
  });

  const ready = Boolean(practitioner && date && time && details);
  if (!ready) return <Redirect href="/(public)/book" />;

  const patientName = [details?.first_name, details?.last_name].filter(Boolean).join(' ');

  return (
    <Screen>
      <BackHeader title="Confirm booking" subtitle="Please check these details" />
      <BookingProgress step="confirm" />

      <Card flush>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SummaryRow label="Doctor" value={practitioner?.practitioner_name ?? ''} strong />
          <SummaryRow label="Department" value={department ?? practitioner?.department ?? '—'} />
          <SummaryRow label="Date" value={date ? formatDateLong(date) : ''} />
          <SummaryRow label="Time" value={time ? formatTime(time) : ''} strong />
          <SummaryRow label="Patient" value={patientName} />
          <SummaryRow label="Phone" value={details?.phone ?? ''} />
          {details?.reason ? <SummaryRow label="Reason" value={details.reason} /> : null}
          <SummaryRow label="Type" value="Consultation" last />
        </View>
      </Card>

      {error ? (
        <View
          style={{
            backgroundColor: colors.dangerSoft,
            borderRadius: 12,
            padding: spacing.md,
            marginTop: spacing.lg,
          }}
        >
          <Text variant="bodySmall" color={colors.danger}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
        <Button
          label="Confirm appointment"
          loading={booking.isPending}
          disabled={booking.isPending}
          onPress={() => {
            setError(null);
            booking.mutate();
          }}
        />
        <Text variant="micro" muted align="center">
          Your appointment is only confirmed once the clinic accepts it.
        </Text>
      </View>
    </Screen>
  );
}
