/**
 * Role helpers.
 *
 * IMPORTANT: these decide what the UI *offers*, never what is *allowed*. Every
 * endpoint enforces its own authorization server-side; hiding a button is a
 * usability decision, not a security control. The app is written so that a user
 * who reaches a forbidden action anyway gets a clean 403 message rather than a
 * crash.
 *
 * The matrix below was probed against the running backend, not assumed from the
 * role names. It is NOT a hierarchy -- admin is not a superset of doctor:
 *
 *   persona        encounters   invoices
 *   admin          403          OK
 *   practitioner   OK           403
 *   reception      403          OK
 *
 * Frappe role names (from auth.me):
 *   admin       Healthcare Administrator, System Manager, Accounts Manager, ...
 *   reception   Nursing User, Accounts User, Item Manager
 *   doctor      Physician
 */

import type { CurrentUser, Persona } from '@/types/domain';

export const Role = {
  ADMINISTRATOR: 'Administrator',
  SYSTEM_MANAGER: 'System Manager',
  HEALTHCARE_ADMIN: 'Healthcare Administrator',
  PHYSICIAN: 'Physician',
  NURSING_USER: 'Nursing User',
  ACCOUNTS_MANAGER: 'Accounts Manager',
  ACCOUNTS_USER: 'Accounts User',
  PATIENT: 'Patient',
} as const;

export type Permissions = {
  persona: Persona;
  roles: string[];

  canViewPatients: boolean;
  canCreatePatient: boolean;
  canEditPatient: boolean;

  canViewAppointments: boolean;
  canCreateAppointment: boolean;
  canManageAppointmentStatus: boolean;
  /**
   * Whether this user can edit ANY practitioner's calendar -- use it to decide
   * whether to offer the Availability screen's edit entry points at all.
   *
   * It is NOT the per-practitioner answer: a physician may manage their own
   * calendar and no one else's, which depends on WHICH practitioner is being
   * looked at. That decision belongs to the server, which returns it as
   * `can_manage` on `practitioners.availability` -- gate the controls on that.
   */
  canManageAvailability: boolean;

  /** Reading clinical notes. Physician only in this deployment. */
  canViewClinicalNotes: boolean;
  canCreateEncounter: boolean;

  canViewBilling: boolean;
  canCreateInvoice: boolean;
  canRecordPayment: boolean;
};

function has(roles: string[], ...wanted: string[]): boolean {
  return wanted.some((role) => roles.includes(role));
}

export function derivePermissions(user: CurrentUser | null): Permissions {
  const roles = user?.roles ?? [];
  const persona: Persona = user?.persona ?? 'patient';

  const isSuper = has(roles, Role.ADMINISTRATOR, Role.SYSTEM_MANAGER);
  const isHealthcareAdmin = has(roles, Role.HEALTHCARE_ADMIN);
  const isPhysician = has(roles, Role.PHYSICIAN);
  const isNursing = has(roles, Role.NURSING_USER);
  const isAccounts = has(roles, Role.ACCOUNTS_MANAGER, Role.ACCOUNTS_USER);

  const isStaff = isSuper || isHealthcareAdmin || isPhysician || isNursing || isAccounts;

  // Clinical content is gated on the Physician role. Healthcare Administrator
  // and Nursing User both receive 403 from encounters.* on this backend, so
  // offering them the screen would only produce a permission error.
  const clinical = isPhysician || isSuper;

  // BILLING = Healthcare Administrator, Accounts Manager, Accounts User,
  // Nursing User. A pure Physician is excluded (verified: 403).
  const billing = isSuper || isHealthcareAdmin || isAccounts || isNursing;

  return {
    persona,
    roles,

    canViewPatients: isStaff,
    canCreatePatient: isSuper || isHealthcareAdmin || isPhysician || isNursing,
    canEditPatient: isSuper || isHealthcareAdmin || isNursing,

    canViewAppointments: isStaff,
    canCreateAppointment: isSuper || isHealthcareAdmin || isNursing || isPhysician,
    canManageAppointmentStatus: isSuper || isHealthcareAdmin || isPhysician || isNursing,
    // Mirrors clinic_core's SCHEDULE_ROLES: reception (Nursing User) manages the
    // front-desk calendar, and a physician manages their own. The server still
    // decides per practitioner -- see the field's doc comment.
    canManageAvailability: isSuper || isHealthcareAdmin || isNursing || isPhysician,

    canViewClinicalNotes: clinical,
    canCreateEncounter: clinical || isHealthcareAdmin,

    canViewBilling: billing,
    canCreateInvoice: billing,
    canRecordPayment: billing,
  };
}

/** Copy for the role chip on the profile screen. */
export function personaLabel(persona: Persona): string {
  switch (persona) {
    case 'admin':
      return 'Administrator';
    case 'reception':
      return 'Receptionist';
    case 'practitioner':
      return 'Doctor';
    case 'patient':
      return 'Patient';
    default:
      return 'Staff';
  }
}

/** First name, for the dashboard greeting. */
export function firstName(fullName: string | undefined): string {
  if (!fullName) return 'there';
  const cleaned = fullName.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '').trim();
  return cleaned.split(/\s+/)[0] || 'there';
}

/** Two-letter initials for avatars. */
export function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name
    .replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${(parts[0] ?? '')[0] ?? ''}${(parts[parts.length - 1] ?? '')[0] ?? ''}`.toUpperCase();
}
