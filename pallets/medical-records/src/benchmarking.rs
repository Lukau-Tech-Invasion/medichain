//! Benchmarking for Medical Records Pallet
//!
//! These benchmarks measure the actual computational cost of each extrinsic
//! to replace the placeholder Weight::from_parts(10_000, 0) values.
//!
//! Run benchmarks with:
//! ```bash
//! cargo build --release --features runtime-benchmarks
//! ./target/release/medichain-node benchmark pallet \
//!     --chain dev \
//!     --pallet pallet_medical_records \
//!     --extrinsic '*' \
//!     --steps 50 \
//!     --repeat 20 \
//!     --output pallets/medical-records/src/weights.rs
//! ```

#![cfg(feature = "runtime-benchmarks")]

use super::*;
use frame_benchmarking::v2::*;
use frame_support::pallet_prelude::ConstU32;
use frame_support::BoundedVec;
use frame_system::RawOrigin;
use sp_std::vec;

#[benchmarks]
mod benchmarks {
    use super::*;

    /// Benchmark for create_health_record extrinsic
    ///
    /// Measures the cost of creating a new health record.
    /// Variables:
    /// - `h`: Length of IPFS hash (up to MAX_IPFS_HASH_LENGTH = 64)
    #[benchmark]
    fn create_health_record() {
        // Setup: Create healthcare provider and patient
        let provider: T::AccountId = whitelisted_caller();
        let patient: T::AccountId = account("patient", 0, 0);

        // Set up provider role via access control pallet
        pallet_access_control::UserRoles::<T>::insert(
            &provider,
            pallet_access_control::Role::Doctor,
        );
        pallet_access_control::UserRoles::<T>::insert(
            &patient,
            pallet_access_control::Role::Patient,
        );

        // Create worst-case IPFS hash (max length)
        let ipfs_hash: Vec<u8> = vec![b'Q'; MAX_IPFS_HASH_LENGTH as usize];

        #[extrinsic_call]
        create_health_record(
            RawOrigin::Signed(provider.clone()),
            patient.clone(),
            BloodType::APositive,
            ipfs_hash,
        );

        // Verify the record was created
        assert!(HealthRecords::<T>::contains_key(&patient));
        let record = HealthRecords::<T>::get(&patient).unwrap();
        assert_eq!(record.blood_type, BloodType::APositive);
        assert_eq!(record.last_modified_by, provider);
    }

    /// Benchmark for add_alert extrinsic
    ///
    /// Measures the cost of adding a medical alert.
    /// Variables:
    /// - Number of existing alerts (worst case: MAX_ALLERGIES - 1 = 9)
    #[benchmark]
    fn add_alert() {
        // Setup: Create healthcare provider and patient with existing record
        let provider: T::AccountId = whitelisted_caller();
        let patient: T::AccountId = account("patient", 0, 0);

        pallet_access_control::UserRoles::<T>::insert(
            &provider,
            pallet_access_control::Role::Doctor,
        );
        pallet_access_control::UserRoles::<T>::insert(
            &patient,
            pallet_access_control::Role::Patient,
        );

        // Create a health record with some existing alerts (worst case)
        let current_block = frame_system::Pallet::<T>::block_number();
        let ipfs_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>> =
            vec![b'Q'; 46].try_into().unwrap();

        // Create alerts close to max (leaving room for one more)
        let mut existing_alerts: BoundedVec<MedicalAlert, ConstU32<MAX_ALLERGIES>> =
            BoundedVec::default();
        for i in 0..(MAX_ALLERGIES - 1) {
            let alert = MedicalAlert {
                alert_type: AlertType::Allergy,
                description_hash: [i as u8; 32],
                severity: 3,
            };
            existing_alerts.try_push(alert).unwrap();
        }

        let record = HealthRecord {
            patient: patient.clone(),
            blood_type: BloodType::OPositive,
            ipfs_hash,
            alerts: existing_alerts,
            created_at: current_block,
            updated_at: current_block,
            last_modified_by: provider.clone(),
        };

        HealthRecords::<T>::insert(&patient, record);

        let description_hash = [0xFFu8; 32];

        #[extrinsic_call]
        add_alert(
            RawOrigin::Signed(provider.clone()),
            patient.clone(),
            AlertType::ChronicCondition,
            description_hash,
            5, // Max severity
        );

        // Verify the alert was added
        let updated_record = HealthRecords::<T>::get(&patient).unwrap();
        assert_eq!(updated_record.alerts.len(), MAX_ALLERGIES as usize);
    }

    /// Benchmark for update_ipfs_hash extrinsic
    ///
    /// Measures the cost of updating the IPFS hash.
    /// Variables:
    /// - `h`: Length of new IPFS hash (up to MAX_IPFS_HASH_LENGTH = 64)
    #[benchmark]
    fn update_ipfs_hash() {
        // Setup: Create healthcare provider and patient with existing record
        let provider: T::AccountId = whitelisted_caller();
        let patient: T::AccountId = account("patient", 0, 0);

        pallet_access_control::UserRoles::<T>::insert(
            &provider,
            pallet_access_control::Role::Doctor,
        );
        pallet_access_control::UserRoles::<T>::insert(
            &patient,
            pallet_access_control::Role::Patient,
        );

        // Create an existing health record
        let current_block = frame_system::Pallet::<T>::block_number();
        let old_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>> =
            vec![b'Q'; 46].try_into().unwrap();

        let record = HealthRecord {
            patient: patient.clone(),
            blood_type: BloodType::ABNegative,
            ipfs_hash: old_hash,
            alerts: BoundedVec::default(),
            created_at: current_block,
            updated_at: current_block,
            last_modified_by: provider.clone(),
        };

        HealthRecords::<T>::insert(&patient, record);

        // Create worst-case new hash (max length)
        let new_hash: Vec<u8> = vec![b'X'; MAX_IPFS_HASH_LENGTH as usize];

        #[extrinsic_call]
        update_ipfs_hash(
            RawOrigin::Signed(provider.clone()),
            patient.clone(),
            new_hash.clone(),
        );

        // Verify the hash was updated
        let updated_record = HealthRecords::<T>::get(&patient).unwrap();
        assert_eq!(updated_record.ipfs_hash.as_slice(), new_hash.as_slice());
        assert_eq!(updated_record.last_modified_by, provider);
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
