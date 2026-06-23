/**
 * MediChain Wallet Service
 * 
 * Simulates Substrate wallet functionality for development.
 * In production, this would connect to a real Substrate node.
 * 
 * Uses: ss58 address encoding, ed25519 keypairs (simulated)
 * 
 * © 2025 Trustware. All rights reserved.
 */

import type { Role } from '../types';
import type {
  SubstrateAddress,
  PublicKey,
  Hash256,
  WalletAccount,
  PatientAccount,
  ProviderAccount,
  NationalIdType,
} from './types';
// NOTE: `@polkadot/extension-dapp` + `@polkadot/util` are large and only needed
// for real (non-demo) wallet connect/sign. They are imported dynamically inside
// the two functions that use them so they stay out of the initial bundle.

// ============================================================================
// CONSTANTS
// ============================================================================

/** SS58 prefix for MediChain (42 = generic substrate) */
const SS58_PREFIX = 42;

/** Storage key for wallet data */
const WALLET_STORAGE_KEY = 'medichain_wallet';
const ACCOUNTS_STORAGE_KEY = 'medichain_accounts';

// ============================================================================
// ADDRESS GENERATION (Simulated)
// ============================================================================

/**
 * Generate a random 32-byte array (simulates keypair generation)
 */
function generateRandomBytes(length: number = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for non-browser environments
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Generate a Substrate-style SS58 address (simplified simulation)
 * Real implementation would use proper SS58 encoding with checksum
 * 
 * Format: 5 + 47 alphanumeric characters
 */
export function generateAddress(): SubstrateAddress {
  const publicKey = generateRandomBytes(32);
  const publicKeyHex = bytesToHex(publicKey);
  
  // Create a deterministic address from public key
  // In real implementation, this would be proper SS58 encoding
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let address = '5'; // Substrate addresses start with 5
  
  for (let i = 0; i < 47; i++) {
    const byte = publicKey[i % 32];
    address += chars[(byte + i) % chars.length];
  }
  
  return address;
}

/**
 * Generate a public key (simulated)
 */
export function generatePublicKey(): PublicKey {
  return bytesToHex(generateRandomBytes(32));
}

/**
 * Hash data using simulated Blake2-256
 * In production, use actual Blake2 implementation
 */
export async function blake2Hash(data: string): Promise<Hash256> {
  // Use Web Crypto API if available, otherwise simulate
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    return bytesToHex(new Uint8Array(hashBuffer));
  }
  
  // Fallback: simple hash simulation
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  // Expand to 64 character hex
  const hashStr = Math.abs(hash).toString(16).padStart(16, '0');
  return (hashStr + hashStr + hashStr + hashStr).slice(0, 64);
}

/**
 * Validate a Substrate address format
 */
export function isValidAddress(address: string): boolean {
  // Basic validation: starts with 5, 48 characters, alphanumeric
  if (!address || address.length !== 48) return false;
  if (!address.startsWith('5')) return false;
  return /^[A-Za-z0-9]+$/.test(address);
}

/**
 * Generate a MediChain Health ID from wallet address and national ID
 */
export async function generateHealthId(
  walletAddress: SubstrateAddress,
  nationalId: string
): Promise<string> {
  const combined = `${walletAddress}:${nationalId}`;
  const hash = await blake2Hash(combined);
  
  // Format: MCHI-YYYY-XXXX-XXXX (where YYYY is year, X is from hash)
  const year = new Date().getFullYear();
  const shortHash = hash.slice(0, 8).toUpperCase();
  return `MCHI-${year}-${shortHash.slice(0, 4)}-${shortHash.slice(4, 8)}`;
}

// ============================================================================
// WALLET STORAGE (In-Memory + LocalStorage)
// ============================================================================

interface StoredWallet {
  address: SubstrateAddress;
  publicKey: PublicKey;
  role: Role;
  name?: string;
  createdAt: number;
}

interface StoredAccount {
  address: SubstrateAddress;
  data: WalletAccount | PatientAccount | ProviderAccount;
}

/**
 * Get stored wallet from localStorage
 */
export function getStoredWallet(): StoredWallet | null {
  try {
    const stored = localStorage.getItem(WALLET_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

/**
 * Store wallet in localStorage
 */
export function storeWallet(wallet: StoredWallet): void {
  localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
}

/**
 * Clear stored wallet
 */
export function clearStoredWallet(): void {
  localStorage.removeItem(WALLET_STORAGE_KEY);
}

/**
 * Get all stored accounts
 */
export function getStoredAccounts(): Map<SubstrateAddress, WalletAccount> {
  try {
    const stored = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!stored) return new Map();
    
    const accounts: StoredAccount[] = JSON.parse(stored);
    return new Map(accounts.map(a => [a.address, a.data]));
  } catch {
    return new Map();
  }
}

/**
 * Store account in localStorage
 */
export function storeAccount(account: WalletAccount): void {
  const accounts = getStoredAccounts();
  accounts.set(account.address, account);
  
  const accountsArray: StoredAccount[] = Array.from(accounts.entries())
    .map(([address, data]) => ({ address, data }));
  
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accountsArray));
}

/**
 * Get account by address
 */
export function getAccount(address: SubstrateAddress): WalletAccount | null {
  const accounts = getStoredAccounts();
  return accounts.get(address) || null;
}

// ============================================================================
// WALLET CREATION
// ============================================================================

/**
 * Create a new healthcare provider wallet
 */
export function createProviderWallet(
  role: Exclude<Role, 'Patient'>,
  name: string,
  options?: {
    licenseNumber?: string;
    facility?: string;
    specialty?: string;
  }
): ProviderAccount {
  const address = generateAddress();
  const publicKey = generatePublicKey();
  
  const account: ProviderAccount = {
    address,
    publicKey,
    role,
    name,
    verified: false,
    licenseNumber: options?.licenseNumber,
    facility: options?.facility,
    specialty: options?.specialty,
  };
  
  storeAccount(account);
  return account;
}

/**
 * Create a new patient wallet (must be called by a provider)
 * @param registeredBy - Address of the healthcare provider registering the patient
 */
export async function createPatientWallet(
  name: string,
  nationalIdType: NationalIdType,
  nationalId: string,
  registeredBy: SubstrateAddress
): Promise<PatientAccount> {
  const address = generateAddress();
  const publicKey = generatePublicKey();
  const nationalIdHash = await blake2Hash(nationalId);
  const healthId = await generateHealthId(address, nationalId);
  
  const account: PatientAccount = {
    address,
    publicKey,
    role: 'Patient',
    name,
    verified: false,
    nationalIdType,
    nationalIdHash,
    healthId,
    registeredBy,
    registeredAt: Date.now(),
  };
  
  storeAccount(account);
  return account;
}

// ============================================================================
// WALLET CONNECTION (Simulated)
// ============================================================================

/**
 * Connect wallet using real Polkadot extension
 */
export async function connectRealWallet(): Promise<WalletAccount[]> {
  const { web3Accounts, web3Enable } = await import('@polkadot/extension-dapp');
  const extensions = await web3Enable('MediChain');
  if (extensions.length === 0) {
    throw new Error('No Polkadot extension found. Please install Polkadot.js or Talisman.');
  }

  const allAccounts = await web3Accounts();
  return allAccounts.map(account => ({
    address: account.address,
    name: account.meta.name,
    role: 'Patient', // Default role, should be fetched from chain
    publicKey: bytesToHex(new Uint8Array(32)), // Placeholder
    verified: false,
  }));
}

/**
 * Sign a message using the connected wallet
 */
export async function signMessage(address: SubstrateAddress, message: string): Promise<string> {
  const { web3Accounts, web3FromSource } = await import('@polkadot/extension-dapp');
  const { stringToHex } = await import('@polkadot/util');
  const account = (await web3Accounts()).find(a => a.address === address);
  if (!account) throw new Error('Account not found in extension');

  const injector = await web3FromSource(account.meta.source);
  const signRaw = injector.signer.signRaw;

  if (!signRaw) throw new Error('Signer does not support raw signing');

  const { signature } = await signRaw({
    address,
    data: stringToHex(message),
    type: 'bytes'
  });

  return signature;
}

/**
 * Connect wallet (simulates wallet extension connection if IS_DEMO=true)
 */
export async function connectWallet(address?: SubstrateAddress): Promise<WalletAccount | null> {
  // Check if we are in demo mode
  const IS_DEMO = true; // Should come from config

  if (!IS_DEMO) {
    const accounts = await connectRealWallet();
    if (address) {
      const found = accounts.find(a => a.address === address);
      if (found) {
        storeWallet({
          address: found.address,
          publicKey: found.publicKey,
          role: found.role,
          name: found.name,
          createdAt: Date.now(),
        });
        return found;
      }
    } else if (accounts.length > 0) {
      const first = accounts[0];
      storeWallet({
        address: first.address,
        publicKey: first.publicKey,
        role: first.role,
        name: first.name,
        createdAt: Date.now(),
      });
      return first;
    }
    return null;
  }

  // Demo / Simulator logic
  if (address) {
    const account = getAccount(address);
    if (account) {
      // Store as current wallet
      storeWallet({
        address: account.address,
        publicKey: account.publicKey,
        role: account.role,
        name: account.name,
        createdAt: Date.now(),
      });
      return account;
    }
    return null;
  }
  
  // Check if we have a stored wallet
  const stored = getStoredWallet();
  if (stored) {
    const account = getAccount(stored.address);
    if (account) return account;
  }
  
  return null;
}

/**
 * Disconnect wallet
 */
export function disconnectWallet(): void {
  clearStoredWallet();
}

/**
 * Get currently connected wallet
 */
export function getCurrentWallet(): WalletAccount | null {
  const stored = getStoredWallet();
  if (!stored) return null;
  return getAccount(stored.address);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Shorten address for display: 5Grw...utQY
 */
export function shortenAddress(address: SubstrateAddress): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Format role for display
 */
export function formatRole(role: Role): string {
  switch (role) {
    case 'LabTechnician':
      return 'Lab Technician';
    default:
      return role;
  }
}

/**
 * Get all accounts of a specific role
 */
export function getAccountsByRole(role: Role): WalletAccount[] {
  const accounts = getStoredAccounts();
  return Array.from(accounts.values()).filter(a => a.role === role);
}

/**
 * Get all patient accounts
 */
export function getAllPatients(): PatientAccount[] {
  return getAccountsByRole('Patient') as PatientAccount[];
}

/**
 * Get all provider accounts (non-patients)
 */
export function getAllProviders(): ProviderAccount[] {
  const accounts = getStoredAccounts();
  return Array.from(accounts.values())
    .filter(a => a.role !== 'Patient') as ProviderAccount[];
}

/**
 * Search accounts by name
 */
export function searchAccounts(query: string): WalletAccount[] {
  const accounts = getStoredAccounts();
  const lowerQuery = query.toLowerCase();
  
  return Array.from(accounts.values()).filter(a => 
    a.name?.toLowerCase().includes(lowerQuery) ||
    a.address.toLowerCase().includes(lowerQuery)
  );
}
