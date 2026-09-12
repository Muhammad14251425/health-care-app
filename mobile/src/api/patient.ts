/**
 * The patient's own data.
 *
 * Every function here is self-scoped: none of them takes a patient id, because
 * none of the endpoints accepts one. If you find yourself wanting to add a
 * `patient` argument, the answer is no -- that is the IDOR this design removes.
 */

import { callApi } from '@/api/client';
import type {
  PatientAppointment,
  PatientBillingSummary,
  PatientDiagnostic,
  PatientDiagnosticDetail,
  PatientHome,
  PatientInvoice,
  PatientInvoiceDetail,
  PatientPrescription,
  PatientProfile,
  PatientRecordsSummary,
  PatientVisit,
  PatientVisitRecord,
} from '@/types/patient';

type List<T> = { items: T[]; total: number };

// --------------------------------------------------------------------------- //
// Profile
// --------------------------------------------------------------------------- //
export function me(): Promise<PatientProfile> {
  return callApi<PatientProfile>('patient.me');
}

export function home(): Promise<PatientHome> {
  return callApi<PatientHome>('patient.home');
}

/** Only the fields the backend allows a patient to change (email, landline). */
export function updateMe(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<PatientProfile> {
  return callApi<PatientProfile>('patient.update_me', { payload: input });
}

// --------------------------------------------------------------------------- //
// Appointments
// --------------------------------------------------------------------------- //
export type AppointmentScope = 'upcoming' | 'past' | 'cancelled' | 'all';

export function listAppointments(
  scope: AppointmentScope = 'upcoming',
  limit = 50,
): Promise<List<PatientAppointment> & { scope: string }> {
  return callApi('patient_appointments.list_appointments', { scope, limit });
}

export function getAppointment(appointment: string): Promise<PatientAppointment> {
  return callApi<PatientAppointment>('patient_appointments.get_appointment', {
    appointment,
  });
}

/**
 * Book an appointment.
 *
 * Note the absence of any patient field -- the server takes it from the session
 * and REJECTS a request that names one.
 */
export function createAppointment(input: {
  practitioner: string;
  date: string;
  time: string;
  appointment_type?: string;
  reason?: string | null;
}): Promise<PatientAppointment> {
  return callApi<PatientAppointment>('patient_appointments.create', { payload: input });
}

export function rescheduleAppointment(
  appointment: string,
  date: string,
  time: string,
): Promise<PatientAppointment> {
  return callApi<PatientAppointment>('patient_appointments.reschedule', {
    appointment,
    date,
    time,
  });
}

export function cancelAppointment(appointment: string): Promise<PatientAppointment> {
  return callApi<PatientAppointment>('patient_appointments.cancel', { appointment });
}

// --------------------------------------------------------------------------- //
// Records
// --------------------------------------------------------------------------- //
export function visits(limit = 50): Promise<List<PatientVisit>> {
  return callApi('patient_records.visits', { limit });
}

export function visit(encounter: string): Promise<PatientVisitRecord> {
  return callApi<PatientVisitRecord>('patient_records.visit', { encounter });
}

export function prescriptions(limit = 50): Promise<List<PatientPrescription>> {
  return callApi('patient_records.prescriptions', { limit });
}

export function diagnostics(
  limit = 50,
): Promise<List<PatientDiagnostic> & { enabled: boolean }> {
  return callApi('patient_records.diagnostics', { limit });
}

export function diagnostic(labTest: string): Promise<PatientDiagnosticDetail> {
  return callApi<PatientDiagnosticDetail>('patient_records.diagnostic', {
    lab_test: labTest,
  });
}

export function recordsSummary(): Promise<PatientRecordsSummary> {
  return callApi<PatientRecordsSummary>('patient_records.summary');
}

// --------------------------------------------------------------------------- //
// Billing (read-only -- a patient cannot alter the ledger)
// --------------------------------------------------------------------------- //
export type InvoiceFilter = 'all' | 'unpaid' | 'paid' | 'partial';

export function invoices(
  status: InvoiceFilter = 'all',
  limit = 50,
): Promise<List<PatientInvoice> & { status: string }> {
  return callApi('patient_billing.invoices', { status, limit });
}

export function invoice(name: string): Promise<PatientInvoiceDetail> {
  return callApi<PatientInvoiceDetail>('patient_billing.invoice', { invoice: name });
}

export function billingSummary(): Promise<PatientBillingSummary> {
  return callApi<PatientBillingSummary>('patient_billing.summary');
}

export function invoicePdf(name: string): Promise<{
  invoice: string;
  filename: string;
  mime_type: string;
  encoding: string;
  content: string;
  size: number;
}> {
  return callApi('patient_billing.invoice_pdf', { invoice: name });
}
