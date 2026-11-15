/**
 * MediChain API endpoints: Insurance cards, claims and verification.
 */

import { getApiClient } from '../client';
import type {
  VerifyInsuranceResponse,
} from '../../types';
import { readFileBytes } from './common';

// ============================================================================
// Insurance cards CRUD (Phase 13.4)
// ============================================================================

/** An insurance card is an open JSON shape; `patient_id` is required on create. */
export type InsuranceCard = Record<string, unknown> & { id?: string; patient_id: string };

/** List a patient's insurance cards. */
export async function getInsuranceCards(
  patientId: string
): Promise<{ success: boolean; cards: InsuranceCard[]; count: number }> {
  return getApiClient().get(`/api/insurance/cards/${patientId}`);
}

/** Create an insurance card (body must include `patient_id`). */
export async function createInsuranceCard(
  card: InsuranceCard
): Promise<{ success: boolean; card: InsuranceCard }> {
  return getApiClient().post('/api/insurance/cards', card);
}

/** Delete an insurance card. */
export async function deleteInsuranceCard(
  id: string
): Promise<{ success: boolean; message: string }> {
  return getApiClient().delete(`/api/insurance/cards/${id}`);
}

/** Upload a card image (base64); stored encrypted on IPFS, hash saved on the card. */
export async function uploadInsuranceCardImage(
  id: string,
  side: 'front' | 'back',
  imageBase64: string,
  contentType?: string
): Promise<{
  success: boolean;
  image_ipfs_hash: string;
  metadata_ipfs_hash: string;
  side: 'front' | 'back';
}> {
  return getApiClient().post(`/api/insurance/cards/${id}/image`, {
    side,
    image_base64: imageBase64,
    content_type: contentType,
  });
}

/** Read one authorised, encrypted insurance-card image. */
export async function downloadInsuranceCardImage(
  id: string,
  side: 'front' | 'back'
): Promise<{ success: boolean; content_base64: string; content_type: string }> {
  return getApiClient().get(`/api/insurance/cards/${encodeURIComponent(id)}/image/${side}`);
}

// ============================================================================
// Insurance Claims (Phase 30)
// ============================================================================

export async function getPatientInsuranceClaims(
  patientId: string,
  pagination?: { cursor?: string | null; limit?: number }
): Promise<{
  success: boolean;
  patient_id: string;
  claims: Record<string, unknown>[];
  count: number;
  next_cursor?: string | null;
}> {
  const params = new URLSearchParams();
  if (pagination?.cursor) params.set('cursor', pagination.cursor);
  if (pagination?.limit) params.set('limit', String(pagination.limit));
  const query = params.toString();
  return getApiClient().get(
    `/api/insurance/claims/patient/${patientId}${query ? `?${query}` : ''}`
  );
}

/** A payer's explanation of benefits filed against a claim (WP7.3). */
export interface EobDocument {
  id: string;
  claim_id: string;
  filename: string;
  content_type: 'application/pdf' | 'image/jpeg' | 'image/png';
  size_bytes: number;
  scan_status: 'clean' | 'not_scanned';
  created_at: string;
}

/** File a payer's EOB against a claim (administrators only). */
export async function uploadClaimEob(
  claimId: string,
  file: File
): Promise<{ success: boolean; document: EobDocument }> {
  const bytes = await readFileBytes(file);
  return getApiClient().postBinary(
    `/api/insurance/claims/${encodeURIComponent(claimId)}/eob?filename=${encodeURIComponent(file.name)}`,
    bytes,
    file.type
  );
}

/** Download an EOB (the claim's patient or an administrator; audited). */
export async function downloadClaimEob(
  claimId: string,
  documentId: string
): Promise<{ blob: Blob; contentType: string }> {
  return getApiClient().getBlob(
    `/api/insurance/claims/${encodeURIComponent(claimId)}/eob/${encodeURIComponent(documentId)}`
  );
}

// ============================================================================
// Insurance
// ============================================================================

/**
 * Verify patient insurance
 */
export async function verifyInsurance(patientId: string): Promise<VerifyInsuranceResponse> {
  return getApiClient().post('/api/insurance/verify', { patient_id: patientId });
}
