import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IncidentReportPage from './IncidentReportPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

  it('renders incident report page', async () => {
    render(<IncidentReportPage />);

    expect(screen.getByText(/Incident Reporting/i)).toBeInTheDocument();
    expect(screen.getByText(/Document and track safety incidents/i)).toBeInTheDocument();
  });

  it('displays incident details section', async () => {
    render(<IncidentReportPage />);

    // 'Incident Details' is step 1 of the report form, which lives in the
    // 'Report Incident' tab; the page opens on the incident list.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Report Incident/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Report Incident/i }));

    expect(screen.getByText(/Incident Details/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Incident Type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Severity/i)).toBeInTheDocument();
  });

  it('allows entering incident description', async () => {
    render(<IncidentReportPage />);

    // 'Incident Details' is step 1 of the report form, which lives in the
    // 'Report Incident' tab; the page opens on the incident list.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Report Incident/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Report Incident/i }));

    // Description is on step 2 of the report form; advance past step 1.
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    const input = screen.getByLabelText(/Description/i);
    fireEvent.change(input, { target: { value: 'Patient fall in hallway.' } });
    expect(input).toHaveValue('Patient fall in hallway.');
  });
});
