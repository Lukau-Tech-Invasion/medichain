//! Storage migrations for the medical-records pallet.

/// v0 → v1: drop the plaintext medical alerts from every `HealthRecord`.
///
/// `add_alert` stored an alert's type (allergy, chronic condition, …) and
/// severity in the clear, keyed by the patient's account: health information
/// published on a ledger that can never correct or erase it — the reason the
/// plaintext blood type was replaced by a commitment (HZ-003). The call is
/// removed; this migration removes what it may already have written. Every
/// other field is carried over unchanged.
pub mod v1 {
    use crate::pallet::{Config, HealthRecord, HealthRecords, Pallet, MAX_IPFS_HASH_LENGTH};
    use core::marker::PhantomData;
    use frame_support::{
        migrations::VersionedMigration, pallet_prelude::*, traits::UncheckedOnRuntimeUpgrade,
    };
    use frame_system::pallet_prelude::BlockNumberFor;

    /// The most alerts a v0 record could hold.
    pub const V0_MAX_ALERTS: u32 = 10;

    /// v0 alert type, kept only to decode old records.
    #[derive(Encode, Decode, Clone, PartialEq, Eq, Debug)]
    pub enum V0AlertType {
        Allergy,
        ChronicCondition,
        Medication,
        Disability,
        Other,
    }

    /// v0 alert, kept only to decode old records.
    #[derive(Encode, Decode, Clone, PartialEq, Eq, Debug)]
    pub struct V0MedicalAlert {
        pub alert_type: V0AlertType,
        pub description_hash: [u8; 32],
        pub severity: u8,
    }

    /// The v0 `HealthRecord` layout, field for field.
    #[derive(Encode, Decode)]
    pub struct V0HealthRecord<T: Config> {
        pub patient: T::AccountId,
        pub emergency_capsule_commitment: [u8; 32],
        pub emergency_capsule_version: u32,
        pub ipfs_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>>,
        pub alerts: BoundedVec<V0MedicalAlert, ConstU32<V0_MAX_ALERTS>>,
        pub created_at: BlockNumberFor<T>,
        pub updated_at: BlockNumberFor<T>,
        pub last_modified_by: T::AccountId,
    }

    impl<T: Config> V0HealthRecord<T> {
        /// The v1 record: everything but the alerts.
        fn into_v1(self) -> HealthRecord<T> {
            HealthRecord {
                patient: self.patient,
                emergency_capsule_commitment: self.emergency_capsule_commitment,
                emergency_capsule_version: self.emergency_capsule_version,
                ipfs_hash: self.ipfs_hash,
                created_at: self.created_at,
                updated_at: self.updated_at,
                last_modified_by: self.last_modified_by,
            }
        }
    }

    /// The unversioned step; use [`MigrateV0ToV1`], which runs it once.
    pub struct InnerDropPlaintextAlerts<T>(PhantomData<T>);

    impl<T: Config> UncheckedOnRuntimeUpgrade for InnerDropPlaintextAlerts<T> {
        fn on_runtime_upgrade() -> Weight {
            let mut translated: u64 = 0;
            HealthRecords::<T>::translate::<V0HealthRecord<T>, _>(|_, old| {
                translated = translated.saturating_add(1);
                Some(old.into_v1())
            });
            T::DbWeight::get().reads_writes(translated, translated)
        }
    }

    /// v0 → v1, run only when the on-chain storage version is 0, and which
    /// then sets it to 1.
    pub type MigrateV0ToV1<T> = VersionedMigration<
        0,
        1,
        InnerDropPlaintextAlerts<T>,
        Pallet<T>,
        <T as frame_system::Config>::DbWeight,
    >;
}
