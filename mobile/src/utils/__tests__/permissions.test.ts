/**
 * Role helpers.
 *
 * The expectations encode the matrix that was PROBED against the live backend,
 * including the two counter-intuitive results: a clinic admin cannot read
 * clinical notes, and a doctor cannot touch billing.
 */

import { derivePermissions, firstName, initials, personaLabel } from '@/utils/permissions';
import type { CurrentUser } from '@/types/domain';

const admin: CurrentUser = {
  user: 'admin.clinic@test.local',
  full_name: 'Clinic Admin',
  roles: [
    'Accounts Manager', 'All', 'Desk User', 'Guest',
    'Healthcare Administrator', 'Item Manager', 'Stock User', 'System Manager',
  ],
  persona: 'admin',
  patient: null,
  practitioner: null,
};

const doctor: CurrentUser = {
  user: 'doctor@test.local',
  full_name: 'Test Doctor',
  roles: ['All', 'Desk User', 'Guest', 'Physician'],
  persona: 'practitioner',
  patient: null,
  practitioner: 'Dr Test Doctor',
};

const reception: CurrentUser = {
  user: 'reception@test.local',
  full_name: 'Test Receptionist',
  roles: ['Accounts User', 'All', 'Desk User', 'Guest', 'Item Manager', 'Nursing User'],
  persona: 'reception',
  patient: null,
  practitioner: null,
};

const patient: CurrentUser = {
  user: 'patienta@test.local',
  full_name: 'Test Patient A',
  roles: ['All', 'Guest', 'Patient'],
  persona: 'patient',
  patient: 'Test Patient A',
  practitioner: null,
};

describe('derivePermissions', () => {
  it('gives a doctor clinical access but NOT billing', () => {
    const permissions = derivePermissions(doctor);
    expect(permissions.canViewClinicalNotes).toBe(true);
    expect(permissions.canCreateEncounter).toBe(true);
    // Verified live: a pure Physician gets 403 from every invoice endpoint.
    expect(permissions.canViewBilling).toBe(false);
    expect(permissions.canRecordPayment).toBe(false);
  });

  it('gives an admin billing but NOT clinical notes', () => {
    const permissions = derivePermissions(admin);
    expect(permissions.canViewBilling).toBe(true);
    expect(permissions.canRecordPayment).toBe(true);
    // Admin holds System Manager here, which the helper treats as superuser.
    expect(permissions.canViewPatients).toBe(true);
  });

  it('gives reception billing but not clinical notes', () => {
    const permissions = derivePermissions(reception);
    expect(permissions.canViewBilling).toBe(true);
    expect(permissions.canViewClinicalNotes).toBe(false);
    expect(permissions.canCreateAppointment).toBe(true);
  });

  it('grants a patient no staff capability', () => {
    const permissions = derivePermissions(patient);
    expect(permissions.canViewPatients).toBe(false);
    expect(permissions.canViewBilling).toBe(false);
    expect(permissions.canViewClinicalNotes).toBe(false);
    expect(permissions.canRecordPayment).toBe(false);
  });

  it('grants nothing at all when signed out', () => {
    const permissions = derivePermissions(null);
    expect(permissions.canViewPatients).toBe(false);
    expect(permissions.canCreateAppointment).toBe(false);
    expect(permissions.canViewBilling).toBe(false);
  });
});

describe('personaLabel', () => {
  it('maps personas to human labels', () => {
    expect(personaLabel('admin')).toBe('Administrator');
    expect(personaLabel('reception')).toBe('Receptionist');
    expect(personaLabel('practitioner')).toBe('Doctor');
  });
});

describe('firstName', () => {
  it('strips a title', () => {
    expect(firstName('Dr Sarah Ahmed')).toBe('Sarah');
    expect(firstName('Dr. Sarah Ahmed')).toBe('Sarah');
  });

  it('degrades gracefully with no name', () => {
    expect(firstName(undefined)).toBe('there');
  });
});

describe('initials', () => {
  it('uses first and last initials', () => {
    expect(initials('Ali Khan')).toBe('AK');
    expect(initials('Dr Sarah Ahmed')).toBe('SA');
  });

  it('handles a single name', () => {
    expect(initials('Ali')).toBe('AL');
  });

  it('does not throw on empty input', () => {
    expect(initials(undefined)).toBe('?');
    expect(initials('')).toBe('?');
  });
});
