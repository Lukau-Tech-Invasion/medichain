import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IncidentReportPage from './IncidentReportPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

describe('IncidentReportPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    username: 'dr_incident',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
  });

  it('renders incident report page', () => {
    render(<IncidentReportPage />);

    expect(screen.getByText(/Clinical Incident Reporting/i)).toBeInTheDocument();
    expect(screen.getByText(/Document and track patient safety incidents/i)).toBeInTheDocument();
  });

  it('displays incident details section', () => {
    render(<IncidentReportPage />);

    expect(screen.getByText(/Incident Details/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Incident Type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Severity/i)).toBeInTheDocument();
  });

  it('allows entering incident description', () => {
    render(<IncidentReportPage />);

    const input = screen.getByLabelText(/Description/i);
    fireEvent.change(input, { target: { value: 'Patient fall in hallway.' } });
    expect(input).toHaveValue('Patient fall in hallway.');
  });
});
