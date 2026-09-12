/** Appointment endpoints. */

import { callApi } from '@/api/client';
import type { Paged } from '@/types/api';
import type {
  Appointment,
  AppointmentStatus,
  StaffSlotData,
  StaffSlots,
  WorkingDay,
} from '@/types/domain';

export type ListAppointmentsParams = {
  patient?: string;
  practitioner?: string;
  status?: AppointmentStatus;
  from_date?: string;
  to_date?: string;
  limit?: number;
  start?: number;
};

export function listAppointments(
  params: ListAppointmentsParams = {},
): Promise<Paged<Appointment>> {
  return callApi<Paged<Appointment>>('appointments.list_appointments', {
    ...params,
    limit: params.limit ?? 50,
    start: params.start ?? 0,
  });
}

export function getAppointment(appointment: string): Promise<Appointment> {
  return callApi<Appointment>('appointments.get_appointment', { appointment });
}

/**
 * Discrete bookable times. Derived server-side by the same function the guest
 * flow uses, so the two views cannot disagree about one calendar.
 *
 * Still advisory: create_appointment re-validates and returns 409 if the slot
 * went while the user was choosing.
 */
export function bookableSlots(practitioner: string, date: string): Promise<StaffSlots> {
  return callApi<StaffSlots>('appointments.bookable_slots', { practitioner, date });
}

/** Which of the next `limit` days the doctor works -- powers the date strip. */
export function workingDays(
  practitioner: string,
  limit = 14,
  startDate?: string,
): Promise<{ practitioner: string; days: WorkingDay[] }> {
  return callApi('appointments.working_days', {
    practitioner,
    limit,
    start_date: startDate || undefined,
  });
}

/**
 * Raw Marley schedule windows. Only the calendar timeline needs these, to draw
 * the working band -- for booking use `bookableSlots` above.
 */
export function availableSlots(practitioner: string, date: string): Promise<StaffSlotData> {
  return callApi<StaffSlotData>('appointments.available_slots', { practitioner, date });
}

export type CreateAppointmentPayload = {
  patient: string;
  practitioner: string;
  appointment_date: string;
  appointment_time: string;
  duration?: number;
  department?: string;
  appointment_type?: string;
  notes?: string;
};

export function createAppointment(
  payload: CreateAppointmentPayload,
): Promise<Appointment> {
  return callApi<Appointment>('appointments.create_appointment', { payload });
}

export function rescheduleAppointment(
  appointment: string,
  appointment_date: string,
  appointment_time: string,
): Promise<Appointment> {
  return callApi<Appointment>('appointments.reschedule_appointment', {
    appointment,
    appointment_date,
    appointment_time,
  });
}

export function cancelAppointment(appointment: string): Promise<Appointment> {
  return callApi<Appointment>('appointments.cancel_appointment', { appointment });
}

export function setStatus(
  appointment: string,
  status: AppointmentStatus,
): Promise<Appointment> {
  return callApi<Appointment>('appointments.set_status', { appointment, status });
}
