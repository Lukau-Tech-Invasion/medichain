//! # Access Control Pallet (Role-Based Access Control)
//!
//! MediChain access management with role-based permissions.
//! Healthcare providers can manage patient records based on their roles.
//! Patients can only read their own records (enforced at API layer).
//!
//! ## Key Principle
//! - Patients CANNOT self-register; must be registered by healthcare provider
//! - Doctors/Nurses can create and edit medical records
//! - Patients can only READ their own records (no write access)
//!
//! ## NASA Power of 10 Compliance
//! - Rule 1: No recursion
//! - Rule 2: All loops have fixed upper bounds
//! - Rule 3: No dynamic memory after init
//! - Rule 6: Data objects declared at smallest scope

#![cfg_attr(not(feature = "std"), no_std)]

pub mod mock;
pub mod tests;

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::pallet_prelude::*;
    use frame_support::sp_runtime::Saturating;
    use frame_system::pallet_prelude::*;

    /// Default emergency access duration in blocks (~15 minutes at 6s/block)
    pub const DEFAULT_ACCESS_DURATION: u32 = 150;
    /// Maximum reason length
    pub const MAX_REASON_LENGTH: u32 = 256;
    /// Maximum active accesses per patient (Rule 2: bounded)
    pub const MAX_ACTIVE_ACCESSES: u32 = 10;

    // ========================================================================
    // ROLE-BASED ACCESS CONTROL
    // ========================================================================

    /// User roles in the MediChain system
    ///
    /// Access hierarchy:
    /// - Admin: Can assign/revoke roles, full system access
    /// - Doctor: Can register patients, create/edit medical records
    /// - Nurse: Can register patients, create/edit medical records (limited)
    /// - LabTechnician: Can add lab results only
    /// - Pharmacist: Can view prescriptions, mark as dispensed
    /// - Patient: Read-only access to own records (enforced at API layer)
    #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen, Copy)]
    pub enum Role {
        /// System administrator (Ministry of Health)
        Admin,
        /// Licensed medical doctor
        Doctor,
        /// Registered nurse
        Nurse,
        /// Laboratory technician
        LabTechnician,
        /// Licensed pharmacist
        Pharmacist,
        /// Patient (read-only, cannot self-register)
        Patient,
    }

    impl Default for Role {
        fn default() -> Self {
            Role::Patient
        }
    }

    /// Type of access granted
    #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub enum AccessType {
        /// Emergency access (time-limited, auto-expires)
        Emergency,
        /// Regular access (granted by patient)
        Regular,
        /// Full access (for primary care provider)
        Full,
    }

    impl Default for AccessType {
        fn default() -> Self {
            AccessType::Emergency
        }
    }

    /// Access log entry stored on-chain
    #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct AccessLog<T: Config> {
        /// Who is accessing
        pub accessor: T::AccountId,
        /// Type of access
        pub access_type: AccessType,
        /// Block when access was granted
        pub granted_at: BlockNumberFor<T>,
        /// Block when access expires
        pub expires_at: BlockNumberFor<T>,
        /// Reason hash (stored encrypted)
        pub reason_hash: [u8; 32],
        /// Whether access has been revoked early
        pub revoked: bool,
    }

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config: frame_system::Config {
        /// The overarching event type
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
    }

    // ========================================================================
    // STORAGE
    // ========================================================================

    /// Storage: Map account to role
    /// Only accounts with a role can perform privileged operations
    #[pallet::storage]
    #[pallet::getter(fn user_roles)]
    pub type UserRoles<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, Role, OptionQuery>;

    /// Storage: Map (patient, accessor) to active access
    #[pallet::storage]
    #[pallet::getter(fn active_access)]
    pub type ActiveAccess<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        T::AccountId, // patient
        Blake2_128Concat,
        T::AccountId, // accessor
        AccessLog<T>,
        OptionQuery,
    >;

    /// Storage: Count of active accesses per patient
    #[pallet::storage]
    #[pallet::getter(fn access_count)]
    pub type AccessCount<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u32, ValueQuery>;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Role assigned to account [account, role, assigned_by]
        RoleAssigned {
            account: T::AccountId,
            role: Role,
            assigned_by: T::AccountId,
        },
        /// Role revoked from account [account, role, revoked_by]
        RoleRevoked {
            account: T::AccountId,
            role: Role,
            revoked_by: T::AccountId,
        },
        /// Emergency access granted [patient, accessor, expires_at]
        EmergencyAccessGranted {
            patient: T::AccountId,
            accessor: T::AccountId,
            expires_at: BlockNumberFor<T>,
        },
        /// Access revoked [patient, accessor]
        AccessRevoked {
            patient: T::AccountId,
            accessor: T::AccountId,
        },
        /// Expired access cleaned up [patient, accessor]
        ExpiredAccessCleaned {
            patient: T::AccountId,
            accessor: T::AccountId,
        },
    }

    #[pallet::error]
    pub enum Error<T> {
        /// Caller does not have required role
        InsufficientRole,
        /// Cannot assign Admin role (only genesis)
        CannotAssignAdmin,
        /// Account already has this role
        RoleAlreadyAssigned,
        /// Account does not have a role to revoke
        NoRoleToRevoke,
        /// Cannot revoke own role
        CannotRevokeOwnRole,
        /// Only healthcare providers can perform this action
        NotHealthcareProvider,
        /// Access already granted to this accessor
        AccessAlreadyGranted,
        /// Access not found
        AccessNotFound,
        /// Access already expired
        AccessExpired,
        /// Too many active accesses
        TooManyAccesses,
        /// Not authorized to grant access
        NotAuthorized,
        /// Cannot revoke own access
        CannotRevokeSelf,
        /// Access already revoked
        AlreadyRevoked,
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        // ====================================================================
        // ROLE MANAGEMENT EXTRINSICS
        // ====================================================================

        /// Assign a role to an account
        ///
        /// Only Admin can assign Doctor, Nurse, LabTechnician, Pharmacist roles.
        /// Patient role is assigned when registering a patient.
        ///
        /// # Arguments
        /// * `account` - Account to assign role to
        /// * `role` - Role to assign
        ///
        /// # Errors
        /// * `InsufficientRole` - Caller is not Admin
        /// * `CannotAssignAdmin` - Admin role can only be set at genesis
        /// * `RoleAlreadyAssigned` - Account already has a role
        #[pallet::call_index(0)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn assign_role(
            origin: OriginFor<T>,
            account: T::AccountId,
            role: Role,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Only Admin can assign roles
            ensure!(Self::is_admin(&who), Error::<T>::InsufficientRole);

            // Cannot assign Admin role via extrinsic (security)
            ensure!(!matches!(role, Role::Admin), Error::<T>::CannotAssignAdmin);

            // Check if account already has a role
            ensure!(
                !UserRoles::<T>::contains_key(&account),
                Error::<T>::RoleAlreadyAssigned
            );

            UserRoles::<T>::insert(&account, role);

            Self::deposit_event(Event::RoleAssigned {
                account,
                role,
                assigned_by: who,
            });

            Ok(())
        }

        /// Revoke a role from an account
        ///
        /// Only Admin can revoke roles. Cannot revoke own role.
        ///
        /// # Arguments
        /// * `account` - Account to revoke role from
        ///
        /// # Errors
        /// * `InsufficientRole` - Caller is not Admin
        /// * `NoRoleToRevoke` - Account has no role
        /// * `CannotRevokeOwnRole` - Cannot revoke your own role
        #[pallet::call_index(1)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn revoke_role(origin: OriginFor<T>, account: T::AccountId) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Only Admin can revoke roles
            ensure!(Self::is_admin(&who), Error::<T>::InsufficientRole);

            // Cannot revoke own role
            ensure!(who != account, Error::<T>::CannotRevokeOwnRole);

            // Check account has a role
            ensure!(
                UserRoles::<T>::contains_key(&account),
                Error::<T>::NoRoleToRevoke
            );

            let role = UserRoles::<T>::get(&account).unwrap_or_default();
            UserRoles::<T>::remove(&account);

            Self::deposit_event(Event::RoleRevoked {
                account,
                role,
                revoked_by: who,
            });

            Ok(())
        }

        // ====================================================================
        // EMERGENCY ACCESS EXTRINSICS
        // ====================================================================

        /// Grant emergency access to a patient's records
        ///
        /// In emergencies, healthcare providers can self-grant access.
        /// Access is time-limited and logged immutably.
        ///
        /// # Arguments
        /// * `patient` - Patient whose records to access
        /// * `reason_hash` - Hash of encrypted reason for access
        ///
        /// # Errors
        /// * `NotHealthcareProvider` - Caller is not a healthcare provider
        /// * `AccessAlreadyGranted` - Accessor already has active access
        /// * `TooManyAccesses` - Patient has maximum active accesses
        #[pallet::call_index(2)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn grant_emergency_access(
            origin: OriginFor<T>,
            patient: T::AccountId,
            reason_hash: [u8; 32],
        ) -> DispatchResult {
            let accessor = ensure_signed(origin)?;

            // Must be a healthcare provider to use emergency access
            ensure!(
                Self::is_healthcare_provider(&accessor),
                Error::<T>::NotHealthcareProvider
            );

            // Check if access already exists
            ensure!(
                !ActiveAccess::<T>::contains_key(&patient, &accessor),
                Error::<T>::AccessAlreadyGranted
            );

            // Check access count limit (Rule 2: bounded)
            let current_count = AccessCount::<T>::get(&patient);
            ensure!(
                current_count < MAX_ACTIVE_ACCESSES,
                Error::<T>::TooManyAccesses
            );

            let current_block = <frame_system::Pallet<T>>::block_number();
            let expires_at = current_block.saturating_add(DEFAULT_ACCESS_DURATION.into());

            let access_log = AccessLog {
                accessor: accessor.clone(),
                access_type: AccessType::Emergency,
                granted_at: current_block,
                expires_at,
                reason_hash,
                revoked: false,
            };

            ActiveAccess::<T>::insert(&patient, &accessor, access_log);
            AccessCount::<T>::mutate(&patient, |count| *count = count.saturating_add(1));

            Self::deposit_event(Event::EmergencyAccessGranted {
                patient,
                accessor,
                expires_at,
            });

            Ok(())
        }

        /// Revoke access (patient or accessor can revoke)
        ///
        /// # Arguments
        /// * `patient` - Patient account
        /// * `accessor` - Accessor to revoke
        ///
        /// # Errors
        /// * `AccessNotFound` - No active access found
        /// * `AlreadyRevoked` - Access already revoked
        #[pallet::call_index(3)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn revoke_access(
            origin: OriginFor<T>,
            patient: T::AccountId,
            accessor: T::AccountId,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Only patient or accessor can revoke
            ensure!(who == patient || who == accessor, Error::<T>::NotAuthorized);

            ActiveAccess::<T>::try_mutate(&patient, &accessor, |maybe_access| -> DispatchResult {
                let access = maybe_access.as_mut().ok_or(Error::<T>::AccessNotFound)?;

                ensure!(!access.revoked, Error::<T>::AlreadyRevoked);

                access.revoked = true;

                Self::deposit_event(Event::AccessRevoked {
                    patient: patient.clone(),
                    accessor: accessor.clone(),
                });

                Ok(())
            })?;

            // Decrement count
            AccessCount::<T>::mutate(&patient, |count| *count = count.saturating_sub(1));

            Ok(())
        }

        /// Clean up expired access entries
        ///
        /// Can be called by anyone to remove expired access records.
        /// Helps keep storage clean and reduces costs.
        ///
        /// # Arguments
        /// * `patient` - Patient account
        /// * `accessor` - Accessor whose expired access to clean
        ///
        /// # Errors
        /// * `AccessNotFound` - No access record found
        /// * `AccessExpired` - Access hasn't expired yet (cannot clean)
        #[pallet::call_index(4)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn cleanup_expired_access(
            origin: OriginFor<T>,
            patient: T::AccountId,
            accessor: T::AccountId,
        ) -> DispatchResult {
            ensure_signed(origin)?;

            let access =
                ActiveAccess::<T>::get(&patient, &accessor).ok_or(Error::<T>::AccessNotFound)?;

            let current_block = <frame_system::Pallet<T>>::block_number();

            // Only clean if expired or revoked
            ensure!(
                access.revoked || current_block > access.expires_at,
                Error::<T>::AccessNotFound
            );

            ActiveAccess::<T>::remove(&patient, &accessor);
            AccessCount::<T>::mutate(&patient, |count| *count = count.saturating_sub(1));

            Self::deposit_event(Event::ExpiredAccessCleaned { patient, accessor });

            Ok(())
        }
    }

    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================

    impl<T: Config> Pallet<T> {
        /// Check if account is an Admin
        pub fn is_admin(account: &T::AccountId) -> bool {
            matches!(UserRoles::<T>::get(account), Some(Role::Admin))
        }

        /// Check if account is a Doctor
        pub fn is_doctor(account: &T::AccountId) -> bool {
            matches!(UserRoles::<T>::get(account), Some(Role::Doctor))
        }

        /// Check if account is a Nurse
        pub fn is_nurse(account: &T::AccountId) -> bool {
            matches!(UserRoles::<T>::get(account), Some(Role::Nurse))
        }

        /// Check if account is a healthcare provider (Doctor, Nurse, Admin)
        /// These are the only roles that can register patients and edit medical records
        pub fn is_healthcare_provider(account: &T::AccountId) -> bool {
            matches!(
                UserRoles::<T>::get(account),
                Some(Role::Admin) | Some(Role::Doctor) | Some(Role::Nurse)
            )
        }

        /// Check if account can register patients (Doctor, Nurse, Admin)
        pub fn can_register_patients(account: &T::AccountId) -> bool {
            Self::is_healthcare_provider(account)
        }

        /// Check if account can edit medical records (Doctor, Nurse, Admin)
        pub fn can_edit_medical_records(account: &T::AccountId) -> bool {
            Self::is_healthcare_provider(account)
        }

        /// Check if account is a Patient
        pub fn is_patient(account: &T::AccountId) -> bool {
            matches!(UserRoles::<T>::get(account), Some(Role::Patient))
        }

        /// Get the role of an account
        pub fn get_role(account: &T::AccountId) -> Option<Role> {
            UserRoles::<T>::get(account)
        }

        /// Check if accessor has valid (non-expired, non-revoked) access
        pub fn has_valid_access(patient: &T::AccountId, accessor: &T::AccountId) -> bool {
            if let Some(access) = ActiveAccess::<T>::get(patient, accessor) {
                let current_block = <frame_system::Pallet<T>>::block_number();
                !access.revoked && current_block <= access.expires_at
            } else {
                false
            }
        }
    }
}
