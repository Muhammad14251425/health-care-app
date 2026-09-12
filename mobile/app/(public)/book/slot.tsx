/**
 * Step 4 -- choose a time.
 *
 * Slots come from the server (public.availability.slots), never from client-side
 * arithmetic. They are refetched on focus because availability is exactly the
 * thing that goes stale while someone is deciding.
 */

import { Redirect, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonBlock } from '@/components/ui/States';
import { BookingProgress } from '@/components/booking/BookingSteps';
import { TimeSlotGrid } from '@/components/booking/DateStrip';
import * as publicApi from '@/api/publicBooking';
import { queryKeys } from '@/api/queryClient';
import { useBookingStore } from '@/stores/booking';
import { formatDateLong } from '@/utils/date';
import { spacing } from '@/theme';

export default function ChooseSlot() {
  const router = useRouter();
  const practitioner = useBookingStore((state) => state.practitioner);
  const date = useBookingStore((state) => state.date);
  const time = useBookingStore((state) => state.time);
  const setTime = useBookingStore((state) => state.setTime);

  const ready = Boolean(practitioner && date);

  const slots = useQuery({
    queryKey: queryKeys.publicSlots(practitioner?.name ?? 'none', date ?? 'none'),
    queryFn: () => publicApi.availableSlots(practitioner?.name ?? '', date ?? ''),
    enabled: ready,
    // Availability changes underneath the user; do not serve it from cache.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (!ready) return <Redirect href="/(public)/book" />;

  return (
    <Screen>
      <BackHeader
        title="Available time"
        subtitle={date ? formatDateLong(date) : undefined}
      />
      <BookingProgress step="slot" />

      {slots.isPending ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {Array.from({ length: 8 }, (_, index) => (
            <SkeletonBlock key={index} width={92} height={44} style={{ borderRadius: 999 }} />
          ))}
        </View>
      ) : slots.isError ? (
        <ErrorState error={slots.error} onRetry={() => void slots.refetch()} />
      ) : slots.data && slots.data.slots.length > 0 ? (
        <>
          <TimeSlotGrid slots={slots.data.slots} value={time} onChange={setTime} />

          <View style={{ marginTop: spacing.xxl }}>
            <Button
              label="Continue"
              disabled={!time}
              onPress={() => router.push('/(public)/book/details')}
            />
          </View>
        </>
      ) : (
        <EmptyState
          title="No times available"
          message={
            slots.data?.message ??
            'This doctor has no free times on the selected day. Try another date.'
          }
          action={{ label: 'Choose another date', onPress: () => router.back() }}
        />
      )}
    </Screen>
  );
}
