import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { usePatientAuthStore } from './store/authStore';
import './index.css';
import { reloadOnStaleChunks } from '@medichain/shared';

// A tab opened before a deploy asks for chunks that no longer exist.
reloadOnStaleChunks();

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<div role="status" className="min-h-screen flex items-center justify-center">Restoring your session…</div>);

/** Restore the cookie-backed session before protected pages request patient data. */
async function startApp() {
  try {
    // The doctor portal has its own independent session on its own origin.
    await usePatientAuthStore.getState().restoreSession();
  } catch (error) {
    console.warn('[MediChain] Patient session restore failed:', error);
    usePatientAuthStore.getState().logout();
  }
  root.render(
    <React.StrictMode>
      {/* basename derived from Vite's `base` so the router and asset paths
          cannot drift apart. See the doctor-portal main.tsx for the rationale. */}
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

void startApp();
