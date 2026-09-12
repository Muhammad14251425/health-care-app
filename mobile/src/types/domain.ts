/**
 * Domain types.
 *
 * Every field here was read off a live response from the running backend, not
 * inferred from documentation. Optional/nullable markers reflect what the API
 * actually returned (e.g. `designation` and `notes` came back null).
 */

// --------------------------------------------------------------------------- //
// Auth
// --------------------------------------------------------------------------- //

/** Resolved server-side. A UI hint only -- every endpoint re-checks authorization. */
export type Persona = 'admin' | 'reception' | 'practitioner' | 'patient';

export type CurrentUser = {
  user: string;
  full_name: string;
  roles: string[];
  persona: Persona;
  patient: string | null;
  practitioner: string | null;
};

export type LoginResult = CurrentUser & { sid: string };

// --------------------------------------------------------------------------- //
// Patients
// --------------------------------------------------------------------------- //

export type Patient = {
  name: string;
  patient_name: string;
  sex: string | null;
  dob: string | null;
  blood_group: string | null;
  mobile: string | null;
  email: string | null;
  status: string;
  creation: string;
};

export type PatientDetail = Patient & {
  phone?: string | null;
  possible_duplicates?: Array<{ name: string; patient_name: string }>;
};

export type VisitHistory = {
  patient: string;
  appointments: Array<{
    name: string;
    appointment_date: string;
    appointment_time: string;
    status: AppointmentStatus;
    practitioner: string;
    department: string | null;
    duration: number;
  }>;
  encounters: Array<{
    name: string;
    encounter_date: string;
    practitioner: string;
    docstatus: number;
  }>;
};

// --------------------------------------------------------------------------- //
// Practitioners
// --------------------------------------------------------------------------- //

export type Practitioner = {
  name: string;
  practitioner_name: string;
  department: string | null;
  designation: string | null;
  op_consulting_charge: number | null;
  status: string;
};

export type Department = { name: string };

export type ScheduleSlot = {
  day: string;
  from_time: string;
  to_time: string;
  /** Slot length in minutes; 0 means "unset", so the default applies. */
  duration?: number;
};

/**
 * Leave or blocked time -- one submitted Practitioner Availability row.
 *
 * `full_day` is computed by the backend (a row covering 00:00-23:59 is leave
 * rather than a block inside a working day); it is not a stored field, and the
 * distinction is only a label, since both remove the same slots.
 */
export type Unavailability = {
  name: string;
  reason: string;
  note: string | null;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  full_day: boolean;
};

/** The reasons `block_time` / `set_leave` accept -- mirrors BLOCK_REASONS. */
export const BLOCK_REASONS = [
  'Time Off',
  'Break',
  'Training',
  'Travel',
  'Emergency',
] as const;

export type BlockReason = (typeof BLOCK_REASONS)[number];

export type Availability = {
  practitioner: string;
  schedules: Array<{ schedule: string; disabled?: boolean; slots: ScheduleSlot[] }>;
  unavailability: Unavailability[];
  /**
   * Whether THIS user may do day-to-day diary work on THIS practitioner's
   * calendar -- block time, record leave. Server-decided: admin and reception
   * manage anyone, a physician only themselves. The UI hides the edit
   * affordances on false, but the endpoints re-check.
   */
  can_manage: boolean;
  /**
   * Whether THIS user may rewrite the contracted WEEKLY working hours. Narrower
   * than `can_manage`: reception can hold a slot or mark a doctor on leave, but
   * changing permanent hours is for an administrator or the doctor themselves.
   */
  can_set_hours: boolean;
};

// --------------------------------------------------------------------------- //
// Appointments
// --------------------------------------------------------------------------- //

/** The exact allowlist `appointments.set_status` accepts. */
export const APPOINTMENT_STATUSES = [
  'Scheduled',
  'Open',
  'Closed',
  'Cancelled',
  'No Show',
  'Checked In',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export type Appointment = {
  name: string;
  patient: string;
  patient_name: string;
  practitioner: string;
  practitioner_name: string;
  department: string | null;
  appointment_date: string;
  appointment_time: string;
  duration: number;
  status: AppointmentStatus;
  appointment_type: string | null;
  company: string | null;
  notes: string | null;
};

/**
 * Discrete bookable times for staff, from `appointments.bookable_slots`.
 *
 * Identical in shape to the guest flow's `PublicSlots` because both are now
 * produced by the SAME server function (clinic_core.api.v1.slots.compute_slots).
 * That is the point: availability is one answer, not a per-client opinion.
 */
export type StaffSlots = {
  practitioner: string;
  practitioner_name: string;
  date: string;
  available: boolean;
  duration: number;
  slots: Array<{ time: string; label: string; available: boolean }>;
  message: string | null;
};

/** Which of the next N days a practitioner works -- powers the date strip. */
export type WorkingDay = {
  date: string;
  weekday: string;
  day_label: string;
  day_number: string;
  available: boolean;
};

/**
 * Raw Marley availability, from `appointments.available_slots`.
 *
 * `slot_details[].avail_slot[]` holds the practitioner's schedule WINDOWS
 * (09:00-17:00), not bookable times. Only the calendar timeline still wants
 * this, to draw the working band; booking uses `StaffSlots` above.
 */
export type StaffSlotData = {
  practitioner: string;
  date: string;
  available: boolean;
  slot_details: Array<{
    slot_name: string;
    service_unit: string | null;
    avail_slot: Array<{ day: string; from_time: string; to_time: string; duration: number }>;
    appointments: Array<{ appointment_time: string; duration: number }>;
    allow_overlap: number;
    service_unit_capacity: number;
  }>;
  fee_validity?: string;
  message?: string;
};

// --------------------------------------------------------------------------- //
// Encounters (clinical -- Physician only)
// --------------------------------------------------------------------------- //

export type Encounter = {
  name: string;
  patient: string;
  patient_name: string | null;
  /** The clinician the note is ATTRIBUTED to. */
  practitioner: string;
  practitioner_name: string;
  encounter_date: string;
  encounter_time: string | null;
  docstatus: number;
  company: string | null;
  /**
   * Audit trail: the account that actually typed the note. Differs from
   * `practitioner` when an admin records a consultation on a doctor's behalf,
   * which is why both are shown rather than one standing in for the other.
   */
  entered_by: string | null;
  entered_by_name: string | null;
  entered_on_behalf: boolean;
};

export type EncounterDetail = Encounter & {
  /** Omitted entirely by the backend when the caller lacks clinical access. */
  clinical_access?: boolean;
  symptoms?: string[];
  diagnosis?: string[];
  encounter_comment?: string | null;
  appointment?: string | null;
};

// --------------------------------------------------------------------------- //
// Billing
// --------------------------------------------------------------------------- //

export type PaymentStatus = 'draft' | 'unpaid' | 'partially_paid' | 'paid' | 'cancelled';

export type Invoice = {
  name: string;
  customer: string;
  patient: string;
  patient_name: string;
  posting_date: string;
  due_date: string | null;
  grand_total: number;
  outstanding_amount: number;
  status: string;
  currency: string;
  docstatus: number;
  payment_status: PaymentStatus;
};

export type InvoiceDetail = Invoice & {
  items?: Array<{
    item_code: string | null;
    item_name: string;
    qty: number;
    rate: number;
    amount: number;
  }>;
  paid_amount?: number;
};

export type Outstanding = {
  patient: string;
  total_billed: number;
  total_outstanding: number;
  invoices: Array<{
    name: string;
    grand_total: number;
    outstanding_amount: number;
    status: string;
  }>;
};

export type Payment = {
  name: string;
  posting_date: string;
  paid_amount: number;
  mode_of_payment: string | null;
  reference_no: string | null;
  status: string;
};

export type PaymentResult = {
  payment_entry: string;
  paid_amount: number;
  invoice: string;
  grand_total: number;
  outstanding_amount: number;
  invoice_status: string;
  fully_paid: boolean;
};

// --------------------------------------------------------------------------- //
// Public booking (guest surface)
// --------------------------------------------------------------------------- //

export type PublicDepartment = { name: string; label: string };

export type PublicPractitioner = {
  name: string;
  practitioner_name: string;
  department: string | null;
  designation: string | null;
  consultation_fee: number | null;
};

export type PublicSlot = { time: string; label: string; available: boolean };

export type PublicSlots = {
  practitioner: string;
  practitioner_name: string;
  date: string;
  available: boolean;
  duration: number;
  slots: PublicSlot[];
  message: string | null;
};

export type PublicDay = {
  date: string;
  weekday: string;
  day_label: string;
  day_number: string;
  available: boolean;
};

export type BookingResult = {
  reference: string;
  practitioner: string;
  practitioner_name: string;
  department: string | null;
  date: string;
  time: string;
  duration: number;
  appointment_type: string;
  patient_name: string;
  status: string;
  new_patient: boolean;
};
