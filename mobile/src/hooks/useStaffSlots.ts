/**
 * Bookable slots for the staff flow.
 *
 * This hook used to fetch Marley's raw schedule windows plus the day's
 * appointments and turn them into times HERE, while the guest flow got its
 * times from the server. Two mechanisms for one concept is how two views of the
 * same calendar drift apart.
 *
 * It now calls `appointments.bookable_slots`, which runs the same server
 * function as `public.availability.slots`. The derivation -- slot length, the
 * booked-appointment overlap, leave and blocked time, the minimum lead time --
 * all lives there. That closes BUG-05.
 *
 * Still advisory: create_appointment re-validates and returns 409 on conflict,
 * and that rejection, not this list, is the source of truth.
 */

import { useQuery } from '@tanstack/react-query';
import * as appointmentsApi from '@/api/appointments';
import { queryKeys } from '@/api/queryClient';

export function useStaffSlots(practitioner: string | null, date: string | null) {
  const enabled = Boolean(practitioner && date);

  const query = useQuery({
    queryKey: queryKeys.slots(practitioner ?? 'none', date ?? 'none'),
    queryFn: () => appointmentsApi.bookableSlots(practitioner ?? '', date ?? ''),
    enabled,
    // Availability must not be served stale while someone is booking.
    staleTime: 0,
  });

  return {
    // The server only returns times that are actually free, but each slot still
    // carries `available` so the shape matches the guest flow and a future
    // "show taken slots greyed out" needs no change here.
    slots: query.data?.slots ?? [],
    available: Boolean(query.data?.available),
    /** Slot length in minutes, as the server computed it. */
    duration: query.data?.duration,
    /**
     * Why there are no slots -- "not available on Sunday", "on leave". A normal
     * answer, not an error; the screens show it in place of the slot grid.
     */
    message: query.data?.message ?? undefined,
    isPending: enabled && query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: async () => {
      await query.refetch();
    },
  };
}
