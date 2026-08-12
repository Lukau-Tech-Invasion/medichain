//! # Medical Records Pallet
//!
//! MediChain health record storage and management.
//! Stores critical medical data encrypted on IPFS with hashes on-chain.
//!
//! ## IMPORTANT: Access Control
//! - Only healthcare providers (Doctor, Nurse, Admin) can CREATE/EDIT records
//! - Patients can only READ their records (enforced at API layer)
//! - All modifications are logged with the healthcare provider who made them
//!
//! ## NASA Power of 10 Compliance
//! - Rule 1: No recursion
//! - Rule 2: All loops have fixed upper bounds (max 10 allergies)
//! - Rule 3: No dynamic memory after init
//! - Rule 6: Data objects declared at smallest scope

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(feature = "runtime-benchmarks")]
mod benchmarking;

pub mod mock;
pub mod tests;
pub mod weights;

pub use pallet::*;
pub use weights::WeightInfo;

#[frame_support::pallet]
pub mod pallet {
    use crate::weights::WeightInfo;
    use frame_support::pallet_prelude::*;
    use frame_system::pallet_prelude::*;
    use sp_std::vec::Vec;

    /// Maximum allergies per patient (Rule 2: bounded loops)
    pub const MAX_ALLERGIES: u32 = 10;
    /// Maximum IPFS hash length
    pub const MAX_IPFS_HASH_LENGTH: u32 = 64;
    /// Maximum name length
    pub const MAX_NAME_LENGTH: u32 = 128;

    /// Blood type enumeration
    #[derive(
        Clone,
        Encode,
        Decode,
        DecodeWithMemTracking,
        Eq,
        PartialEq,
        Debug,
        TypeInfo,
        MaxEncodedLen,
        Default,
    )]
    pub enum BloodType {
        APositive,
        ANegative,
        BPositive,
        BNegative,
        ABPositive,
        ABNegative,
        OPositive,
        ONegative,
        #[default]
        Unknown,
    }

    /// Medical alert for critical conditions
    #[derive(
        Clone, Encode, Decode, DecodeWithMemTracking, Eq, PartialEq, Debug, TypeInfo, MaxEncodedLen,
    )]
    pub struct MedicalAlert {
        /// Type of alert (Allergy, ChronicCondition, etc.)
        pub alert_type: AlertType,
        /// Description hash (stored encrypted on IPFS)
        pub description_hash: [u8; 32],
        /// Severity level (1-5, 5 being most severe)
        pub severity: u8,
    }

    /// Types of medical alerts
    #[derive(
        Clone,
        Encode,
        Decode,
        DecodeWithMemTracking,
        Eq,
        PartialEq,
        Debug,
        TypeInfo,
        MaxEncodedLen,
        Default,
    )]
    pub enum AlertType {
        Allergy,
        ChronicCondition,
        Medication,
        Disability,
        #[default]
        Other,
    }

    /// Health record stored on-chain (metadata only)
    #[derive(
        Clone,
        Encode,
        Decode,
        DecodeWithMemTracking,
        Eq,
        PartialEq,
        DebugNoBound,
        TypeInfo,
        MaxEncodedLen,
    )]
    #[scale_info(skip_type_params(T))]
    pub struct HealthRecord<T: Config> {
        /// Patient account
        pub patient: T::AccountId,
        /// Commitment to the patient's off-chain emergency capsule (blood type,
        /// organ-donor status, DNR status).
        ///
        /// **This replaced a plaintext `blood_type: BloodType` field**
        /// (Horizon HZ-003). A POPIA legal review on 2026-07-28 found the
        /// plaintext design unsound for real patient data: publishing health
        /// information permanently on an immutable ledger cannot satisfy the
        /// correction, deletion, and retention-limitation duties POPIA imposes,
        /// and pseudonymity does not cure it — the Information Regulator's
        /// de-identification standard asks whether data can be re-linked by a
        /// "reasonably foreseeable method", and an `AccountId` correlated to a
        /// real identity is exactly that.
        ///
        /// The emergency-read requirement that motivated the original design is
        /// unaffected: the paramedic path reads the capsule from off-chain
        /// storage (never from chain — it never did), and this commitment lets
        /// that copy be verified as untampered. See
        /// `api/src/emergency_capsule.rs` and
        /// `docs/PRODUCTION_READINESS_GATES.md` §1.
        pub emergency_capsule_commitment: [u8; 32],
        /// Version of the committed capsule, so a stale off-chain copy is
        /// distinguishable from a tampered one.
        pub emergency_capsule_version: u32,
        /// IPFS hash of encrypted full record
        pub ipfs_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>>,
        /// Medical alerts (allergies, conditions)
        pub alerts: BoundedVec<MedicalAlert, ConstU32<MAX_ALLERGIES>>,
        /// Block when created
        pub created_at: BlockNumberFor<T>,
        /// Block when last updated
        pub updated_at: BlockNumberFor<T>,
        /// Healthcare provider who created/last updated the record
        pub last_modified_by: T::AccountId,
    }

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// `RuntimeEvent` is deliberately absent: since FRAME 48 the bound is appended
    /// automatically from the supertrait, and redeclaring it here is deprecated.
    #[pallet::config]
    pub trait Config:
        frame_system::Config<RuntimeEvent: From<Event<Self>>> + pallet_access_control::Config
    {
        /// Weight information for extrinsics in this pallet
        type WeightInfo: crate::weights::WeightInfo;
    }

    /// Storage: Map patient account to health record
    #[pallet::storage]
    #[pallet::getter(fn health_records)]
    pub type HealthRecords<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, HealthRecord<T>, OptionQuery>;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Health record created [patient, ipfs_hash, created_by]
        RecordCreated {
            patient: T::AccountId,
            ipfs_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>>,
            created_by: T::AccountId,
        },
        /// Medical alert added [patient, alert_type, added_by]
        AlertAdded {
            patient: T::AccountId,
            alert_type: AlertType,
            added_by: T::AccountId,
        },
        /// IPFS hash updated [patient, new_hash, updated_by]
        IpfsHashUpdated {
            patient: T::AccountId,
            new_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>>,
            updated_by: T::AccountId,
        },
        /// Emergency capsule commitment published [patient, version, updated_by].
        /// Carries only the version, never the capsule contents.
        EmergencyCapsuleCommitmentUpdated {
            patient: T::AccountId,
            version: u32,
            updated_by: T::AccountId,
        },
    }

    #[pallet::error]
    pub enum Error<T> {
        /// Record already exists for this patient
        RecordAlreadyExists,
        /// Record not found
        RecordNotFound,
        /// Too many alerts (max 10)
        TooManyAlerts,
        /// Invalid IPFS hash format
        InvalidIpfsHash,
        /// Only healthcare providers can create/edit records
        NotHealthcareProvider,
        /// Invalid severity level
        InvalidSeverity,
        /// Capsule commitment version is not newer than the stored one
        StaleCapsuleVersion,
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Create a new health record for a patient
        ///
        /// **IMPORTANT**: Only healthcare providers (Doctor, Nurse, Admin) can create records.
        /// Patients CANNOT create their own records.
        ///
        /// # Arguments
        /// * `patient` - Patient account to create record for
        /// * `emergency_capsule_commitment` - Commitment to the off-chain
        ///   emergency capsule. Pass `[0u8; 32]` when no capsule exists yet.
        /// * `ipfs_hash` - IPFS hash of encrypted full record
        ///
        /// # Errors
        /// * `NotHealthcareProvider` - Caller is not authorized
        /// * `RecordAlreadyExists` - Patient already has a record
        /// * `InvalidIpfsHash` - IPFS hash exceeds maximum length
        #[pallet::call_index(0)]
        #[pallet::weight(<T as crate::pallet::Config>::WeightInfo::create_health_record())]
        pub fn create_health_record(
            origin: OriginFor<T>,
            patient: T::AccountId,
            emergency_capsule_commitment: [u8; 32],
            ipfs_hash: Vec<u8>,
        ) -> DispatchResult {
            let provider = ensure_signed(origin)?;

            // CRITICAL: Only healthcare providers can create records
            ensure!(
                pallet_access_control::Pallet::<T>::can_edit_medical_records(&provider),
                Error::<T>::NotHealthcareProvider
            );

            ensure!(
                !HealthRecords::<T>::contains_key(&patient),
                Error::<T>::RecordAlreadyExists
            );

            let bounded_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>> = ipfs_hash
                .try_into()
                .map_err(|_| Error::<T>::InvalidIpfsHash)?;

            let current_block = <frame_system::Pallet<T>>::block_number();

            let record = HealthRecord {
                patient: patient.clone(),
                emergency_capsule_commitment,
                // Version 0 means "no capsule committed yet"; the first real
                // commitment via `set_emergency_capsule_commitment` starts at 1.
                emergency_capsule_version: 0,
                ipfs_hash: bounded_hash.clone(),
                alerts: BoundedVec::default(),
                created_at: current_block,
                updated_at: current_block,
                last_modified_by: provider.clone(),
            };

            HealthRecords::<T>::insert(&patient, record);

            Self::deposit_event(Event::RecordCreated {
                patient,
                ipfs_hash: bounded_hash,
                created_by: provider,
            });

            Ok(())
        }

        /// Add a medical alert (allergy, condition, etc.)
        ///
        /// **IMPORTANT**: Only healthcare providers can add alerts.
        ///
        /// # Arguments
        /// * `patient` - Patient account
        /// * `alert_type` - Type of alert
        /// * `description_hash` - Hash of encrypted description
        /// * `severity` - Severity level (1-5)
        ///
        /// # Errors
        /// * `NotHealthcareProvider` - Caller is not authorized
        /// * `RecordNotFound` - No health record for patient
        /// * `TooManyAlerts` - Maximum 10 alerts reached
        /// * `InvalidSeverity` - Severity must be 1-5
        #[pallet::call_index(1)]
        #[pallet::weight(<T as crate::pallet::Config>::WeightInfo::add_alert())]
        pub fn add_alert(
            origin: OriginFor<T>,
            patient: T::AccountId,
            alert_type: AlertType,
            description_hash: [u8; 32],
            severity: u8,
        ) -> DispatchResult {
            let provider = ensure_signed(origin)?;

            // CRITICAL: Only healthcare providers can add alerts
            ensure!(
                pallet_access_control::Pallet::<T>::can_edit_medical_records(&provider),
                Error::<T>::NotHealthcareProvider
            );

            // Validate severity (Rule 6: check early)
            ensure!((1..=5).contains(&severity), Error::<T>::InvalidSeverity);

            HealthRecords::<T>::try_mutate(&patient, |maybe_record| -> DispatchResult {
                let record = maybe_record.as_mut().ok_or(Error::<T>::RecordNotFound)?;

                let alert = MedicalAlert {
                    alert_type: alert_type.clone(),
                    description_hash,
                    severity,
                };

                record
                    .alerts
                    .try_push(alert)
                    .map_err(|_| Error::<T>::TooManyAlerts)?;

                record.updated_at = <frame_system::Pallet<T>>::block_number();
                record.last_modified_by = provider.clone();

                Self::deposit_event(Event::AlertAdded {
                    patient: patient.clone(),
                    alert_type,
                    added_by: provider,
                });

                Ok(())
            })
        }

        /// Update the IPFS hash (when record is updated off-chain)
        ///
        /// **IMPORTANT**: Only healthcare providers can update records.
        ///
        /// # Arguments
        /// * `patient` - Patient account
        /// * `new_hash` - New IPFS hash of encrypted record
        ///
        /// # Errors
        /// * `NotHealthcareProvider` - Caller is not authorized
        /// * `RecordNotFound` - No health record for patient
        /// * `InvalidIpfsHash` - Hash exceeds maximum length
        #[pallet::call_index(2)]
        #[pallet::weight(<T as crate::pallet::Config>::WeightInfo::update_ipfs_hash())]
        pub fn update_ipfs_hash(
            origin: OriginFor<T>,
            patient: T::AccountId,
            new_hash: Vec<u8>,
        ) -> DispatchResult {
            let provider = ensure_signed(origin)?;

            // CRITICAL: Only healthcare providers can update records
            ensure!(
                pallet_access_control::Pallet::<T>::can_edit_medical_records(&provider),
                Error::<T>::NotHealthcareProvider
            );

            let bounded_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>> = new_hash
                .try_into()
                .map_err(|_| Error::<T>::InvalidIpfsHash)?;

            HealthRecords::<T>::try_mutate(&patient, |maybe_record| -> DispatchResult {
                let record = maybe_record.as_mut().ok_or(Error::<T>::RecordNotFound)?;

                record.ipfs_hash = bounded_hash.clone();
                record.updated_at = <frame_system::Pallet<T>>::block_number();
                record.last_modified_by = provider.clone();

                Self::deposit_event(Event::IpfsHashUpdated {
                    patient: patient.clone(),
                    new_hash: bounded_hash,
                    updated_by: provider,
                });

                Ok(())
            })
        }

        /// Publish a new commitment to the patient's off-chain emergency
        /// capsule (blood type, organ-donor status, DNR status).
        ///
        /// Replaces the previous design where those values were written to
        /// chain in the clear (Horizon HZ-003). Only the commitment goes
        /// on-chain; the capsule itself stays in controlled off-chain storage
        /// where it can be corrected and deleted, which POPIA requires and an
        /// immutable ledger cannot offer.
        ///
        /// # Arguments
        /// * `patient` - Patient account
        /// * `commitment` - 32-byte commitment to the capsule contents
        /// * `version` - Monotonically increasing capsule version
        ///
        /// # Errors
        /// * `NotHealthcareProvider` - Caller is not authorized
        /// * `RecordNotFound` - No health record for patient
        /// * `StaleCapsuleVersion` - `version` is not newer than the stored one
        #[pallet::call_index(3)]
        #[pallet::weight(<T as crate::pallet::Config>::WeightInfo::update_ipfs_hash())]
        pub fn set_emergency_capsule_commitment(
            origin: OriginFor<T>,
            patient: T::AccountId,
            commitment: [u8; 32],
            version: u32,
        ) -> DispatchResult {
            let provider = ensure_signed(origin)?;

            // Unlike the self-service `set_organ_donor_status`/`set_dnr_status`
            // extrinsics this replaces, publishing a capsule commitment is
            // provider-gated: the commitment must correspond to a capsule the
            // clinical system actually holds, so an arbitrary signed account
            // must not be able to overwrite it.
            ensure!(
                pallet_access_control::Pallet::<T>::can_edit_medical_records(&provider),
                Error::<T>::NotHealthcareProvider
            );

            HealthRecords::<T>::try_mutate(&patient, |maybe_record| -> DispatchResult {
                let record = maybe_record.as_mut().ok_or(Error::<T>::RecordNotFound)?;

                // Strictly increasing: replaying an older commitment would
                // otherwise let a superseded capsule be presented as current.
                ensure!(
                    version > record.emergency_capsule_version,
                    Error::<T>::StaleCapsuleVersion
                );

                record.emergency_capsule_commitment = commitment;
                record.emergency_capsule_version = version;
                record.updated_at = <frame_system::Pallet<T>>::block_number();
                record.last_modified_by = provider.clone();

                Self::deposit_event(Event::EmergencyCapsuleCommitmentUpdated {
                    patient: patient.clone(),
                    version,
                    updated_by: provider,
                });

                Ok(())
            })
        }

        /// Create or update the patient's emergency-capsule commitment.
        ///
        /// This is the production integration entry point: patient registration
        /// can publish version 1 before any IPFS record exists, while later
        /// clinical updates still enforce strictly increasing versions.
        #[pallet::call_index(4)]
        #[pallet::weight(<T as crate::pallet::Config>::WeightInfo::create_health_record())]
        pub fn upsert_emergency_capsule_commitment(
            origin: OriginFor<T>,
            patient: T::AccountId,
            commitment: [u8; 32],
            version: u32,
        ) -> DispatchResult {
            let provider = ensure_signed(origin)?;
            ensure!(
                pallet_access_control::Pallet::<T>::can_edit_medical_records(&provider),
                Error::<T>::NotHealthcareProvider
            );
            ensure!(version > 0, Error::<T>::StaleCapsuleVersion);

            let current_block = <frame_system::Pallet<T>>::block_number();
            let mut created = false;
            HealthRecords::<T>::try_mutate(&patient, |maybe_record| -> DispatchResult {
                if let Some(record) = maybe_record.as_mut() {
                    ensure!(
                        version > record.emergency_capsule_version,
                        Error::<T>::StaleCapsuleVersion
                    );
                    record.emergency_capsule_commitment = commitment;
                    record.emergency_capsule_version = version;
                    record.updated_at = current_block;
                    record.last_modified_by = provider.clone();
                } else {
                    created = true;
                    *maybe_record = Some(HealthRecord {
                        patient: patient.clone(),
                        emergency_capsule_commitment: commitment,
                        emergency_capsule_version: version,
                        ipfs_hash: BoundedVec::default(),
                        alerts: BoundedVec::default(),
                        created_at: current_block,
                        updated_at: current_block,
                        last_modified_by: provider.clone(),
                    });
                }
                Ok(())
            })?;

            if created {
                Self::deposit_event(Event::RecordCreated {
                    patient: patient.clone(),
                    ipfs_hash: BoundedVec::default(),
                    created_by: provider.clone(),
                });
            }
            Self::deposit_event(Event::EmergencyCapsuleCommitmentUpdated {
                patient,
                version,
                updated_by: provider,
            });
            Ok(())
        }

        /// Create an on-chain health-record shell or update its encrypted IPFS
        /// reference. No plaintext clinical data is written to the ledger.
        #[pallet::call_index(5)]
        #[pallet::weight(<T as crate::pallet::Config>::WeightInfo::create_health_record())]
        pub fn upsert_ipfs_hash(
            origin: OriginFor<T>,
            patient: T::AccountId,
            new_hash: Vec<u8>,
        ) -> DispatchResult {
            let provider = ensure_signed(origin)?;
            ensure!(
                pallet_access_control::Pallet::<T>::can_edit_medical_records(&provider),
                Error::<T>::NotHealthcareProvider
            );
            let bounded_hash: BoundedVec<u8, ConstU32<MAX_IPFS_HASH_LENGTH>> = new_hash
                .try_into()
                .map_err(|_| Error::<T>::InvalidIpfsHash)?;
            let current_block = <frame_system::Pallet<T>>::block_number();
            let mut created = false;
            HealthRecords::<T>::mutate(&patient, |maybe_record| {
                if let Some(record) = maybe_record.as_mut() {
                    record.ipfs_hash = bounded_hash.clone();
                    record.updated_at = current_block;
                    record.last_modified_by = provider.clone();
                } else {
                    created = true;
                    *maybe_record = Some(HealthRecord {
                        patient: patient.clone(),
                        emergency_capsule_commitment: [0u8; 32],
                        emergency_capsule_version: 0,
                        ipfs_hash: bounded_hash.clone(),
                        alerts: BoundedVec::default(),
                        created_at: current_block,
                        updated_at: current_block,
                        last_modified_by: provider.clone(),
                    });
                }
            });

            if created {
                Self::deposit_event(Event::RecordCreated {
                    patient,
                    ipfs_hash: bounded_hash,
                    created_by: provider,
                });
            } else {
                Self::deposit_event(Event::IpfsHashUpdated {
                    patient,
                    new_hash: bounded_hash,
                    updated_by: provider,
                });
            }
            Ok(())
        }
    }
}
