import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import OfflineSyncPage from './OfflineSyncPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAllCachedItems: vi.fn(),
  getAllSyncItems: vi.fn(),
  getStorageInfo: vi.fn(),
  clearStore: vi.fn(),
  clearCompletedSyncItems: vi.fn(),
  clearExpiredCache: vi.fn(),
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
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
    });
    vi.mocked(shared.getAllCachedItems).mockResolvedValue([]);
    vi.mocked(shared.getAllSyncItems).mockResolvedValue([]);
    vi.mocked(shared.getStorageInfo).mockResolvedValue({
      used: 1024,
      available: 5000000,
      quota: 5001024,
      syncQueueSize: 0,
      cachedItemsSize: 0,
      documentsSize: 0,
    });
  });

  it('renders offline sync page', async () => {
    render(<OfflineSyncPage />);

    await waitFor(() => {
      expect(screen.getByText(/Offline Sync/i)).toBeInTheDocument();
      expect(screen.getByText(/Status/i)).toBeInTheDocument();
    });
  });

  it('allows switching to cache management tab', async () => {
    render(<OfflineSyncPage />);

    await waitFor(() => {
      expect(screen.getByText(/Offline Sync/i)).toBeInTheDocument();
    });

    const cacheTab = screen.getAllByText(/Cache/i)[0];
    fireEvent.click(cacheTab);
    
    await waitFor(() => {
      expect(screen.getAllByText(/Cache/i).length).toBeGreaterThan(0);
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
      expect(screen.getByText(/Online/i)).toBeInTheDocument();
    });
  });

  it('does not substitute demo clinical data when IndexedDB cannot be read', async () => {
    vi.mocked(shared.getAllCachedItems).mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    render(<OfflineSyncPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Offline data could not be loaded/i);
    });

    fireEvent.click(screen.getByRole('button', { name: /^Cache$/i }));
    expect(screen.getByText(/No data is cached on this device/i)).toBeInTheDocument();
    expect(screen.queryByText(/Medical History Summary/i)).not.toBeInTheDocument();
  });
});
