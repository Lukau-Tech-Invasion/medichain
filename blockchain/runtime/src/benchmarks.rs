//! Benchmark registry for `--features runtime-benchmarks`.
//!
//! The MediChain pallets ship hand-written weights in their `weights.rs`. Listing
//! them here lets `frame-benchmarking-cli` regenerate those from measurements on
//! real hardware; until that is run, the checked-in weights remain estimates.

frame_benchmarking::define_benchmarks!(
    [frame_benchmarking, BaselineBench::<Runtime>]
    [frame_system, SystemBench::<Runtime>]
    [frame_system_extensions, SystemExtensionsBench::<Runtime>]
    [pallet_balances, Balances]
    [pallet_timestamp, Timestamp]
    [pallet_sudo, Sudo]
    [pallet_access_control, AccessControl]
    [pallet_patient_identity, PatientIdentity]
    [pallet_medical_records, MedicalRecords]
);
