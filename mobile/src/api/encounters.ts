/**
 * Clinical encounter endpoints.
 *
 * Access is narrower than it looks: probing the live backend showed that a
 * Physician can read these, while Healthcare Administrator and Nursing User
 * both receive 403 (no `Patient Encounter` permission). The backend also omits
 * symptoms/diagnosis entirely -- rather than blanking them client-side -- when
 * the caller lacks clinical access.
 */

import { callApi } from '@/api/client';
import type { Paged } from '@/types/api';
import type { Encounter, EncounterDetail } from '@/types/domain';

export type ListEncountersParams = {
  patient?: string;
  practitioner?: string;
  limit?: number;
  start?: number;
};

export function listEncounters(
  params: ListEncountersParams = {},
): Promise<Paged<Encounter>> {
  return callApi<Paged<Encounter>>('encounters.list_encounters', {
    ...params,
    limit: params.limit ?? 50,
    start: params.start ?? 0,
  });
}

export function getEncounter(encounter: string): Promise<EncounterDetail> {
  return callApi<EncounterDetail>('encounters.get_encounter', { encounter });
}

export type EncounterPayload = {
  patient: string;
  appointment?: string;
  /**
   * The clinician the note belongs to.
   *
   * A doctor may omit it -- the server fills in their own practitioner record.
   * An admin has none, so they must name one (or open the note from an
   * appointment, which the server inherits it from). The server rejects a
   * missing practitioner rather than guessing.
   */
  practitioner?: string;
  /** Accepted as a list or a comma-separated string; we always send a list. */
  symptoms?: string[];
  diagnosis?: string[];
  encounter_comment?: string;
};

export function createEncounter(payload: EncounterPayload): Promise<EncounterDetail> {
  return callApi<EncounterDetail>('encounters.create_encounter', { payload });
}

export function updateEncounter(
  encounter: string,
  payload: Partial<EncounterPayload>,
): Promise<EncounterDetail> {
  return callApi<EncounterDetail>('encounters.update_encounter', { encounter, payload });
}

/** Submitting makes the encounter immutable -- further edits return CONFLICT. */
export function submitEncounter(encounter: string): Promise<EncounterDetail> {
  return callApi<EncounterDetail>('encounters.submit_encounter', { encounter });
}
