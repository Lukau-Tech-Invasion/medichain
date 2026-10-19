//! The sign-in proof of a password, derived on the server.
//!
//! The browser derives this proof itself when signing in, so the password does
//! not travel then. When a password is *set* (activation, recovery, change) it
//! is sent once so the server can judge its strength, and the server derives
//! the same proof here, stores Argon2id over it, and forgets the password.
//!
//! COMPATIBILITY: byte-for-byte `client/shared/src/auth/proof.ts` — PBKDF2-SHA512
//! (210,000 rounds) over the password, salted with
//! `medichain-staff-credential-v1:<login id, trimmed and lowercased>`, then the
//! HKDF-SHA256 `medichain-auth-v1` branch, as 64 lower-case hex characters. The
//! tests pin the browser's own vectors; a mismatch means a password set on the
//! server could never be used to sign in.

use hkdf::Hkdf;
use sha2::{Sha256, Sha512};
use zeroize::Zeroizing;

const PBKDF2_ITERATIONS: u32 = 210_000;
const AUTH_INFO: &[u8] = b"medichain-auth-v1";
const APP_SALT: &str = "medichain-staff-credential-v1";

/// The proof of `password` for `login_id`, as the browser computes it.
pub fn derive_auth_proof(password: &str, login_id: &str) -> String {
    let salt = format!("{APP_SALT}:{}", login_id.trim().to_lowercase());
    let mut master = Zeroizing::new([0u8; 64]);
    pbkdf2::pbkdf2_hmac::<Sha512>(
        password.as_bytes(),
        salt.as_bytes(),
        PBKDF2_ITERATIONS,
        master.as_mut(),
    );
    let hkdf = Hkdf::<Sha256>::new(Some(APP_SALT.as_bytes()), master.as_ref());
    let mut proof = Zeroizing::new([0u8; 32]);
    hkdf.expand(AUTH_INFO, proof.as_mut())
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    proof.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The vectors `client/doctor-portal/src/store/authProof.test.ts` pins for
    /// the browser. If one fails, do not edit it: fix the derivation.
    #[test]
    fn matches_the_browser_vectors() {
        assert_eq!(
            derive_auth_proof("Correct-Horse-9!", "Dr.Mbeki"),
            "30d9a1b9da818af15ff15705d3caf6a8b729d351b8e4c2aa7423e5565176de3b"
        );
        assert_eq!(
            derive_auth_proof("p", "EMP-001"),
            "cb3b3ad17ce3e4d696f86ddd165f9c331b5bdc1ac8387f20e19da7537a56fbc8"
        );
        assert_eq!(
            derive_auth_proof("pässwörd✓ 日本", "  Lerato.NKOSI "),
            "dee4831b82a6a01a93828fe72d6b72b2e11c6c59a060cec7b933fc366a63f58c"
        );
    }
}
