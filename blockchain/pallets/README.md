# Pallets (medichain/pallets)

Purpose: Substrate pallets providing blockchain logic for MediChain (access control, medical records, patient identity).

Members:
- `access-control` — RBAC, roles and permissions
- `medical-records` — on-chain metadata for medical records
- `patient-identity` — health ID, national ID integration

Testing:
- Each pallet includes `mock.rs` and `tests.rs`. Use `cargo test -p pallet-<name>` to run unit tests.

Rules:
- Follow project NASA Power-of-10 rules: no recursion, bounded loops, `ensure!` checks, functions ≤60 lines.
