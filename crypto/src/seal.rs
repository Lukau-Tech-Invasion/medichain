//! Ed25519 signing for the sealed audit stream (ADR-0010).
//!
//! The API seals batches of audit rows into a hash chain and signs each batch
//! hash with one instance-held key. This module is the whole of that key's
//! surface: load a 32-byte seed from hex, sign, verify, and name the key.
//!
//! The seed is held only inside `ed25519_dalek::SigningKey`, which zeroizes it
//! on drop, and the intermediate buffers this module creates are zeroized as
//! soon as the key is built.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use zeroize::Zeroize;

use crate::CryptoError;

/// Length of an Ed25519 seed, public key and half a signature, in bytes.
pub const SEED_LEN: usize = 32;
/// Length of an Ed25519 signature in bytes.
pub const SIGNATURE_LEN: usize = 64;
/// Characters of a key id (the leading hex of SHA-256 over the public key).
const KEY_ID_HEX_CHARS: usize = 16;

/// The instance's audit-sealing key.
///
/// Deliberately not `Debug` or `Clone`: nothing should be able to print or
/// duplicate a signing key by accident.
pub struct SealSigner {
    key: SigningKey,
}

impl SealSigner {
    /// Build a signer from a 64-character hex seed.
    ///
    /// # Errors
    /// `InvalidKeyLength` unless the text is exactly 64 hex characters (an
    /// optional `0x` prefix is accepted).
    pub fn from_seed_hex(seed_hex: &str) -> Result<Self, CryptoError> {
        let mut decoded =
            crate::from_hex(seed_hex.trim()).map_err(|_| CryptoError::InvalidKeyLength)?;
        let mut seed = [0u8; SEED_LEN];
        let result = if decoded.len() == SEED_LEN {
            seed.copy_from_slice(&decoded);
            Ok(Self {
                key: SigningKey::from_bytes(&seed),
            })
        } else {
            Err(CryptoError::InvalidKeyLength)
        };
        decoded.zeroize();
        seed.zeroize();
        result
    }

    /// The 32-byte public key.
    pub fn public_key(&self) -> [u8; SEED_LEN] {
        self.key.verifying_key().to_bytes()
    }

    /// The short identifier a batch records as its signer.
    pub fn key_id(&self) -> String {
        key_id_of(&self.public_key())
    }

    /// Sign `message`, returning the 64-byte signature.
    pub fn sign(&self, message: &[u8]) -> [u8; SIGNATURE_LEN] {
        self.key.sign(message).to_bytes()
    }
}

/// The key id of a public key: the first 16 hex characters of its SHA-256.
pub fn key_id_of(public_key: &[u8; SEED_LEN]) -> String {
    let mut id = crate::to_hex(&crate::sha256(public_key));
    id.truncate(KEY_ID_HEX_CHARS);
    id
}

/// Whether `signature` is a valid Ed25519 signature of `message` under
/// `public_key`. Uses strict verification, which also refuses malleable
/// signatures and small-order keys. A malformed key or signature is `false`.
pub fn verify_signature(
    public_key: &[u8; SEED_LEN],
    message: &[u8],
    signature: &[u8; SIGNATURE_LEN],
) -> bool {
    let Ok(key) = VerifyingKey::from_bytes(public_key) else {
        return false;
    };
    key.verify_strict(message, &Signature::from_bytes(signature))
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: &str = "0101010101010101010101010101010101010101010101010101010101010101";

    #[test]
    fn a_signature_verifies_under_its_own_key_and_no_other_message() {
        let signer = SealSigner::from_seed_hex(SEED).unwrap();
        let signature = signer.sign(b"batch hash");
        assert!(verify_signature(
            &signer.public_key(),
            b"batch hash",
            &signature
        ));
        assert!(!verify_signature(
            &signer.public_key(),
            b"other",
            &signature
        ));
    }

    #[test]
    fn a_signature_does_not_verify_under_a_different_key() {
        let signer = SealSigner::from_seed_hex(SEED).unwrap();
        let other = SealSigner::from_seed_hex(&"02".repeat(32)).unwrap();
        let signature = signer.sign(b"batch hash");
        assert!(!verify_signature(
            &other.public_key(),
            b"batch hash",
            &signature
        ));
        assert_ne!(signer.key_id(), other.key_id());
    }

    #[test]
    fn a_flipped_signature_bit_fails() {
        let signer = SealSigner::from_seed_hex(SEED).unwrap();
        let mut signature = signer.sign(b"batch hash");
        signature[0] ^= 1;
        assert!(!verify_signature(
            &signer.public_key(),
            b"batch hash",
            &signature
        ));
    }

    #[test]
    fn seeds_of_the_wrong_shape_are_refused() {
        assert!(SealSigner::from_seed_hex("").is_err());
        assert!(SealSigner::from_seed_hex("abcd").is_err());
        assert!(SealSigner::from_seed_hex(&"zz".repeat(32)).is_err());
        assert!(SealSigner::from_seed_hex(&"01".repeat(33)).is_err());
    }

    #[test]
    fn the_key_id_is_sixteen_hex_characters_and_stable() {
        let signer = SealSigner::from_seed_hex(SEED).unwrap();
        assert_eq!(signer.key_id().len(), 16);
        assert_eq!(signer.key_id(), key_id_of(&signer.public_key()));
    }
}
