import { useEffect } from 'react';
import { debugLog, getUserSettings } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/** Apply a validated preference using rem scaling so text and controls grow together. */
export function applyTextSize(size: unknown): void {
  document.documentElement.style.fontSize = size === 'small' ? '87.5%' : size === 'large' ? '112.5%' : '100%';
}

/** Restore the signed-in patient's saved text size on every application load. */
export function useTextSize(): void {
  const patientId = usePatientAuthStore(state => state.isAuthenticated ? state.patient?.healthId : undefined);
  useEffect(() => {
    let current = true;
    applyTextSize('medium');
    if (patientId) {
      getUserSettings<{ appSettings?: { fontSize?: string } }>()
        .then(settings => { if (current) applyTextSize(settings.appSettings?.fontSize); })
        .catch(() => debugLog('TextSize', 'Saved text size is unavailable; using the default.'));
    }
    return () => { current = false; };
  }, [patientId]);
}
