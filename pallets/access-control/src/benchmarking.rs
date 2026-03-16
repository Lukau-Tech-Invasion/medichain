//! Benchmarking for Access Control Pallet
//!
//! These benchmarks measure the actual computational cost of each extrinsic
//! to replace the placeholder Weight::from_parts(10_000, 0) values.
//!
//! Run benchmarks with:
//! ```bash
//! cargo build --release --features runtime-benchmarks
//! ./target/release/medichain-node benchmark pallet \
//!     --chain dev \
//!     --pallet pallet_access_control \
//!     --extrinsic '*' \
//!     --steps 50 \
//!     --repeat 20 \
//!     --output pallets/access-control/src/weights.rs
//! ```

#![cfg(feature = "runtime-benchmarks")]

use super::*;
use frame_benchmarking::v2::*;
use frame_support::sp_runtime::Saturating;
use frame_system::RawOrigin;

#[benchmarks]
mod benchmarks {
    use super::*;

    /// Benchmark for assign_role extrinsic
    ///
    /// Measures the cost of assigning a role to an account.
    /// Variables: None (single write operation)
    #[benchmark]
    fn assign_role() {
        // Setup: Create admin account and target account
        let admin: T::AccountId = whitelisted_caller();
        let target: T::AccountId = account("target", 0, 0);

        // Set admin role for caller (simulating genesis setup)
        UserRoles::<T>::insert(&admin, Role::Admin);

        #[extrinsic_call]
        assign_role(RawOrigin::Signed(admin), target.clone(), Role::Doctor);

        // Verify the role was assigned
        assert_eq!(UserRoles::<T>::get(&target), Some(Role::Doctor));
    }

    /// Benchmark for revoke_role extrinsic
    ///
    /// Measures the cost of revoking a role from an account.
    /// Variables: None (single read + write operation)
    #[benchmark]
    fn revoke_role() {
        // Setup: Create admin and target with existing role
        let admin: T::AccountId = whitelisted_caller();
        let target: T::AccountId = account("target", 0, 0);

        UserRoles::<T>::insert(&admin, Role::Admin);
        UserRoles::<T>::insert(&target, Role::Doctor);

        #[extrinsic_call]
        revoke_role(RawOrigin::Signed(admin), target.clone());

        // Verify the role was revoked
        assert!(!UserRoles::<T>::contains_key(&target));
    }

    /// Benchmark for grant_emergency_access extrinsic
    ///
    /// Measures the cost of granting emergency access.
    /// Variables: None (storage writes for access log and count)
    #[benchmark]
    fn grant_emergency_access() {
        // Setup: Create healthcare provider and patient
        let provider: T::AccountId = whitelisted_caller();
        let patient: T::AccountId = account("patient", 0, 0);
        let reason_hash = [0u8; 32];

        UserRoles::<T>::insert(&provider, Role::Doctor);
        UserRoles::<T>::insert(&patient, Role::Patient);

        #[extrinsic_call]
        grant_emergency_access(
            RawOrigin::Signed(provider.clone()),
            patient.clone(),
            reason_hash,
        );

        // Verify access was granted
        assert!(ActiveAccess::<T>::contains_key(&patient, &provider));
        assert_eq!(AccessCount::<T>::get(&patient), 1);
    }

    /// Benchmark for revoke_access extrinsic
    ///
    /// Measures the cost of revoking access.
    /// Variables: None (storage mutation)
    #[benchmark]
    fn revoke_access() {
        // Setup: Create provider with existing access
        let provider: T::AccountId = whitelisted_caller();
        let patient: T::AccountId = account("patient", 0, 0);
        let reason_hash = [0u8; 32];

        UserRoles::<T>::insert(&provider, Role::Doctor);
        UserRoles::<T>::insert(&patient, Role::Patient);

        // Grant access first
        let current_block = frame_system::Pallet::<T>::block_number();
        let expires_at = current_block.saturating_add(DEFAULT_ACCESS_DURATION.into());

        let access_log = AccessLog {
            accessor: provider.clone(),
            access_type: AccessType::Emergency,
            granted_at: current_block,
            expires_at,
            reason_hash,
            revoked: false,
        };

        ActiveAccess::<T>::insert(&patient, &provider, access_log);
        AccessCount::<T>::insert(&patient, 1u32);

        #[extrinsic_call]
        revoke_access(
            RawOrigin::Signed(provider.clone()),
            patient.clone(),
            provider.clone(),
        );

        // Verify access was revoked
        let access = ActiveAccess::<T>::get(&patient, &provider).unwrap();
        assert!(access.revoked);
    }

    /// Benchmark for cleanup_expired_access extrinsic
    ///
    /// Measures the cost of cleaning up expired access.
    /// Variables: None (storage removal)
    #[benchmark]
    fn cleanup_expired_access() {
        // Setup: Create expired access
        let caller: T::AccountId = whitelisted_caller();
        let provider: T::AccountId = account("provider", 0, 0);
        let patient: T::AccountId = account("patient", 0, 0);
        let reason_hash = [0u8; 32];

        UserRoles::<T>::insert(&provider, Role::Doctor);
        UserRoles::<T>::insert(&patient, Role::Patient);

        // Create already-revoked access (can be cleaned immediately)
        let current_block = frame_system::Pallet::<T>::block_number();

        let access_log = AccessLog {
            accessor: provider.clone(),
            access_type: AccessType::Emergency,
            granted_at: current_block,
            expires_at: current_block, // Already expired
            reason_hash,
            revoked: true, // Already revoked
        };

        ActiveAccess::<T>::insert(&patient, &provider, access_log);
        AccessCount::<T>::insert(&patient, 1u32);

        #[extrinsic_call]
        cleanup_expired_access(RawOrigin::Signed(caller), patient.clone(), provider.clone());

        // Verify access was cleaned up
        assert!(!ActiveAccess::<T>::contains_key(&patient, &provider));
        assert_eq!(AccessCount::<T>::get(&patient), 0);
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
