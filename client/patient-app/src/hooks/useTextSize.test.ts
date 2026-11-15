import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getUserSettings } from '@medichain/shared';
import { applyTextSize, useTextSize } from './useTextSize';
vi.mock('@medichain/shared', () => ({ getUserSettings: vi.fn(), debugLog: vi.fn() }));
vi.mock('../store/authStore', () => ({ usePatientAuthStore: (select: (state: unknown) => unknown) => select({isAuthenticated:true,patient:{healthId:'PAT-TEXT-TEST'}}) }));
afterEach(() => { cleanup(); applyTextSize('medium'); });
beforeEach(() => { vi.clearAllMocks(); });
describe('patient text size', () => {
  it('restores the saved size when the application mounts', async () => {
    vi.mocked(getUserSettings).mockResolvedValue({appSettings:{fontSize:'large'}});
    renderHook(() => useTextSize());
    await waitFor(() => expect(document.documentElement.style.fontSize).toBe('112.5%'));
  });
  it('uses a readable default for unsupported values', () => {
    applyTextSize('gigantic');
    expect(document.documentElement.style.fontSize).toBe('100%');
  });
  it('keeps the default when preferences cannot be loaded', async () => {
    vi.mocked(getUserSettings).mockRejectedValue(new Error('offline'));
    renderHook(() => useTextSize());
    await waitFor(() => expect(getUserSettings).toHaveBeenCalled());
    expect(document.documentElement.style.fontSize).toBe('100%');
  });
});
