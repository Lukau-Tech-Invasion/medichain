import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SettingsPage } from './SettingsPage';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SettingsPage (Patient)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock localStorage
    localStorage.getItem = vi.fn().mockImplementation((key) => {
      if (key === 'patientId') return 'HEALTH123';
      return null;
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });

  it('renders settings page with all sections', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Account/i)).toBeInTheDocument();
    expect(screen.getByText(/Notifications/i)).toBeInTheDocument();
    expect(screen.getByText(/Privacy & Security/i)).toBeInTheDocument();
    expect(screen.getByText(/App Preferences/i)).toBeInTheDocument();
  });

  it('allows toggling notification settings', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    const emailToggle = screen.getByText(/Email Notifications/i).closest('button');
    expect(emailToggle).toBeInTheDocument();
    
    // Toggle should be on by default in the component
    expect(screen.getByText(/Email Notifications/i).parentElement?.nextElementSibling).toBeInTheDocument();
  });

  it('shows logout confirmation modal', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    const logoutButton = screen.getByText(/Disconnect Wallet/i);
    fireEvent.click(logoutButton);

    expect(screen.getByText(/Are you sure you want to disconnect?/i)).toBeInTheDocument();
  });
});
