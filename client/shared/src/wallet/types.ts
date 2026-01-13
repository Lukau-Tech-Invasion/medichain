/**
 * MediChain Wallet Types
 * 
 * Substrate blockchain wallet types for identity management.
 * Uses SS58 address encoding compatible with Polkadot ecosystem.
 * 
 * © 2025 Trustware. All rights reserved.
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

/**
 * Access type for medical records
 */
export type AccessType = 'Emergency' | 'Regular' | 'Full';

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
 * Healthcare provider account (Doctor, Nurse, etc.)
 */
export interface ProviderAccount extends WalletAccount {
  role: Exclude<Role, 'Patient'>;
  /** License number or professional ID */
  licenseNumber?: string;
  /** Affiliated healthcare facility */
  facility?: string;
  /** Specialty (for doctors) */
  specialty?: string;
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

/**
 * Wallet connection status
 */
export type WalletStatus = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'error';

/**
 * Wallet connection state
 */
export interface WalletState {
  /** Current connection status */
  status: WalletStatus;
  /** Connected account (if any) */
  account: WalletAccount | null;
  /** Error message (if status is 'error') */
  error?: string;
  /** Chain we're connected to */
  chain?: string;
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

/**
 * Transaction status
 */
export type TxStatus = 
  | 'pending' 
  | 'in_block' 
  | 'finalized' 
  | 'failed';

/**
 * Transaction result
 */
export interface TxResult {
  /** Transaction hash */
  hash: string;
  /** Current status */
  status: TxStatus;
  /** Block hash (when in_block or finalized) */
  blockHash?: string;
  /** Block number */
  blockNumber?: number;
  /** Error message (if failed) */
  error?: string;
  /** Events emitted by the transaction */
  events?: Array<{
    section: string;
    method: string;
    data: unknown;
  }>;
}

// ============================================================================
// HELPER TYPE GUARDS
// ============================================================================

/**
 * Check if an account is a healthcare provider
 */
export function isProvider(account: WalletAccount): account is ProviderAccount {
  return account.role !== 'Patient';
}

/**
 * Check if an account is a patient
 */
export function isPatient(account: WalletAccount): account is PatientAccount {
  return account.role === 'Patient';
}

/**
 * Check if a role can register patients
 */
export function canRegisterPatients(role: Role): boolean {
  return role === 'Admin' || role === 'Doctor' || role === 'Nurse';
}

/**
 * Check if a role can edit medical records
 */
export function canEditMedicalRecords(role: Role): boolean {
  return role === 'Admin' || role === 'Doctor' || role === 'Nurse';
}

/**
 * Check if a role can view all patients
 */
export function canViewAllPatients(role: Role): boolean {
  return role !== 'Patient';
}
