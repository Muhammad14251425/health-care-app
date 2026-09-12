/**
 * Guest booking endpoints -- the only surface reachable without signing in.
 *
 * These call clinic_core.api.v1.public.*, a deliberately narrow package added
 * for this flow. They never send a session, and they never return patient
 * records, clinical data or invoices.
 */

import { callPublicApi } from '@/api/client';
import type {
  BookingResult,
  PublicDay,
  PublicDepartment,
  PublicPractitioner,
  PublicSlots,
} from '@/types/domain';

export function listDepartments(): Promise<{ items: PublicDepartment[]; total: number }> {
  return callPublicApi('public.departments.list_departments');
}

export function listPractitioners(
  department?: string,
): Promise<{ items: PublicPractitioner[]; total: number }> {
  return callPublicApi('public.practitioners.list_practitioners', {
    department: department || undefined,
  });
}

export function getPractitioner(practitioner: string): Promise<PublicPractitioner> {
  return callPublicApi('public.practitioners.get_practitioner', { practitioner });
}

/** Which of the next `limit` days the doctor works -- powers the date strip. */
export function availableDays(
  practitioner: string,
  limit = 14,
): Promise<{ practitioner: string; days: PublicDay[] }> {
  return callPublicApi('public.availability.days', { practitioner, limit });
}

/** Discrete bookable times. Derived server-side; never invent these client-side. */
export function availableSlots(practitioner: string, date: string): Promise<PublicSlots> {
  return callPublicApi('public.availability.slots', { practitioner, date });
}

export type PublicBookingPayload = {
  first_name: string;
  last_name?: string;
  phone: string;
  email?: string;
  gender?: string;
  department?: string;
  practitioner: string;
  date: string;
  time: string;
  appointment_type?: string;
  reason?: string;
};

/**
 * Create the appointment. Throws ApiError with code CONFLICT when the slot was
 * taken between selection and submission -- callers should refresh the slots.
 */
export function createBooking(payload: PublicBookingPayload): Promise<BookingResult> {
  return callPublicApi('public.booking.create', { payload });
}

export function appointmentTypes(): Promise<{ items: Array<{ name: string; label: string }> }> {
  return callPublicApi('public.booking.appointment_types');
}
