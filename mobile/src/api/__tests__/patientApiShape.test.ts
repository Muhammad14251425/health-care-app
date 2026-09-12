/**
 * The patient API's security-relevant SHAPE.
 *
 * These tests do not check that endpoints return the right data -- that is
 * proven end-to-end against the live backend (see PATIENT_SECURITY_TESTS.md).
 * They check the property this client layer is responsible for: that no patient
 * identifier is ever sent, so a compromised or buggy screen cannot ask for
 * somebody else's records.
 *
 * If a future change adds a `patient` parameter to any of these calls, this
 * fails -- which is the point.
 */

import * as patientApi from '@/api/patient';
import * as patientAuth from '@/api/patientAuth';

// Capture what the client layer would put on the wire.
const calls: Array<{ method: string; params: Record<string, unknown> }> = [];

jest.mock('@/api/client', () => ({
  callApi: jest.fn((method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    return Promise.resolve({});
  }),
  callPublicApi: jest.fn((method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    return Promise.resolve({});
  }),
}));

/** Every key a request could use to name a patient. */
const PATIENT_KEYS = ['patient', 'patient_id', 'patientId', 'patient_name'];

function assertNoPatientIdentifier(params: Record<string, unknown>) {
  const seen: string[] = [];

  const walk = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (PATIENT_KEYS.includes(key)) seen.push(`${path}${key}`);
      walk(child, `${path}${key}.`);
    }
  };

  walk(params, '');
  expect(seen).toEqual([]);
}

beforeEach(() => {
  calls.length = 0;
});

describe('patient API never transmits a patient identifier', () => {
  it('omits it from every read endpoint', async () => {
    await patientApi.me();
    await patientApi.home();
    await patientApi.listAppointments('upcoming');
    await patientApi.visits();
    await patientApi.prescriptions();
    await patientApi.diagnostics();
    await patientApi.recordsSummary();
    await patientApi.invoices('all');
    await patientApi.billingSummary();

    expect(calls.length).toBe(9);
    for (const call of calls) assertNoPatientIdentifier(call.params);
  });

  it('omits it when booking -- the server takes it from the session', async () => {
    await patientApi.createAppointment({
      practitioner: 'Dr Test',
      date: '2026-09-20',
      time: '10:00:00',
      reason: 'follow-up',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('patient_appointments.create');
    assertNoPatientIdentifier(calls[0]!.params);

    // The payload carries only booking facts.
    const payload = (calls[0]!.params as { payload: Record<string, unknown> }).payload;
    expect(Object.keys(payload).sort()).toEqual(
      ['date', 'practitioner', 'reason', 'time'].sort(),
    );
  });

  it('omits it when updating the profile', async () => {
    await patientApi.updateMe({ email: 'a@b.com', phone: '021 111' });

    expect(calls).toHaveLength(1);
    assertNoPatientIdentifier(calls[0]!.params);

    // Only the two fields the backend allows -- no name, dob, sex, blood group.
    const payload = (calls[0]!.params as { payload: Record<string, unknown> }).payload;
    expect(Object.keys(payload).sort()).toEqual(['email', 'phone']);
  });

  it('addresses records by record id only, never by patient', async () => {
    await patientApi.getAppointment('HLC-APP-2026-00001');
    await patientApi.visit('HLC-ENC-2026-00001');
    await patientApi.invoice('ACC-SINV-2026-00001');
    await patientApi.diagnostic('LAB-2026-00001');

    for (const call of calls) assertNoPatientIdentifier(call.params);

    expect(calls.map((c) => c.params)).toEqual([
      { appointment: 'HLC-APP-2026-00001' },
      { encounter: 'HLC-ENC-2026-00001' },
      { invoice: 'ACC-SINV-2026-00001' },
      { lab_test: 'LAB-2026-00001' },
    ]);
  });
});

describe('patient auth', () => {
  it('sends only the phone number when requesting a code', async () => {
    await patientAuth.requestOtp('0300 1234567');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('patient_auth.request_otp');
    expect(calls[0]!.params).toEqual({ phone_number: '0300 1234567' });
  });

  it('sends the phone as typed -- normalisation belongs to the server', async () => {
    await patientAuth.verifyOtp('03001234567', '123456');
    // Deliberately NOT normalised client-side: a client that formats the number
    // itself becomes a second source of truth about identity.
    expect(calls[0]!.params).toEqual({ phone_number: '03001234567', otp: '123456' });
  });

  it('sends the new number to the change-phone endpoints', async () => {
    await patientAuth.requestPhoneChange('+923009999999');
    await patientAuth.confirmPhoneChange('+923009999999', '654321');

    expect(calls[0]!.params).toEqual({ new_phone: '+923009999999' });
    expect(calls[1]!.params).toEqual({ new_phone: '+923009999999', otp: '654321' });
    for (const call of calls) assertNoPatientIdentifier(call.params);
  });
});
