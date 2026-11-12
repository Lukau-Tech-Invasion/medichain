/**
 * The AMA register as the page shows it: one row per discharge, read from
 * `GET /api/platform/list/ama-discharges` (the server's `AmaRegisterRow`).
 *
 * The page used to cast the stored record to its own shape, under names the
 * record does not have, so every discharge showed no diagnosis, no statement,
 * nobody signed and today's date -- and with no status the bedside signature
 * step could not be reached. Every name the page reads is mapped here, once.
 */
import type { AmaRegisterRow } from '@medichain/shared';
import type { RiskLevel } from './AMAPage.form';

export type AmaStatus = AmaRegisterRow['status'];

export interface AmaRecord {
  id: string;
  patientId: string;
  /** When the discharge was filed; absent when the row carries no valid time. */
  filedAt?: Date;
  status: AmaStatus;
  /** Absent on a record filed before the level was stored. */
  riskLevel?: RiskLevel;
  /** The attending physician's account id; shown by name through the staff directory. */
  providerId: string;
  diagnosis?: string;
  recommendedTreatment?: string;
  patientStatement?: string;
  patientSigned: boolean;
  /** Why the patient would not sign, when they would not. */
  signatureRefusedReason?: string;
  witnessName?: string;
  witnessSigned: boolean;
  providerAttested: boolean;
}

const RISK_LEVELS: readonly RiskLevel[] = ['low', 'moderate', 'high', 'critical'];

/** A time the row carries, or nothing: never "now" standing in for a missing one. */
function timeOf(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const textOf = (value: string | null | undefined): string | undefined => value?.trim() || undefined;

export function toAmaRecord(row: AmaRegisterRow): AmaRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    filedAt: timeOf(row.created_at),
    status: row.status,
    riskLevel: RISK_LEVELS.find((level) => level === row.risk_level),
    providerId: row.attending_physician_id,
    diagnosis: textOf(row.diagnosis),
    recommendedTreatment: textOf(row.recommended_treatment),
    patientStatement: textOf(row.patient_statement),
    patientSigned: row.patient_signed,
    signatureRefusedReason: textOf(row.signature_refused_reason),
    witnessName: textOf(row.witness_name),
    witnessSigned: row.witness_signed,
    providerAttested: row.provider_attested,
  };
}

/**
 * The register's search box: the record id, the patient id or the diagnosis.
 * The patient's name is not stored on the record -- it is read from the
 * directory as each row renders -- so it cannot be searched here.
 */
export function matchesSearch(record: AmaRecord, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return [record.id, record.patientId, record.diagnosis]
    .some((value) => (value ?? '').toLowerCase().includes(term));
}
