/**
 * MediChain API endpoints: Death certificates and autopsy reports.
 */

import { getApiClient } from '../client';
import type {
  ClinicalCreateResult,
} from '../../types';

// ============================================================================
// Death certificate drafts
// ============================================================================

/** The fields a certificate carries while it is still being written. */
export interface DeathCertificateFormSections {
  decedent: Record<string, string>;
  death: Record<string, string>;
  cause: Record<string, string | boolean | null | { cause: string; duration: string }[]>;
  certifier: Record<string, string>;
}

export interface DeathCertificateDraft {
  form_sections?: DeathCertificateFormSections;
  patient_id: string;
  deceased_name?: string | null;
  date_of_birth?: string | null;
  date_of_death?: string | null;
  time_of_death?: string | null;
  place_of_death?: string | null;
  manner_of_death?: string | null;
  cause_of_death?: string | null;
  other_conditions?: string[];
  certifier_name?: string | null;
  certifier_license?: string | null;
  certifier_type?: string | null;
}

/**
 * Start a certificate without filing it.
 *
 * `createDeathCertificate` requires deceased name, date, place, cause and
 * certifier, because a filed certificate missing any of them is void. A draft
 * requires only the patient it concerns.
 */
export async function draftDeathCertificate(
  draft: DeathCertificateDraft
): Promise<{ success: boolean; id: string; status: string }> {
  return getApiClient().post('/api/surgical/death-certificate/draft', draft);
}

/** Revise a draft. Refused once the certificate has been filed. */
export async function updateDeathCertificateDraft(
  id: string,
  draft: DeathCertificateDraft
): Promise<{ success: boolean; id: string; status: string }> {
  return getApiClient().put(
    `/api/surgical/death-certificate/${encodeURIComponent(id)}`,
    draft
  );
}

/**
 * File a draft as a certificate.
 *
 * The server runs the certificate checks (deceased, date and place of death,
 * cause, certifier) and refuses a draft missing any of them; filing twice
 * answers 409. Filing the draft itself, rather than posting a new certificate,
 * is what keeps a completed draft from staying on the register beside the
 * certificate it became.
 */
export async function fileDeathCertificate(
  id: string
): Promise<{ success: boolean; id: string; status: string }> {
  return getApiClient().post(`/api/surgical/death-certificate/${encodeURIComponent(id)}/file`, {});
}

// ============================================================================
// Death Certificate & Autopsy (Phase 18)
// ============================================================================

/**
 * A certificate being filed, as opposed to drafted. Mirrors
 * `CreateDeathCertificateRequest`: the fields a draft may leave out are
 * required here, because a filed certificate missing any of them is void.
 */
export interface FileDeathCertificateRequest {
  form_sections?: DeathCertificateFormSections;
  patient_id: string;
  deceased_name: string;
  date_of_birth?: string;
  date_of_death: string;
  time_of_death?: string;
  place_of_death: string;
  manner_of_death: string;
  cause_of_death: string;
  other_conditions?: string[];
  certifier_name: string;
  certifier_license?: string;
  certifier_type?: string;
  signature?: string;
}

export async function createDeathCertificate(data: FileDeathCertificateRequest): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/death-certificate', data);
}

export async function createAutopsyReport(data: unknown): Promise<ClinicalCreateResult> {
  return getApiClient().post('/api/surgical/autopsy/report', data);
}

// ============================================================================
// Autopsy list
// ============================================================================

/** Every autopsy report on the register. */
export async function listAutopsy(): Promise<{
  success: boolean;
  reports: { total: number; items: unknown[] };
}> {
  const reports = await getApiClient().get<unknown[]>('/api/platform/list/autopsy-reports');
  return {
    success: true,
    reports: { total: (reports || []).length, items: reports || [] },
  };
}

// ============================================================================
// The death register
// ============================================================================

/**
 * Every death certificate on the register.
 *
 * The page rendered filed certificates from local component state, because the
 * only endpoint was `GET /api/surgical/death-certificate/{id}` — findable only
 * by somebody who already knew the id, which is not a register. Registrars,
 * coroners and families all arrive without one.
 */
export async function listDeathCertificates(): Promise<Record<string, unknown>[]> {
  return getApiClient().get('/api/platform/list/death-certificates');
}
