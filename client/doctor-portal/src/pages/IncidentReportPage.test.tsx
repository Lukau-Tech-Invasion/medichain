import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IncidentReportPage from './IncidentReportPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIncidentReport: vi.fn(), listIncidentReports: vi.fn(),
}));

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
    userId: '5GrwvaEF...mock',
    username: 'dr_incident',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.listIncidentReports).mockResolvedValue([]);
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
  });

  it('counts stored incidents within thirty days without inventing missing dates or chart values', async () => {
    const now = Date.now();
    const row = { id: 'INC-current', incident_type: 'equipment_failure', severity: 'near_miss',
      incident_datetime: new Date(now - 60_000).toISOString(), discovery_datetime: new Date(now).toISOString(),
      description: 'QA current record', investigation_status: 'open' };
    vi.mocked(shared.listIncidentReports).mockResolvedValue([
      row,
      { ...row, id: 'INC-old', incident_type: 'fall', incident_datetime: new Date(now - 40 * 86_400_000).toISOString() },
      { ...row, id: 'INC-future', incident_type: 'fall', incident_datetime: new Date(now + 86_400_000).toISOString() },
      { ...row, id: 'INC-missing', incident_type: 'fall', incident_datetime: '', discovery_datetime: '' },
    ] as unknown as Awaited<ReturnType<typeof shared.listIncidentReports>>);
    render(<IncidentReportPage />);
    await screen.findByText('INC-current');
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    const types = within(screen.getByRole('region', { name: 'Incident type counts' }));
    expect(types.getAllByText('0', { exact: true })).toHaveLength(6);
    expect(types.getAllByText('1', { exact: true })).toHaveLength(1);
    const severities = within(screen.getByRole('region', { name: 'Incident severity counts' }));
    expect(severities.getAllByText('0', { exact: true })).toHaveLength(4);
    expect(severities.getAllByText('1', { exact: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'All Incidents' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(within(screen.getByRole('region', { name: 'Incident type counts' })).getAllByText('1', { exact: true })).toHaveLength(1);
  });

  it('shows hidden required-field errors and submits a valid type without the validator blocking it', async () => {
    vi.mocked(shared.createIncidentReport).mockResolvedValue({ incident_id: 'INC-QA', success: true });
    render(<IncidentReportPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Report Incident' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Description of Incident/ }), { target: { value: 'QA fictional equipment drill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));
    expect(shared.createIncidentReport).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Date & Time/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Date & Time/), { target: { value: '2026-10-10T09:00' } });
    fireEvent.change(screen.getByLabelText(/Exact Location/), { target: { value: 'QA training room' } });
    fireEvent.change(screen.getByLabelText(/Incident Type/), { target: { value: 'equipment-failure' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));
    await waitFor(() => expect(shared.createIncidentReport).toHaveBeenCalledWith(expect.objectContaining({
      type: 'equipment-failure', location: 'QA training room', description: 'QA fictional equipment drill',
    })));
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
