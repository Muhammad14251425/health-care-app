/**
 * Step 2 -- choose a doctor.
 *
 * Each card shows the doctor's genuine next free slot. That is a second request
 * per doctor, so it is fetched separately and fills in as it arrives; the list
 * itself never waits on it.
 */

import { useRouter } from 'expo-router';
import { useQueries, useQuery } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { BookingProgress } from '@/components/booking/BookingSteps';
import { DoctorCard } from '@/components/booking/DoctorCard';
import * as publicApi from '@/api/publicBooking';
import { queryKeys } from '@/api/queryClient';
import { useBookingStore } from '@/stores/booking';
import { todayBackendDate } from '@/utils/date';

export default function ChoosePractitioner() {
  const router = useRouter();
  const department = useBookingStore((state) => state.department);
  const setPractitioner = useBookingStore((state) => state.setPractitioner);

  const doctors = useQuery({
    queryKey: queryKeys.publicPractitioners(department ?? undefined),
    queryFn: () => publicApi.listPractitioners(department ?? undefined),
  });

  const today = todayBackendDate();

  // One slot lookup per doctor, only once the list itself has arrived.
  const availability = useQueries({
    queries: (doctors.data?.items ?? []).map((doctor) => ({
      queryKey: queryKeys.publicSlots(doctor.name, today),
      queryFn: () => publicApi.availableSlots(doctor.name, today),
      staleTime: 60_000,
    })),
  });

  return (
    <Screen>
      <BackHeader
        title="Choose doctor"
        subtitle={department ?? 'All departments'}
      />
      <BookingProgress step="practitioner" />

      {doctors.isPending ? (
        <SkeletonList count={3} />
      ) : doctors.isError ? (
        <ErrorState error={doctors.error} onRetry={() => void doctors.refetch()} />
      ) : doctors.data && doctors.data.items.length > 0 ? (
        doctors.data.items.map((doctor, index) => {
          const slots = availability[index];
          const firstFree = slots?.data?.slots?.[0]?.label ?? null;

          return (
            <DoctorCard
              key={doctor.name}
              practitioner={doctor}
              nextAvailable={firstFree}
              loadingAvailability={slots?.isPending ?? true}
              onPress={() => {
                setPractitioner(doctor);
                router.push('/(public)/book/date');
              }}
            />
          );
        })
      ) : (
        <EmptyState
          title="No doctors available"
          message="There are no bookable doctors in this department right now."
          action={{ label: 'Choose another department', onPress: () => router.back() }}
        />
      )}
    </Screen>
  );
}
