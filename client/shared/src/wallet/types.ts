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

// ============================================================================
// WALLET CONNECTION STATE
// ============================================================================

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

// ============================================================================
// HELPER TYPE GUARDS
// ============================================================================

