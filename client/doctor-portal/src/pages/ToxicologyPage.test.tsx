import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ToxicologyPage from './ToxicologyPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Keep the module's hooks; replace only the picker component.
vi.mock('../components/PatientSelect', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()),
  default: ({ onChange }: { onChange: (id: string) => void }) =>
    <button onClick={() => onChange('PAT-synthetic')}>Select synthetic patient</button>,
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

// Mock only the data call; the rest of the package (i18n, apiUrl) stays real so
// the component renders its actual copy.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  getToxForPatient: vi.fn().mockResolvedValue({ assessments: [] }),
  apiUrl: (path: string) => path,
  // The catalogue the server publishes: drug levels in SI units.
  useScoringCatalog: () => ({
    catalog: {
      toxicology: {
        levels: [
          { key: 'ethanol', name: 'Ethanol', unit: 'mmol/L', flag_above: 17.4 },
          { key: 'acetaminophen', name: 'Paracetamol', unit: 'µmol/L', flag_above: 993 },
        ],
      },
    },
    isLoading: false,
    error: null,
  }),
}));

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones expected sections named "Ingestion Details", "Toxidrome Recognition" and
 * "Antidote Checklist", and a labelled "Suspected Toxidrome" select — none of
 * which exist. The page is tabbed (New Case / History) with an "Exposure
 * Information" form, plus Antidotes and Decontamination sections. Strings
 * verified against `docToxicology` in shared/src/i18n/locales/en-US.ts.
 */
describe('ToxicologyPage', () => {
  it('opens persisted history for the selected patient after remount', async () => {
    vi.mocked(shared.getToxForPatient).mockResolvedValue({ assessments: [{
      id: 'TOX-saved', patientId: 'PAT-synthetic', patientName: 'Thandiwe Ndlovu',
      assessedAt: '2026-10-07T18:00:00Z', substance: 'acetaminophen', amount: '500 mg',
      route: 'oral', severity: 'mild', antidotesGiven: [], notes: 'Persisted safety review',
    }] });
    const mounted = render(<ToxicologyPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select synthetic patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByText('Persisted safety review');
    mounted.unmount();
    render(<ToxicologyPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Select synthetic patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByText('Persisted safety review');
    await waitFor(() => expect(shared.getToxForPatient).toHaveBeenCalledWith('PAT-synthetic'));
  });
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
  });

  it('renders the toxicology header', () => {
    render(<ToxicologyPage />);

    expect(screen.getByText(/Toxicology \/ Overdose/i)).toBeInTheDocument();
    expect(screen.getByText(/Poisoning assessment and antidote management/i)).toBeInTheDocument();
  });

  it('surfaces the poison control hotline', () => {
    render(<ToxicologyPage />);

    // Safety-critical: this number must stay visible on the overdose page.
    expect(screen.getByText(/Poison Control: 1-800-222-1222/i)).toBeInTheDocument();
  });

  it('offers the case tabs and exposure form', () => {
    render(<ToxicologyPage />);

    expect(screen.getByText(/New Case/i)).toBeInTheDocument();
    expect(screen.getAllByText(/History/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Exposure Information/i)).toBeInTheDocument();
  });

  it('labels drug levels in the SI units the server publishes, and flags above the level', async () => {
    render(<ToxicologyPage />);
    const ethanol = await screen.findByText('Ethanol (mmol/L)');
    expect(screen.getByText('Paracetamol (µmol/L)')).toBeInTheDocument();
    expect(screen.queryByText(/mg\/dL/)).not.toBeInTheDocument();
    const input = ethanol.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    expect(input.className).toContain('bg-critical-subtle');
  });
});
