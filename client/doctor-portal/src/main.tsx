import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './store/authStore';
import { ToastProvider } from './components/Toast';
import './index.css';
import { reloadOnStaleChunks } from '@medichain/shared';

// A tab opened before a deploy asks for chunks that no longer exist.
reloadOnStaleChunks();

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<div role="status" className="min-h-screen flex items-center justify-center">Restoring your session…</div>);

/** Restore the cookie-backed session before protected pages request data. */
async function initApp() {
  try {
    await useAuthStore.getState().restoreSession();
    console.log('[MediChain] Doctor Portal initialized');
  } catch (error) {
    console.warn('[MediChain] Session restore failed:', error);
    useAuthStore.getState().logout();
  }
  root.render(
    <React.StrictMode>
      <BrowserRouter
        basename={import.meta.env.BASE_URL.replace(/\/$/, '')}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

void initApp();
