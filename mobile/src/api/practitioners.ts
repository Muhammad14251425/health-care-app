/**
 * Practitioner + department endpoints (authenticated staff view).
 *
 * The write endpoints go through Marley's own Practitioner Schedule and
 * Practitioner Availability doctypes, so a change here is immediately visible
 * to the scheduler and to both booking flows -- there is no parallel store.
 *
 * All four re-check permission server-side; `Availability.can_manage` only says
 * whether to SHOW the controls.
 */

import { callApi } from '@/api/client';
import type { Paged } from '@/types/api';
import type {
  Availability,
  BlockReason,
  Department,
  Practitioner,
  ScheduleSlot,
  Unavailability,
} from '@/types/domain';

export function listPractitioners(department?: string): Promise<Paged<Practitioner>> {
  return callApi<Paged<Practitioner>>('practitioners.list_practitioners', {
    department: department || undefined,
    limit: 50,
  });
}

export function getPractitioner(practitioner: string): Promise<Practitioner> {
  return callApi<Practitioner>('practitioners.get_practitioner', { practitioner });
}

export function listDepartments(): Promise<{ items: Department[] }> {
  return callApi<{ items: Department[] }>('practitioners.list_departments');
}

export function availability(practitioner: string): Promise<Availability> {
  return callApi<Availability>('practitioners.availability', { practitioner });
}

/**
 * Replace the weekly working pattern.
 *
 * The whole pattern is sent, not a patch: a timetable is edited as a whole, and
 * a partial update has no clear meaning when a day is removed. The server
 * rejects overlapping ranges on the same day and inverted ranges.
 */
export function setSchedule(
  practitioner: string,
  slots: ScheduleSlot[],
): Promise<Availability> {
  return callApi<Availability>('practitioners.set_schedule', {
    practitioner,
    payload: { slots },
  });
}

export type BlockTimePayload = {
  date: string;
  from_time: string;
  to_time: string;
  end_date?: string;
  reason?: BlockReason;
  note?: string;
};

/**
 * Block part of a day (or the same window across a date range).
 *
 * Throws ApiError CONFLICT when appointments already sit in that window --
 * the caller should tell the user to move them first.
 */
export function blockTime(
  practitioner: string,
  payload: BlockTimePayload,
): Promise<Unavailability> {
  return callApi<Unavailability>('practitioners.block_time', { practitioner, payload });
}

export type SetLeavePayload = {
  from_date: string;
  to_date?: string;
  reason?: BlockReason;
  note?: string;
};

/** Mark whole days as leave -- the same record, covering 00:00-23:59. */
export function setLeave(
  practitioner: string,
  payload: SetLeavePayload,
): Promise<Unavailability> {
  return callApi<Unavailability>('practitioners.set_leave', { practitioner, payload });
}

/** Remove a leave / blocked-time entry, freeing those slots again. */
export function clearUnavailability(
  name: string,
): Promise<{ name: string; practitioner: string; cleared: boolean }> {
  return callApi('practitioners.clear_unavailability', { name });
}

export function unavailability(
  practitioner: string,
  includePast = false,
): Promise<{ practitioner: string; items: Unavailability[] }> {
  return callApi('practitioners.unavailability', {
    practitioner,
    include_past: includePast ? 1 : 0,
  });
}
