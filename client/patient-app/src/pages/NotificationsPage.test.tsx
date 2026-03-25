import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NotificationsPage } from './NotificationsPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NotificationsPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/notifications')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            notifications: [
              {
                id: 'notif1',
                message: 'Your lab results are ready',
                timestamp: new Date().toISOString(),
                read: false,
              }
            ],
          }),
        });
      }
      if (url.includes('/api/cds/patient/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            alerts: [
              {
                id: 'alert1',
                title: 'High Blood Pressure',
                description: 'Your last reading was high',
                severity: 'medium',
                created_at: new Date().toISOString(),
              }
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders notifications page with notifications', async () => {
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Notifications & Alerts/i)).toBeInTheDocument();
      expect(screen.getByText(/Your lab results are ready/i)).toBeInTheDocument();
    });
  });

  it('allows switching to alerts tab', async () => {
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Inbox/i)).toBeInTheDocument();
    });

    const alertsTab = screen.getByText(/Clinical Alerts/i);
    fireEvent.click(alertsTab);
    
    await waitFor(() => {
      expect(screen.getByText(/High Blood Pressure/i)).toBeInTheDocument();
      expect(screen.getByText(/Your last reading was high/i)).toBeInTheDocument();
    });
  });
});
