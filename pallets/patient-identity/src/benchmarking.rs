//! Benchmarking for Patient Identity Pallet
//!
//! These benchmarks measure the actual computational cost of each extrinsic
//! to replace the placeholder Weight::from_parts(10_000, 0) values.
//!
//! Run benchmarks with:
//! ```bash
//! cargo build --release --features runtime-benchmarks
//! ./target/release/medichain-node benchmark pallet \
//!     --chain dev \
//!     --pallet pallet_patient_identity \
//!     --extrinsic '*' \
//!     --steps 50 \
//!     --repeat 20 \
//!     --output pallets/patient-identity/src/weights.rs
//! ```

#![cfg(feature = "runtime-benchmarks")]

use super::*;
use frame_benchmarking::v2::*;
use frame_system::RawOrigin;

#[benchmarks]
mod benchmarks {
    use super::*;

    /// Benchmark for register_patient extrinsic
    ///
    /// Measures the cost of registering a new patient identity.
    /// This includes:
    /// - Access control check
    /// - Writing to Identities storage
    /// - Writing to IdToAccount storage (reverse lookup)
    /// - Optionally writing to UserRoles storage
    #[benchmark]
    fn register_patient() {
        // Setup: Create healthcare provider (registrar)
        let registrar: T::AccountId = whitelisted_caller();
        let patient: T::AccountId = account("patient", 0, 0);

        // Set up registrar as a Doctor who can register patients
        pallet_access_control::UserRoles::<T>::insert(
            &registrar,
            pallet_access_control::Role::Doctor,
        );

        // Create a unique ID hash
        let id_hash: [u8; 32] = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E,
            0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C,
            0x1D, 0x1E, 0x1F, 0x20,
        ];

        #[extrinsic_call]
        register_patient(
            RawOrigin::Signed(registrar.clone()),
            patient.clone(),
            NationalIdType::FaydaID,
            id_hash,
        );

        // Verify the patient was registered
        assert!(Identities::<T>::contains_key(&patient));
        assert!(IdToAccount::<T>::contains_key(id_hash));

        let identity = Identities::<T>::get(&patient).unwrap();
        assert_eq!(identity.id_type, NationalIdType::FaydaID);
        assert_eq!(identity.id_hash, id_hash);
        assert!(!identity.verified);
        assert_eq!(identity.registered_by, registrar);
    }

    /// Benchmark for verify_identity extrinsic
    ///
    /// Measures the cost of verifying a patient's identity.
    /// This includes:
    /// - Access control check
    /// - Reading and mutating Identities storage
    #[benchmark]
    fn verify_identity() {
        // Setup: Create healthcare verifier and patient with existing identity
        let verifier: T::AccountId = whitelisted_caller();
        let patient: T::AccountId = account("patient", 0, 0);
        let registrar: T::AccountId = account("registrar", 0, 0);

        // Set up verifier as a Doctor
        pallet_access_control::UserRoles::<T>::insert(
            &verifier,
            pallet_access_control::Role::Doctor,
        );

        // Create existing unverified identity
        let current_block = frame_system::Pallet::<T>::block_number();
        let id_hash: [u8; 32] = [0xAB; 32];

        let identity = Identity {
            owner: patient.clone(),
            id_type: NationalIdType::GhanaCard,
            id_hash,
            verified: false,
            registered_at: current_block,
            registered_by: registrar,
        };

        Identities::<T>::insert(&patient, identity);
        IdToAccount::<T>::insert(id_hash, &patient);

        #[extrinsic_call]
        verify_identity(RawOrigin::Signed(verifier.clone()), patient.clone());

        // Verify the identity was marked as verified
        let updated_identity = Identities::<T>::get(&patient).unwrap();
        assert!(updated_identity.verified);
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
