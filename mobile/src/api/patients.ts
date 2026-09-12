/** Patient endpoints. Staff-scoped; the backend re-checks every call. */

import { callApi } from '@/api/client';
import type { Paged } from '@/types/api';
import type { Patient, PatientDetail, VisitHistory } from '@/types/domain';

export type ListPatientsParams = {
  search?: string;
  limit?: number;
  start?: number;
};

export function listPatients(params: ListPatientsParams = {}): Promise<Paged<Patient>> {
  return callApi<Paged<Patient>>('patients.list_patients', {
    search: params.search || undefined,
    limit: params.limit ?? 20,
    start: params.start ?? 0,
  });
}

export function getPatient(patient: string): Promise<PatientDetail> {
  return callApi<PatientDetail>('patients.get_patient', { patient });
}

export type CreatePatientPayload = {
  first_name: string;
  last_name?: string;
  sex: string;
  dob?: string;
  blood_group?: string;
  mobile?: string;
  email?: string;
  phone?: string;
};

export function createPatient(payload: CreatePatientPayload): Promise<PatientDetail> {
  return callApi<PatientDetail>('patients.create_patient', { payload });
}

/** The backend allowlist is mobile/email/phone/blood_group -- nothing else. */
export type UpdatePatientPayload = {
  mobile?: string;
  email?: string;
  phone?: string;
  blood_group?: string;
};

export function updatePatient(
  patient: string,
  payload: UpdatePatientPayload,
): Promise<PatientDetail> {
  return callApi<PatientDetail>('patients.update_patient', { patient, payload });
}

export function visitHistory(patient: string, limit = 50): Promise<VisitHistory> {
  return callApi<VisitHistory>('patients.visit_history', { patient, limit });
}
