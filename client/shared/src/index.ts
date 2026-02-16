/**
 * @medichain/shared - Shared components and utilities
 * 
 * Blockchain-based health ID system shared library.
 * All authentication is wallet-based using Substrate addresses.
 * 
 * © 2025 Trustware. All rights reserved.
 */

// Configuration
export * from './config';

// Wallet Types and Service (Blockchain Identity)
export * from './wallet/types';
export * from './wallet/service';

// Types (canonical Role definition is here)
export * from './types';

// API Client
export * from './api/client';
export * from './api/endpoints';

// Hooks
export * from './hooks/useAuth';
export * from './hooks/useApi';
export * from './hooks/useSidebarData';

// Utilities
export * from './utils/cache';
export { fetchWithRetry } from './utils/fetchWithRetry';
export * from './utils/indexedDB';
export * from './utils/offlineQueue';
export { SubstrateConnection, testSubstrateConnection } from './utils/SubstrateConnection';
export * from './utils/validation';
export { SubstrateWebSocket, testSubstrateWs } from './utils/websocket';

// Components
export * from './components';
export * from './components/Button';
export * from './components/Card';
export * from './components/Input';
export * from './components/Alert';
export * from './components/Badge';
export * from './components/Modal';
export * from './components/Loading';
export * from './components/PatientCard';
export * from './components/QRCodeDisplay';
export * from './components/EmergencyBanner';

