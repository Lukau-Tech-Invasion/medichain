/**
 * The authenticated clinician's context, in one place.
 *
 * # Why this exists
 *
 * Screens used to reach into `useAuthStore` and re-derive whatever identity
 * they needed, so anything a screen failed to derive became a form field for
 * the clinician to fill in. The appointment scheduler asking a signed-in doctor
 * to type their own 48-character SS58 address into a "Provider ID" box was the
 * visible symptom; the cause was the absence of this module
 * (`docs/WORKFLOW_AUDIT.md`, RC-1).
 *
 * The rule this hook exists to enforce: **if the session knows it, never ask
 * for it.** Any new screen needing the current user's id, wallet, role,
 * department, specialty or licence reads it here.
 *
 * This is a convenience and correctness layer for the UI only. It carries no
 * authority: the server derives the actor for every write from the
 * authenticated session and ignores identity fields sent by the client.
 */

import { useMemo } from 'react';
import { shortenAddress } from '@medichain/shared';
import { useAuthStore, type Role, type User } from '../store/authStore';

export interface CurrentProvider {
  /** True when someone is signed in. Everything below is meaningful only then. */
  isAuthenticated: boolean;
  /**
   * Whether the professional attributes have loaded from `/api/auth/me`.
   * `false` means "not known yet" — distinct from a clinician genuinely having
   * no department. Show a skeleton rather than an empty value while false.
   */
  isHydrated: boolean;

  /** Wallet address; also the provider id the API keys records by. */
  providerId: string;
  /** Same value, named for screens that mean it as a wallet rather than an id. */
  walletAddress: string;
  /** `5Grw...utQY` — the only form that belongs in ordinary clinical UI. */
  shortWallet: string;
  /** Human name to show. Never an address. */
  displayName: string;
  role: Role | null;
  department?: string;
  specialty?: string;
  licenseNumber?: string;
  email?: string;

  /** Server-computed affordances. Absent until hydrated. */
  can: {
    admin: boolean;
    viewRecords: boolean;
    editRecords: boolean;
    /** Holds a clinical role — may be attributed as a provider on a record. */
    actAsProvider: boolean;
    /** May schedule or file on another clinician's behalf. */
    actForOtherProviders: boolean;
  };

  /** The raw store user, for the rare screen that needs something else. */
  user: User | null;
}

/**
 * Fall back to the locally-known role hierarchy when the server's permission
 * block has not arrived yet.
 *
 * Kept deliberately small and marked as a fallback: the server's
 * `permissions` is authoritative and this only prevents the UI flashing an
 * empty state during hydration. It must stay consistent with the `Role`
 * methods in `api/src/types/domain.rs`.
 */
function fallbackPermissions(role: Role | null) {
  const provider: Role[] = ['Admin', 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist'];
  const editor: Role[] = ['Admin', 'Doctor', 'Nurse'];
  return {
    is_admin: role === 'Admin',
    is_healthcare_provider: role ? provider.includes(role) : false,
    can_view_medical_records: role ? provider.includes(role) : false,
    can_edit_medical_records: role ? editor.includes(role) : false,
  };
}

export function useCurrentProvider(): CurrentProvider {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.identityHydrated);

  return useMemo(() => {
    const role = user?.role ?? null;
    const permissions = user?.permissions ?? fallbackPermissions(role);
    const walletAddress = user?.walletAddress ?? '';

    return {
      isAuthenticated,
      isHydrated,
      providerId: user?.userId ?? walletAddress,
      walletAddress,
      shortWallet: walletAddress ? shortenAddress(walletAddress) : '',
      displayName: user?.username ?? '',
      role,
      department: user?.department,
      specialty: user?.specialty,
      licenseNumber: user?.licenseNumber,
      email: user?.email,
      can: {
        admin: permissions.is_admin,
        viewRecords: permissions.can_view_medical_records,
        editRecords: permissions.can_edit_medical_records,
        actAsProvider: permissions.is_healthcare_provider,
        // Only administrators may file under another clinician's name. This
        // mirrors `resolve_attributed_provider` in `api/src/support.rs`; the
        // server enforces it regardless of what this returns.
        actForOtherProviders: permissions.is_admin,
      },
      user: user ?? null,
    };
  }, [user, isAuthenticated, isHydrated]);
}
