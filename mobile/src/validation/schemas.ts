/**
 * Zod schemas.
 *
 * These mirror the server's validation rather than inventing a second, stricter
 * rulebook -- a field the backend accepts must not be rejected here, and vice
 * versa, or users hit errors that make no sense. The server remains the
 * authority; this exists to give immediate, inline feedback.
 */

import { z } from 'zod';

/**
 * Phone: the backend strips spaces/dashes/parens and then requires 6-15 digits
 * with an optional leading +.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .refine((value) => {
    const compact = value.replace(/[\s\-()]/g, '');
    return /^\+?[0-9]{6,15}$/.test(compact);
  }, 'Enter a valid phone number');

export const optionalEmailSchema = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) => !value || /^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$/.test(value),
    'Enter a valid email address',
  );

/** Names: letters and ordinary punctuation, no digits or markup. */
const nameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(80, `${label} is too long`)
    .regex(/^[^\d<>{}[\]\\/|^~`$%*+=@#]+$/, `Enter a valid ${label.toLowerCase()}`);

// --------------------------------------------------------------------------- //
// Auth
// --------------------------------------------------------------------------- //

export const loginSchema = z.object({
  usr: z.string().trim().min(1, 'Email is required'),
  pwd: z.string().min(1, 'Password is required'),
});

export type LoginForm = z.infer<typeof loginSchema>;

// --------------------------------------------------------------------------- //
// Public booking
// --------------------------------------------------------------------------- //

export const bookingDetailsSchema = z.object({
  first_name: nameSchema('First name'),
  last_name: z
    .string()
    .trim()
    .max(80, 'Last name is too long')
    .optional()
    .or(z.literal('')),
  phone: phoneSchema,
  email: optionalEmailSchema.or(z.literal('')),
  reason: z.string().trim().max(280, 'Please keep this under 280 characters').optional(),
});

export type BookingDetailsForm = z.infer<typeof bookingDetailsSchema>;

// --------------------------------------------------------------------------- //
// Patients
// --------------------------------------------------------------------------- //

export const patientSchema = z.object({
  first_name: nameSchema('First name'),
  last_name: z.string().trim().max(80).optional().or(z.literal('')),
  // The backend requires sex on create.
  sex: z.string().min(1, 'Please select a gender'),
  // Supplied by DateOfBirthField, which emits YYYY-MM-DD and cannot produce a
  // malformed or future date. These checks are a backstop for programmatic
  // callers, so the messages describe the problem rather than a text format the
  // user is no longer asked to type.
  dob: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value),
      'Please choose a valid date of birth',
    )
    .refine((value) => {
      if (!value) return true;
      const parsed = new Date(`${value}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) return false;
      // Reject 2026-02-31, which passes the regex but rolls over to March.
      return value === parsed.toISOString().slice(0, 10);
    }, 'That date does not exist')
    .refine((value) => {
      if (!value) return true;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(`${value}T00:00:00`) <= today;
    }, 'Date of birth cannot be in the future'),
  mobile: phoneSchema,
  email: optionalEmailSchema.or(z.literal('')),
  blood_group: z.string().trim().optional(),
});

export type PatientForm = z.infer<typeof patientSchema>;

/** The backend's update allowlist is exactly these four fields. */
export const patientContactSchema = z.object({
  mobile: phoneSchema,
  email: optionalEmailSchema.or(z.literal('')),
  phone: z.string().trim().optional().or(z.literal('')),
  blood_group: z.string().trim().optional(),
});

export type PatientContactForm = z.infer<typeof patientContactSchema>;

// --------------------------------------------------------------------------- //
// Appointments
// --------------------------------------------------------------------------- //

export const appointmentSchema = z.object({
  patient: z.string().min(1, 'Please choose a patient'),
  practitioner: z.string().min(1, 'Please choose a doctor'),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a date'),
  appointment_time: z.string().min(1, 'Please choose a time'),
  appointment_type: z.string().optional(),
  notes: z.string().trim().max(500, 'Please keep notes under 500 characters').optional(),
});

export type AppointmentForm = z.infer<typeof appointmentSchema>;

// --------------------------------------------------------------------------- //
// Clinical encounter
// --------------------------------------------------------------------------- //

export const encounterSchema = z.object({
  patient: z.string().min(1, 'Patient is required'),
  appointment: z.string().optional(),
  /**
   * The clinician the note is attributed to.
   *
   * Required, but usually filled in for the user: a doctor writes as themselves
   * and a note opened from an appointment inherits that appointment's doctor.
   * Only an admin writing a standalone note has to choose, and for them an empty
   * value is a validation error rather than a 400 from the server.
   */
  practitioner: z.string().min(1, 'Select the doctor this note belongs to'),
  /** Free text in the UI; split into a list before sending. */
  symptoms: z.string().trim().optional(),
  diagnosis: z.string().trim().optional(),
  encounter_comment: z.string().trim().max(2000, 'Notes are too long').optional(),
});

export type EncounterForm = z.infer<typeof encounterSchema>;

/** "headache, fever" -> ["headache", "fever"] */
export function toList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// --------------------------------------------------------------------------- //
// Billing
// --------------------------------------------------------------------------- //

export const invoiceSchema = z.object({
  patient: z.string().min(1, 'Please choose a patient'),
  practitioner: z.string().min(1, 'Please choose a doctor'),
  rate: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || (Number(value.replace(/,/g, '')) > 0),
      'Enter an amount greater than zero',
    ),
});

export type InvoiceForm = z.infer<typeof invoiceSchema>;

/**
 * Payment amount. The maximum is the invoice's outstanding balance -- the
 * backend refuses overpayment, so the form should too rather than letting the
 * user submit something certain to fail.
 */
export function paymentSchema(outstanding: number) {
  return z.object({
    amount: z
      .string()
      .trim()
      .min(1, 'Enter an amount')
      .refine((value) => {
        const parsed = Number(value.replace(/,/g, ''));
        return Number.isFinite(parsed) && parsed > 0;
      }, 'Enter an amount greater than zero')
      .refine((value) => {
        const parsed = Number(value.replace(/,/g, ''));
        return parsed <= outstanding + 0.001;
      }, 'Amount cannot exceed the outstanding balance'),
    mode_of_payment: z.string().optional(),
    reference_no: z.string().trim().max(60).optional(),
  });
}

export type PaymentForm = {
  amount: string;
  mode_of_payment?: string;
  reference_no?: string;
};
