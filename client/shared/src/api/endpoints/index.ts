/**
 * MediChain API endpoints.
 *
 * Typed functions for every endpoint a screen calls, one module per domain.
 * Import from here (or from `@medichain/shared`), not from a module directly:
 * tests mock this path.
 */

export * from './analytics';
export * from './appointments';
export * from './assessments';
export * from './auth';
export * from './billing';
export * from './blood-bank';
export * from './cds';
export { fromStoredRecord, rowsOfResponse } from './common';
export type { ListResponse } from './common';
export * from './death-records';
export * from './diagnostics';
export * from './documentation';
export * from './emergency';
export * from './governance';
export * from './lab';
export * from './messaging';
export * from './nursing';
export * from './patients';
export * from './pharmacy';
export * from './records';
export * from './symptoms';
export * from './system';
export * from './telehealth';
export * from './triage-vitals';
export * from './wearables';
