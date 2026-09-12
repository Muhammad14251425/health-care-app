/**
 * BUG-05 regression guard: ONE slot derivation.
 *
 * The staff flow used to fetch Marley's raw schedule windows and turn them into
 * times in the app (utils/slots.ts), while the guest flow got its times from the
 * server. Two mechanisms for one concept, and the two views could disagree about
 * the same calendar.
 *
 * These tests pin the contract that closed it:
 *   * the staff hook's endpoint returns SERVER-derived times, and
 *   * staff and guest ask endpoints backed by the same server function, so the
 *     payload shape is identical and no client-side derivation is reachable.
 *
 * The byte-identical output itself is proven backend-side in test_scheduling.py;
 * what can regress HERE is a client quietly deriving times again, so that is
 * what is asserted.
 */

import * as appointmentsApi from '@/api/appointments';
import * as publicApi from '@/api/publicBooking';

jest.mock('@/api/client', () => ({
  callApi: jest.fn(),
  callPublicApi: jest.fn(),
}));

const client = require('@/api/client') as {
  callApi: jest.Mock;
  callPublicApi: jest.Mock;
};

/** What compute_slots() returns, for either caller. */
const serverSlots = {
  practitioner: 'HP-0001',
  practitioner_name: 'Dr Ada',
  date: '2026-09-14',
  available: true,
  duration: 30,
  slots: [
    { time: '09:00:00', label: '9:00 AM', available: true },
    { time: '09:30:00', label: '9:30 AM', available: true },
  ],
  message: null,
};

beforeEach(() => {
  client.callApi.mockReset();
  client.callPublicApi.mockReset();
});

describe('staff slots come from the server', () => {
  it('calls appointments.bookable_slots, not the raw windows endpoint', async () => {
    client.callApi.mockResolvedValue(serverSlots);

    await appointmentsApi.bookableSlots('HP-0001', '2026-09-14');

    expect(client.callApi).toHaveBeenCalledWith('appointments.bookable_slots', {
      practitioner: 'HP-0001',
      date: '2026-09-14',
    });
  });

  it('returns discrete times, so the client has nothing left to derive', async () => {
    client.callApi.mockResolvedValue(serverSlots);

    const result = await appointmentsApi.bookableSlots('HP-0001', '2026-09-14');

    expect(result.slots.map((slot) => slot.time)).toEqual(['09:00:00', '09:30:00']);
    // The raw Marley shape -- schedule windows the client would have to expand.
    expect(result).not.toHaveProperty('slot_details');
  });

  it('exposes working days for the date strip', async () => {
    client.callApi.mockResolvedValue({ practitioner: 'HP-0001', days: [] });

    await appointmentsApi.workingDays('HP-0001', 14);

    expect(client.callApi).toHaveBeenCalledWith('appointments.working_days', {
      practitioner: 'HP-0001',
      limit: 14,
      start_date: undefined,
    });
  });
});

describe('staff and guest agree about one calendar', () => {
  it('both receive the same payload shape from the same derivation', async () => {
    client.callApi.mockResolvedValue(serverSlots);
    client.callPublicApi.mockResolvedValue(serverSlots);

    const staff = await appointmentsApi.bookableSlots('HP-0001', '2026-09-14');
    const guest = await publicApi.availableSlots('HP-0001', '2026-09-14');

    expect(Object.keys(staff).sort()).toEqual(Object.keys(guest).sort());
    expect(staff.slots).toEqual(guest.slots);
  });
});

describe('the client-side derivation is gone', () => {
  it('utils/slots no longer exists', () => {
    // A direct require, because an import of a deleted module would fail at
    // typecheck rather than telling us WHY it is meant to be absent.
    expect(() => require('@/utils/slots')).toThrow();
  });
});
