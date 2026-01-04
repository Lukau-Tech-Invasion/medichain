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

pub mod mock;
pub mod tests;

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
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
    #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub enum BloodType {
        APositive,
        ANegative,
        BPositive,
        BNegative,
        ABPositive,
        ABNegative,
        OPositive,
        ONegative,
        Unknown,
    }

    impl Default for BloodType {
        fn default() -> Self {
            BloodType::Unknown
        }
    }

    /// Medical alert for critical conditions
    #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub struct MedicalAlert {
        /// Type of alert (Allergy, ChronicCondition, etc.)
        pub alert_type: AlertType,
        /// Description hash (stored encrypted on IPFS)
        pub description_hash: [u8; 32],
        /// Severity level (1-5, 5 being most severe)
        pub severity: u8,
    }

    /// Types of medical alerts
    #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub enum AlertType {
        Allergy,
        ChronicCondition,
        Medication,
        Disability,
        Other,
    }

    impl Default for AlertType {
        fn default() -> Self {
            AlertType::Other
        }
    }

    /// Health record stored on-chain (metadata only)
    #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct HealthRecord<T: Config> {
        /// Patient account
        pub patient: T::AccountId,
        /// Blood type
        pub blood_type: BloodType,
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

    #[pallet::config]
    pub trait Config: frame_system::Config + pallet_access_control::Config {
        /// The overarching event type
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
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
        /// * `blood_type` - Patient's blood type
        /// * `ipfs_hash` - IPFS hash of encrypted full record
        ///
        /// # Errors
        /// * `NotHealthcareProvider` - Caller is not authorized
        /// * `RecordAlreadyExists` - Patient already has a record
        /// * `InvalidIpfsHash` - IPFS hash exceeds maximum length
        #[pallet::call_index(0)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn create_health_record(
            origin: OriginFor<T>,
            patient: T::AccountId,
            blood_type: BloodType,
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
                blood_type,
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
        #[pallet::weight(Weight::from_parts(10_000, 0))]
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
            ensure!(severity >= 1 && severity <= 5, Error::<T>::InvalidSeverity);

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
        #[pallet::weight(Weight::from_parts(10_000, 0))]
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
    }
}
