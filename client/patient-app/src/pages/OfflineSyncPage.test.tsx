import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OfflineSyncPage from './OfflineSyncPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getAllCachedItems: vi.fn(),
  getAllSyncItems: vi.fn(),
  getStorageInfo: vi.fn(),
  clearStore: vi.fn(),
  clearCompletedSyncItems: vi.fn(),
  clearExpiredCache: vi.fn(),
  performSync: vi.fn(),
  downloadOfflineData: vi.fn(),
  STORES: { CACHE: 'cache', SYNC: 'sync' },
}));

describe('OfflineSyncPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
    });
    (shared.getAllCachedItems as any).mockResolvedValue([]);
    (shared.getAllSyncItems as any).mockResolvedValue([]);
    (shared.getStorageInfo as any).mockResolvedValue({ used: 1024, available: 5000000, quota: 5001024 });
  });

  it('renders offline sync page', async () => {
    render(<OfflineSyncPage />);

    await waitFor(() => {
      expect(screen.getByText(/Offline Synchronization/i)).toBeInTheDocument();
      expect(screen.getByText(/System Status/i)).toBeInTheDocument();
    });
  });

  it('allows switching to cache management tab', async () => {
    render(<OfflineSyncPage />);

    await waitFor(() => {
      expect(screen.getByText(/Sync Status/i)).toBeInTheDocument();
    });

    const cacheTab = screen.getByText(/Cache Management/i);
    fireEvent.click(cacheTab);
    
    await waitFor(() => {
      expect(screen.getByText(/Offline Cache/i)).toBeInTheDocument();
    });
  });

  it('shows online status correctly', async () => {
    // Mock navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', {
      value: true,
      configurable: true
    });

    render(<OfflineSyncPage />);

    await waitFor(() => {
      expect(screen.getByText(/Device is Online/i)).toBeInTheDocument();
    });
  });
});
