import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AMAPage from './AMAPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Walk the AMA wizard as far as the risk-disclosure step.
 *
 * The AMA form is a four-step wizard behind a tab, not a single page: patient
 * info, medical details, risk disclosure + capacity, then signatures. Each step
 * gates the next on its own required fields, so a test that renders the page
 * and asserts on step-3 content sees only the records list.
 */
const goToRiskDisclosureStep = async () => {
  // Tabs render only once the records load resolves — before that the page is
  // a spinner, so every query below would miss.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /New AMA Form/i })).toBeInTheDocument()
  );
  fireEvent.click(screen.getByRole('button', { name: /New AMA Form/i }));

  fireEvent.change(screen.getByLabelText(/Patient ID/i), { target: { value: 'PAT-001' } });
  fireEvent.change(screen.getByLabelText(/Patient Name/i), { target: { value: 'Test Patient' } });
  fireEvent.change(screen.getByLabelText(/MRN/i), { target: { value: 'MRN-001' } });
  fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

  fireEvent.change(screen.getByLabelText(/Diagnosis/i), { target: { value: 'Chest pain' } });
  fireEvent.change(screen.getByLabelText(/Recommended Treatment/i), {
    target: { value: 'Admit for observation and serial troponins' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
};

describe('AMAPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders AMA page', () => {
    render(<AMAPage />);

    expect(screen.getByText(/Against Medical Advice \(AMA\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Document patient refusal of care and AMA discharges/i)).toBeInTheDocument();
  });

  it('displays assessment sections', async () => {
    render(<AMAPage />);
    await goToRiskDisclosureStep();

    await waitFor(() =>
      expect(screen.getByText(/Decision-Making Capacity/i)).toBeInTheDocument()
    );
    // 'Risk Disclosure' is both the step-strip label and the section heading.
    expect(screen.getAllByText(/Risk Disclosure/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Each risk must be verbally explained/i)).toBeInTheDocument();
  });

  it('allows recording the capacity assessment', async () => {
    render(<AMAPage />);
    await goToRiskDisclosureStep();

    await waitFor(() =>
      expect(screen.getByLabelText(/Patient has capacity to refuse/i)).toBeInTheDocument()
    );
    const capacity = screen.getByLabelText(/Patient has capacity to refuse/i);
    expect(capacity).not.toBeChecked();

    fireEvent.click(capacity);
    expect(capacity).toBeChecked();
  });

  it('blocks signature collection until capacity is affirmed', async () => {
    render(<AMAPage />);
    await goToRiskDisclosureStep();

    // Acknowledging every risk is not sufficient on its own: an unassessed
    // patient cannot give an informed refusal, so the signature step stays
    // closed until capacity is affirmed too.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Continue to Signatures/i })).toBeDisabled()
    );

    fireEvent.click(screen.getByLabelText(/Patient has capacity to refuse/i));
    expect(screen.getByRole('button', { name: /Continue to Signatures/i })).toBeDisabled();
  });
});
