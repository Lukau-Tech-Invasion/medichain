import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import * as shared from '@medichain/shared';
import InsurancePage from './InsurancePage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatientInsuranceClaims: vi.fn(),
  getInsuranceCards: vi.fn(),
  downloadInsuranceCardImage: vi.fn(),
  createInsuranceCard: vi.fn(),
  verifyInsurance: vi.fn(),
  apiUrl: (path: string) => path,
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('InsurancePage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });
    vi.mocked(shared.getInsuranceCards).mockResolvedValue({ success: true, cards: [], count: 0 });
    vi.mocked(shared.getPatientInsuranceClaims).mockResolvedValue({
      success: true, patient_id: mockPatient.healthId, claims: [], count: 0,
    });
    vi.mocked(shared.downloadInsuranceCardImage).mockRejectedValue(new Error('No image'));
    vi.mocked(shared.createInsuranceCard).mockResolvedValue({
      success: true, card: { id: 'ICARD-1', patient_id: mockPatient.healthId },
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/insurance/patient/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve([
            {
              id: 'ins1',
              type: 'medical',
              providerName: 'Blue Cross',
              planName: 'PPO Silver',
              memberId: 'BC123456',
              groupNumber: 'GRP999',
              subscriberName: 'Test Patient',
              status: 'active',
              isPrimary: true,
              lastVerified: '2025-01-01',
              copay: { primaryCare: 25, specialist: 50, urgentCare: 75, emergency: 150 },
              deductible: { individual: 1500, family: 3000, met: 500 },
              outOfPocketMax: { individual: 5000, family: 10000, met: 1000 },
              customerServicePhone: '555-0199',
              providerPortalUrl: 'https://bluecross.com'
            }
          ]),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve([]),
      });
    });
  });

  it('renders insurance page with cards', async () => {
    render(
      <MemoryRouter>
        <InsurancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Insurance Information/i)).toBeInTheDocument();
      expect(screen.getByText(/My Cards/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Claims/i).length).toBeGreaterThan(0);
    });
  });

  it('allows switching to claims tab', async () => {
    render(
      <MemoryRouter>
        <InsurancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Insurance Information/i)).toBeInTheDocument();
    });

    const claimsTab = screen.getAllByText(/Claims/i)[0];
    fireEvent.click(claimsTab);
    
    expect(screen.getAllByText(/Claims/i).length).toBeGreaterThan(0);
  });

  it('allows switching to add insurance tab', async () => {
    render(
      <MemoryRouter>
        <InsurancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Insurance Information/i)).toBeInTheDocument();
    });

    const addTab = screen.getByText(/Add New/i);
    fireEvent.click(addTab);
    
    expect(screen.getByText(/Add New Insurance/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Insurance Provider/i)).toBeInTheDocument();
  });

  it('persists a new card before returning to the card list', async () => {
    render(<MemoryRouter><InsurancePage /></MemoryRouter>);
    fireEvent.click(await screen.findByText(/Add New/i));
    fireEvent.change(screen.getByLabelText(/Insurance Provider/i), { target: { value: 'Acme Health' } });
    fireEvent.change(screen.getByLabelText(/Member ID/i), { target: { value: 'MEM-123' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Insurance Card/i }));

    await waitFor(() => expect(shared.createInsuranceCard).toHaveBeenCalledWith(
      expect.objectContaining({ patient_id: mockPatient.healthId, providerName: 'Acme Health', memberId: 'MEM-123' })
    ));
  });

  it('does not mark a card verified when coverage verification fails', async () => {
    vi.mocked(shared.getInsuranceCards).mockResolvedValue({
      success: true,
      count: 1,
      cards: [{
        id: 'ICARD-1',
        patient_id: mockPatient.healthId,
        type: 'medical',
        providerName: 'Acme Health',
        planName: 'Standard',
        memberId: 'MEM-123',
        groupNumber: '',
        subscriberName: 'Test Patient',
        subscriberId: 'SUB-1',
        effectiveDate: '2026-01-01',
        terminationDate: null,
        status: 'pending',
        currency: 'ZAR',
        copay: { primaryCare: 0, specialist: 0, urgentCare: 0, emergency: 0 },
        deductible: { individual: 0, family: 0, met: 0 },
        outOfPocketMax: { individual: 0, family: 0, met: 0 },
        frontImageUrl: null,
        backImageUrl: null,
        customerServicePhone: '',
        providerPortalUrl: '',
        isPrimary: true,
        lastVerified: '',
      }],
    });
    vi.mocked(shared.verifyInsurance).mockRejectedValue(new Error('Provider unavailable'));

    render(<MemoryRouter><InsurancePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Verify Coverage/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      /card has not been marked as verified/i,
    ));
  });

  /** A stored claim as the API returns it, with `eob_documents`. */
  function claimWith(documents: unknown[]) {
    return {
      claim_id: 'CLM-1', patient_id: mockPatient.healthId, service_date: '2026-09-01',
      status: 'Paid', total_charge: 850, paid_amount: 700, patient_responsibility: 150,
      insurance: { payer_name: 'Synthetic Medical Aid' }, service_lines: [],
      eob_received: documents.length > 0, eob_documents: documents,
    };
  }

  async function openClaims() {
    render(<MemoryRouter><InsurancePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Insurance Information/i)).toBeInTheDocument());
    // Claims load with the cards; wait for them before opening the tab.
    await waitFor(() => expect(shared.getPatientInsuranceClaims).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^\s*Claims\s*$/ }));
  }

  it('says plainly when no EOB has been received for a claim', async () => {
    vi.mocked(shared.getPatientInsuranceClaims).mockResolvedValue({
      success: true, patient_id: mockPatient.healthId, claims: [claimWith([])], count: 1,
    });
    await openClaims();
    expect(await screen.findByText('No EOB received yet')).toBeInTheDocument();
  });

  it('lists a filed EOB as a download, never a made-up link', async () => {
    vi.mocked(shared.getPatientInsuranceClaims).mockResolvedValue({
      success: true, patient_id: mockPatient.healthId, count: 1,
      claims: [claimWith([{
        id: 'EOB-1', claim_id: 'CLM-1', filename: 'EOB Sept.pdf', content_type: 'application/pdf',
        size_bytes: 4096, scan_status: 'clean', created_at: '2026-09-20T09:00:00Z',
      }])],
    });
    await openClaims();
    expect(await screen.findByRole('button', { name: /EOB Sept.pdf/i })).toBeInTheDocument();
    expect(screen.queryByText('No EOB received yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /EOB/i })).not.toBeInTheDocument();
  });
});
