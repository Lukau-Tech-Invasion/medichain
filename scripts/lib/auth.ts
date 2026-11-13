/**
 * The one place the harnesses obtain an `auth_proof`.
 *
 * Every script that signs in as a fixture account goes through
 * `deriveAuthProof`, so when the client's derivation module moves the change is
 * one import here rather than one per script. The derivation itself is the
 * client's (`PBKDF2 210k` then `HKDF`, salt `medichain-staff-credential-v1:` plus
 * the lower-cased login id): a harness that re-implemented it would drift from
 * the sign-in it exists to exercise.
 *
 * The password never travels; only this proof does, and the server keeps an
 * Argon2id verifier over it. `identifier` is the login id the verifier was
 * created for: an employee id for staff, the chosen username for a patient.
 */

export { deriveAuthProof } from '../../client/shared/src/auth/proof';

/** The shape `POST /api/auth/login` and `/api/auth/credentials/redeem` answer with. */
export interface LoginBody {
  success?: boolean;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  mfa?: unknown;
  mfa_required?: boolean;
  refresh_token?: string;
  user?: {
    user_id?: string;
    name?: string;
    role?: string;
    linked_patient_id?: string | null;
  };
}
