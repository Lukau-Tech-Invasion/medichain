//! # Patient Identity Pallet
//!
//! MediChain National Health ID registration and verification.
//! Supports: Fayda ID (Ethiopia), Ghana Card, NIN (Nigeria), Smart ID (South Africa)
//!
//! ## IMPORTANT: Access Control
//! - Patients CANNOT self-register
//! - Only healthcare providers (Doctor, Nurse, Admin) can register patients
//! - This ensures patients are registered in clinical settings
//!
//! ## NASA Power of 10 Compliance
//! - Rule 1: No recursion
//! - Rule 2: All loops have fixed upper bounds
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

    /// Maximum length for national ID (Rule 2: bounded)
    pub const MAX_ID_LENGTH: u32 = 64;
    /// Maximum length for name fields
    pub const MAX_NAME_LENGTH: u32 = 128;
    /// Maximum length for language code (ISO 639-1)
    pub const MAX_LANGUAGE_LENGTH: u32 = 8;

    /// Supported national ID types across Africa
    #[derive(
        Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default,
    )]
    pub enum NationalIdType {
        /// Ethiopia's Fayda Digital ID
        #[default]
        FaydaID,
        /// Ghana's National ID Card
        GhanaCard,
        /// Nigeria's National Identification Number
        NIN,
        /// South Africa's Smart ID Card
        SmartID,
    }

    /// DNR (Do Not Resuscitate) status
    #[derive(
        Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default,
    )]
    pub enum DnrStatus {
        /// No DNR on file (default)
        #[default]
        None,
        /// Full DNR - Do not resuscitate
        Full,
        /// Partial - Limited interventions allowed
        Partial,
        /// Unknown/Not specified
        Unknown,
    }

    /// Identity struct stored on-chain
    #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct Identity<T: Config> {
        /// Account that owns this identity
        pub owner: T::AccountId,
        /// Type of national ID
        pub id_type: NationalIdType,
        /// Blake2_256 hash of national ID (never store plaintext)
        pub id_hash: [u8; 32],
        /// Whether identity has been verified
        pub verified: bool,
        /// Block number when registered
        pub registered_at: BlockNumberFor<T>,
        /// Who registered this patient (healthcare provider)
        pub registered_by: T::AccountId,
        /// Organ donor status
        pub organ_donor: bool,
        /// Do Not Resuscitate status
        pub dnr_status: DnrStatus,
        /// Preferred language (ISO 639-1 code, e.g., "en", "am", "sw")
        pub preferred_language: BoundedVec<u8, ConstU32<MAX_LANGUAGE_LENGTH>>,
        /// Hash of photo ID document (optional)
        pub photo_id_hash: Option<[u8; 32]>,
    }

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config: frame_system::Config + pallet_access_control::Config {
        /// The overarching event type
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
        /// Weight information for extrinsics in this pallet
        type WeightInfo: crate::weights::WeightInfo;
    }

    /// Storage: Map account to identity
    #[pallet::storage]
    #[pallet::getter(fn identities)]
    pub type Identities<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, Identity<T>, OptionQuery>;

    /// Storage: Map ID hash to account (for reverse lookup)
    #[pallet::storage]
    #[pallet::getter(fn id_to_account)]
    pub type IdToAccount<T: Config> =
        StorageMap<_, Blake2_128Concat, [u8; 32], T::AccountId, OptionQuery>;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Patient identity registered by healthcare provider [patient, id_type, id_hash, registered_by]
        PatientRegistered {
            patient: T::AccountId,
            id_type: NationalIdType,
            id_hash: [u8; 32],
            registered_by: T::AccountId,
        },
        /// Identity verified [who, verifier]
        IdentityVerified {
            who: T::AccountId,
            verifier: T::AccountId,
        },
        /// Organ donor status updated
        OrganDonorStatusUpdated {
            who: T::AccountId,
            organ_donor: bool,
        },
        /// DNR status updated
        DnrStatusUpdated {
            who: T::AccountId,
            dnr_status: DnrStatus,
        },
        /// Preferred language updated
        PreferredLanguageUpdated {
            who: T::AccountId,
            language: BoundedVec<u8, ConstU32<MAX_LANGUAGE_LENGTH>>,
        },
        /// Photo ID updated
        PhotoIdUpdated {
            patient: T::AccountId,
            photo_hash: [u8; 32],
            updated_by: T::AccountId,
        },
    }

    #[pallet::error]
    pub enum Error<T> {
        /// Identity already registered for this account
        AlreadyRegistered,
        /// National ID already linked to another account
        IdAlreadyLinked,
        /// Identity not found
        IdentityNotFound,
        /// Only healthcare providers can register patients
        NotHealthcareProvider,
        /// Only healthcare providers can verify identities
        NotAuthorizedToVerify,
        /// Invalid ID format
        InvalidIdFormat,
        /// ID too long (exceeds MAX_ID_LENGTH)
        IdTooLong,
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Register a new patient identity with national ID
        ///
        /// **IMPORTANT**: Only healthcare providers (Doctor, Nurse, Admin) can register patients.
        /// Patients CANNOT self-register. This ensures all patient accounts are created
        /// in a clinical setting by authorized personnel.
        ///
        /// # Arguments
        /// * `patient` - Account to register as patient
        /// * `id_type` - Type of national ID (FaydaID, GhanaCard, etc.)
        /// * `id_hash` - Pre-computed Blake2_256 hash of the national ID
        ///
        /// # Errors
        /// * `NotHealthcareProvider` - Caller is not a Doctor, Nurse, or Admin
        /// * `AlreadyRegistered` - Account already has an identity
        /// * `IdAlreadyLinked` - ID hash linked to another account
        #[pallet::call_index(0)]
        #[pallet::weight(<T as crate::pallet::Config>::WeightInfo::register_patient())]
        pub fn register_patient(
            origin: OriginFor<T>,
            patient: T::AccountId,
            id_type: NationalIdType,
            id_hash: [u8; 32],
        ) -> DispatchResult {
            let registrar = ensure_signed(origin)?;

            // CRITICAL: Only healthcare providers can register patients
            ensure!(
                pallet_access_control::Pallet::<T>::can_register_patients(&registrar),
                Error::<T>::NotHealthcareProvider
            );

            // Rule 6: Check preconditions early
            ensure!(
                !Identities::<T>::contains_key(&patient),
                Error::<T>::AlreadyRegistered
            );
            ensure!(
                !IdToAccount::<T>::contains_key(id_hash),
                Error::<T>::IdAlreadyLinked
            );

            let current_block = <frame_system::Pallet<T>>::block_number();

            let identity = Identity {
                owner: patient.clone(),
                id_type: id_type.clone(),
                id_hash,
                verified: false,
                registered_at: current_block,
                registered_by: registrar.clone(),
                organ_donor: false,
                dnr_status: DnrStatus::None,
                preferred_language: BoundedVec::default(),
                photo_id_hash: None,
            };

            // Store identity
            Identities::<T>::insert(&patient, identity);
            IdToAccount::<T>::insert(id_hash, &patient);

            // Also assign Patient role to the new patient account
            // (This will fail if they already have a role, which is fine)
            let _ = pallet_access_control::UserRoles::<T>::try_mutate(
                &patient,
                |maybe_role| -> Result<(), ()> {
                    if maybe_role.is_none() {
                        *maybe_role = Some(pallet_access_control::Role::Patient);
                        Ok(())
                    } else {
                        Err(())
                    }
                },
            );

            Self::deposit_event(Event::PatientRegistered {
                patient,
                id_type,
                id_hash,
                registered_by: registrar,
            });

            Ok(())
        }

        /// Verify an identity (authorized verifiers only)
        ///
        /// Only healthcare providers can verify patient identities.
        ///
        /// # Arguments
        /// * `target` - Account to verify
        ///
        /// # Errors
        /// * `NotAuthorizedToVerify` - Caller is not a healthcare provider
        /// * `IdentityNotFound` - Target has no registered identity
        #[pallet::call_index(1)]
        #[pallet::weight(<T as crate::pallet::Config>::WeightInfo::verify_identity())]
        pub fn verify_identity(origin: OriginFor<T>, target: T::AccountId) -> DispatchResult {
            let verifier = ensure_signed(origin)?;

            // Only healthcare providers can verify
            ensure!(
                pallet_access_control::Pallet::<T>::is_healthcare_provider(&verifier),
                Error::<T>::NotAuthorizedToVerify
            );

            // Get and update identity
            Identities::<T>::try_mutate(&target, |maybe_identity| -> DispatchResult {
                let identity = maybe_identity
                    .as_mut()
                    .ok_or(Error::<T>::IdentityNotFound)?;

                identity.verified = true;

                Self::deposit_event(Event::IdentityVerified {
                    who: target.clone(),
                    verifier,
                });

                Ok(())
            })
        }

        /// Update organ donor status
        ///
        /// Patients can update their own organ donor status, or healthcare providers
        /// can update it on behalf of verified patients.
        ///
        /// # Arguments
        /// * `organ_donor` - New organ donor status
        #[pallet::call_index(2)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn set_organ_donor_status(origin: OriginFor<T>, organ_donor: bool) -> DispatchResult {
            let who = ensure_signed(origin)?;

            Identities::<T>::try_mutate(&who, |maybe_identity| -> DispatchResult {
                let identity = maybe_identity
                    .as_mut()
                    .ok_or(Error::<T>::IdentityNotFound)?;

                identity.organ_donor = organ_donor;

                Self::deposit_event(Event::OrganDonorStatusUpdated {
                    who: who.clone(),
                    organ_donor,
                });

                Ok(())
            })
        }

        /// Update DNR (Do Not Resuscitate) status
        ///
        /// Patients can update their own DNR status. This is a critical medical directive.
        ///
        /// # Arguments
        /// * `dnr_status` - New DNR status
        #[pallet::call_index(3)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn set_dnr_status(origin: OriginFor<T>, dnr_status: DnrStatus) -> DispatchResult {
            let who = ensure_signed(origin)?;

            Identities::<T>::try_mutate(&who, |maybe_identity| -> DispatchResult {
                let identity = maybe_identity
                    .as_mut()
                    .ok_or(Error::<T>::IdentityNotFound)?;

                identity.dnr_status = dnr_status.clone();

                Self::deposit_event(Event::DnrStatusUpdated {
                    who: who.clone(),
                    dnr_status,
                });

                Ok(())
            })
        }

        /// Update preferred language
        ///
        /// Patients can set their preferred language for medical communications.
        ///
        /// # Arguments
        /// * `language` - ISO 639-1 language code (e.g., "en", "am", "sw")
        #[pallet::call_index(4)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn set_preferred_language(
            origin: OriginFor<T>,
            language: BoundedVec<u8, ConstU32<MAX_LANGUAGE_LENGTH>>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            Identities::<T>::try_mutate(&who, |maybe_identity| -> DispatchResult {
                let identity = maybe_identity
                    .as_mut()
                    .ok_or(Error::<T>::IdentityNotFound)?;

                identity.preferred_language = language.clone();

                Self::deposit_event(Event::PreferredLanguageUpdated {
                    who: who.clone(),
                    language,
                });

                Ok(())
            })
        }

        /// Set photo ID hash
        ///
        /// Healthcare providers can upload a hash of the patient's photo ID.
        ///
        /// # Arguments
        /// * `patient` - Patient account
        /// * `photo_hash` - Blake2_256 hash of the photo ID document
        #[pallet::call_index(5)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn set_photo_id(
            origin: OriginFor<T>,
            patient: T::AccountId,
            photo_hash: [u8; 32],
        ) -> DispatchResult {
            let provider = ensure_signed(origin)?;

            // Only healthcare providers can set photo ID
            ensure!(
                pallet_access_control::Pallet::<T>::is_healthcare_provider(&provider),
                Error::<T>::NotHealthcareProvider
            );

            Identities::<T>::try_mutate(&patient, |maybe_identity| -> DispatchResult {
                let identity = maybe_identity
                    .as_mut()
                    .ok_or(Error::<T>::IdentityNotFound)?;

                identity.photo_id_hash = Some(photo_hash);

                Self::deposit_event(Event::PhotoIdUpdated {
                    patient: patient.clone(),
                    photo_hash,
                    updated_by: provider.clone(),
                });

                Ok(())
            })
        }
    }
}
