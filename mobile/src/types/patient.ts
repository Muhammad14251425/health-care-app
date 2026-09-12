/**
 * Types for the patient account surface.
 *
 * These mirror what the backend actually returns (verified against the running
 * site), not what would be convenient. Where the server omits a field for
 * privacy -- clinical notes, other patients' anything -- there is deliberately
 * no type for it, so a screen cannot even ask.
 */

/** Marley `Patient Appointment` status values the patient can see. */
export type PatientAppointmentStatus =
  | 'Scheduled'
  | 'Open'
  | 'Checked In'
  | 'Closed'
  | 'Cancelled'
  | 'No Show';

export type PatientProfile = {
  name: string;
  patient_id: string;
  patient_name: string | null;
  sex: string | null;
  dob: string | null;
  blood_group: string | null;
  mobile: string | null;
  mobile_display: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  /** The number this account authenticates with, prettified by the server. */
  login_phone: string | null;
  phone_verified_on: string | null;

  upcoming: number;
  visits: number;
  outstanding: number;
  unpaid_invoices: number;
};

/** What `verify_otp` returns: identity plus the session credential. */
export type PatientSession = {
  sid: string;
  user: string;
  full_name: string | null;
  roles: string[];
  persona: 'patient';
  patient: string | null;
  /** True when the number verified but no Patient record exists yet. */
  needs_registration: boolean;
  patient_name?: string | null;
  mobile?: string | null;
  email?: string | null;
  phone?: string;
};

export type PatientAppointment = {
  name: string;
  appointment_date: string;
  appointment_time: string;
  duration: number | null;
  practitioner: string;
  practitioner_name: string | null;
  department: string | null;
  appointment_type: string | null;
  status: PatientAppointmentStatus;
  /** The reason the patient gave at booking -- never staff commentary. */
  notes: string | null;
  can_cancel?: boolean;
  can_reschedule?: boolean;
  practitioner_department?: string | null;
};

export type PatientHome = {
  patient_id: string;
  patient_name: string | null;
  counts: {
    upcoming: number;
    visits: number;
    outstanding: number;
    unpaid_invoices: number;
  };
  next_appointment: PatientAppointment | null;
  recent_visits: Array<{
    name: string;
    appointment_date: string;
    appointment_time: string;
    practitioner: string;
    practitioner_name: string | null;
    department: string | null;
    status: PatientAppointmentStatus;
  }>;
};

export type PatientVisit = {
  id: string;
  date: string;
  time: string | null;
  status: string;
  practitioner: string | null;
  practitioner_name: string | null;
  department: string | null;
  appointment_type: string | null;
  /** The encounter behind this visit, when the clinician wrote one up. */
  encounter: string | null;
  has_record: boolean;
};

/**
 * A visit's patient-safe record.
 *
 * `symptoms` and `diagnosis` are arrays because Marley stores them as
 * Table MultiSelect child rows linking to the Complaint / Diagnosis masters.
 * There is no `clinical_notes` field here because the server never sends one.
 */
export type PatientVisitRecord = {
  name: string;
  encounter_date: string;
  encounter_time: string | null;
  practitioner: string | null;
  practitioner_name: string | null;
  medical_department: string | null;
  appointment: string | null;
  appointment_type: string | null;
  symptoms: string[];
  diagnosis: string[];
  prescriptions: PatientPrescription[];
  lab_requests: Array<{ template: string | null; test_name: string | null; comment: string | null }>;
};

export type PatientPrescription = {
  id?: string;
  encounter?: string;
  drug: string | null;
  drug_name: string | null;
  dosage: string | null;
  period: string | null;
  dosage_form: string | null;
  comment: string | null;
  interval?: number | null;
  interval_uom?: string | null;
  date?: string | null;
  practitioner_name?: string | null;
};

export type PatientDiagnostic = {
  id: string;
  test_name: string | null;
  date: string | null;
  status: string;
  group?: string | null;
};

export type PatientDiagnosticDetail = {
  id: string;
  test_name: string | null;
  date: string | null;
  status: string;
  practitioner_name: string | null;
  results: Array<{
    test: string | null;
    result: string | null;
    uom: string | null;
    reference: string | null;
  }>;
  comment: string | null;
};

export type PatientRecordsSummary = {
  visits: number;
  records: number;
  prescriptions: number;
  diagnostics: number;
  /** False when the clinic does not run the lab module -- hide the section. */
  diagnostics_enabled: boolean;
};

export type PatientInvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'cancelled';

export type PatientInvoice = {
  name: string;
  posting_date: string;
  due_date: string | null;
  grand_total: number;
  outstanding_amount: number;
  paid_amount: number;
  status: string;
  payment_status: PatientInvoiceStatus;
  currency: string;
  docstatus: number;
};

export type PatientInvoiceDetail = PatientInvoice & {
  items: Array<{
    item_name: string | null;
    description: string | null;
    qty: number;
    rate: number;
    amount: number;
  }>;
  payments: Array<{
    date: string | null;
    amount: number;
    mode: string | null;
  }>;
};

export type PatientBillingSummary = {
  total_billed: number;
  total_paid: number;
  total_outstanding: number;
  unpaid_count: number;
  invoice_count: number;
  currency: string;
};
