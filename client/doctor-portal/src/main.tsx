import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Initialize WASM module if available
async function initWasm() {
  try {
    // WASM crypto module will be loaded dynamically when needed
    console.log('[MediChain] Doctor Portal initialized');
  } catch (error) {
    console.warn('[MediChain] WASM module not available, using fallback crypto');
  }
}

initWasm();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
