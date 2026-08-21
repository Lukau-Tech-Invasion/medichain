import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { usePatientAuthStore } from './store/authStore';
import './index.css';

// Rebind the API singleton to the patient-specific stored wallet on every
// reload. The doctor portal can be open on the same origin and has its own
// independent session.
usePatientAuthStore.getState().restoreSession();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* basename derived from Vite's `base` so the router and asset paths
        cannot drift apart. See the doctor-portal main.tsx for the rationale. */}
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
