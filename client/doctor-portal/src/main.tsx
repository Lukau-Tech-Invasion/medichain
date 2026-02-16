import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './store/authStore';
import { ToastProvider } from './components/Toast';
import './index.css';

// Clear old auth data on app load (one-time migration)
const AUTH_MIGRATION_KEY = 'medichain_auth_migrated_v3';
if (!localStorage.getItem(AUTH_MIGRATION_KEY)) {
  console.log('[MediChain] Clearing old auth data for fresh start...');
  // Clear all old auth/wallet related keys
  ['medichain-provider-auth', 'medichain_provider_auth', 'medichain_wallet', 
   'medichain_patient_auth', 'medichain_accounts', 'medichain_auth_migrated_v2'].forEach(key => {
    localStorage.removeItem(key);
  });
  localStorage.setItem(AUTH_MIGRATION_KEY, 'true');
  console.log('[MediChain] Auth data cleared. Please login with demo users.');
}

// Initialize app - restore session if needed
async function initApp() {
  try {
    // Try to restore session from localStorage and re-register with API if needed
    await useAuthStore.getState().restoreSession();
    console.log('[MediChain] Doctor Portal initialized');
  } catch (error) {
    console.warn('[MediChain] Session restore failed:', error);
  }
}

initApp();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
