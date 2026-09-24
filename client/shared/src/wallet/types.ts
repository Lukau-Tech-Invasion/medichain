/**
 * MediChain Wallet Types
 * 
 * Substrate blockchain wallet types for identity management.
 * Uses SS58 address encoding compatible with Polkadot ecosystem.
 * 
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */

// Import Role from canonical types definition
import type { Role } from '../types';

// ============================================================================
// WALLET ADDRESS TYPE
// ============================================================================

/**
 * SS58 encoded Substrate address (48 characters starting with 5)
 * Example: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
 */
export type SubstrateAddress = string;

/**
 * Hex-encoded public key (64 characters, 32 bytes)
 */
export type PublicKey = string;

/**
 * Blake2-256 hash (64 characters hex)
 */
export type Hash256 = string;

// ============================================================================
// ROLE TYPES (imported from ../types to avoid duplication)
// ============================================================================

// Role is defined in ../types/index.ts - re-export from there
// Do not redefine here to avoid duplicate export issues

// ============================================================================
// NATIONAL ID TYPES (mirrors pallet-patient-identity)
// ============================================================================

/**
 * Supported national ID types across Africa
 */
export type NationalIdType = 
  | 'FaydaID'    // Ethiopia
  | 'GhanaCard'  // Ghana
  | 'NIN'        // Nigeria
  | 'SmartID';   // South Africa

// ============================================================================
// WALLET ACCOUNT INTERFACE
// ============================================================================

/**
 * A wallet account with optional metadata
 */
export interface WalletAccount {
  /** SS58 encoded address */
  address: SubstrateAddress;
  /** Human-readable name (optional) */
  name?: string;
  /** Account role in the system */
  role: Role;
  /** Public key hex */
  publicKey: PublicKey;
  /** Whether the account is verified on-chain */
  verified: boolean;
  /** Block number when registered */
  registeredAt?: number;
  /** Who registered this account (for patients) */
  registeredBy?: SubstrateAddress;
}

/**
 * Patient account
 */
export interface PatientAccount extends WalletAccount {
  role: 'Patient';
  /** Type of national ID used */
  nationalIdType: NationalIdType;
  /** Hash of national ID (never store plaintext) */
  nationalIdHash: Hash256;
  /** MediChain Health ID (derived from wallet + national ID) */
  healthId: string;
}

// ============================================================================
// WALLET CONNECTION STATE
// ============================================================================

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

// ============================================================================
// HELPER TYPE GUARDS
// ============================================================================

/**
 * Check if an account is a patient
 */
export function isPatient(account: WalletAccount): account is PatientAccount {
  return account.role === 'Patient';
}

/**
 * Check if a role can edit medical records.
 *
 * Mirrors `Role::can_edit_medical_records` in `api/src/types/domain.rs`, which
 * is the authority — this is here so the UI can hide an affordance the server
 * would refuse, never to decide anything on its own.
 *
 * `Admin` is deliberately absent from both. An administrator creates accounts
 * and assigns roles; letting the same account write clinical records means it
 * can grant itself anything and then act, with the audit trail showing a
 * legitimate role at the moment of the act. Note the contrast with
 * `canRegisterPatients` just above, which *does* include Admin — registering a
 * patient is an administrative act, and it is gated on `is_healthcare_provider`.
 */
export function canEditMedicalRecords(role: Role): boolean {
  return role === 'Doctor' || role === 'Nurse';
}

