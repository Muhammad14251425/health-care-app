/**
 * Step 3 -- choose a date.
 */

import { Redirect, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { ErrorState, SkeletonBlock } from '@/components/ui/States';
import { BookingProgress } from '@/components/booking/BookingSteps';
import { DateStrip } from '@/components/booking/DateStrip';
import * as publicApi from '@/api/publicBooking';
import { queryKeys } from '@/api/queryClient';
import { useBookingStore } from '@/stores/booking';
import { formatDateLong } from '@/utils/date';
import { spacing } from '@/theme';

export default function ChooseDate() {
  const router = useRouter();
  const practitioner = useBookingStore((state) => state.practitioner);
  const date = useBookingStore((state) => state.date);
  const setDate = useBookingStore((state) => state.setDate);

  // Hooks must run unconditionally, so the query is declared before the
  // redirect guard and simply disabled when there is no practitioner yet.
  const days = useQuery({
    queryKey: queryKeys.publicDays(practitioner?.name ?? 'none'),
    queryFn: () => publicApi.availableDays(practitioner?.name ?? '', 14),
    enabled: Boolean(practitioner),
  });

  // Deep-linked into the middle of the wizard: send them back to the start.
  if (!practitioner) return <Redirect href="/(public)/book" />;

  return (
    <Screen>
      <BackHeader title="Choose date" subtitle={practitioner.practitioner_name} />
      <BookingProgress step="date" />

      {days.isPending ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} width={58} height={72} style={{ borderRadius: 14 }} />
          ))}
        </View>
      ) : days.isError ? (
        <ErrorState error={days.error} onRetry={() => void days.refetch()} />
      ) : (
        <>
          <DateStrip days={days.data?.days ?? []} value={date} onChange={setDate} />

          {date ? (
            <Text variant="body" style={{ marginTop: spacing.xl }}>
              {formatDateLong(date)}
            </Text>
          ) : (
            <Text variant="caption" muted style={{ marginTop: spacing.xl }}>
              Pick a day to see available times. Greyed-out days are outside this
              doctor&apos;s working schedule.
            </Text>
          )}

          <View style={{ marginTop: spacing.xxl }}>
            <Button
              label="See available times"
              disabled={!date}
              onPress={() => router.push('/(public)/book/slot')}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
