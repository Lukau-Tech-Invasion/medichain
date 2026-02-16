/**
 * MediChain Mobile Entry Point with Polyfills
 * 
 * IMPORTANT: This file must be loaded FIRST before any other imports.
 * It sets up the polyfills required for blockchain libraries in React Native.
 * 
 * @see COMPREHENSIVE_CONNECTION_ANALYSIS.md Section 7.2
 */

// ============================================================================
// POLYFILLS - Must be first!
// ============================================================================

// 1. Random values for crypto operations
import 'react-native-get-random-values';

// 2. Buffer for binary data handling
import { Buffer } from 'buffer';
global.Buffer = Buffer;

// 3. Process for environment checks (optional, some libs need it)
if (typeof global.process === 'undefined') {
  global.process = { env: {} };
}

// 4. TextEncoder/TextDecoder (if using @polkadot/api directly)
// Uncomment if needed:
// import 'fast-text-encoding';

// ============================================================================
// Application Entry
// ============================================================================

import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
