import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DrugInteractionsPage from './DrugInteractionsPage';
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
  apiUrl: (path: string) => path,
}));

// The page calls fetch directly for /api/drugs and /api/interactions/check.
const mockFetch = vi.fn();
global.fetch = mockFetch;

const json = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });

describe('DrugInteractionsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
      if (url.includes('/api/interactions/check')) {
        return json({
          interactions: [
            {
              drug_a: 'Warfarin',
              drug_b: 'Aspirin',
              severity: 'major',
              description: 'Major interaction between Warfarin and Aspirin',
              clinical_effects: 'Increased bleeding risk',
              management: 'Monitor INR closely',
            },
          ],
        });
      }
      if (url.includes('/api/drugs')) {
        return json({
          success: true,
          drugs: [
            {
              drugId: 'D-1', name: 'Warfarin', genericName: 'warfarin sodium',
              brandNames: ['Coumadin'], drugClass: 'Anticoagulant',
              route: 'PO', form: 'tablet', commonDoses: ['5 mg'],
            },
            {
              drugId: 'D-2', name: 'Aspirin', genericName: 'acetylsalicylic acid',
              brandNames: ['Disprin'], drugClass: 'Antiplatelet',
              route: 'PO', form: 'tablet', commonDoses: ['75 mg'],
            },
          ],
        });
      }
      return json({});
    });
  });

  it('renders drug interactions page', () => {
    render(<DrugInteractionsPage />);

    expect(screen.getByText(/Drug Interaction Checker/i)).toBeInTheDocument();
    expect(screen.getByText(/Check for drug-drug, drug-allergy, and other medication interactions/i)).toBeInTheDocument();
  });

  it('allows adding medications to check', async () => {
    render(<DrugInteractionsPage />);

    // Drugs are picked from the loaded database, not free-typed: the search
    // filters `/api/drugs` and each result is a button that adds it.
    const input = screen.getByPlaceholderText(/Search by drug name/i);
    fireEvent.change(input, { target: { value: 'Warfarin' } });

    const result = await screen.findByRole('button', { name: /Warfarin/i });
    fireEvent.click(result);

    expect(screen.getAllByText(/Warfarin/i).length).toBeGreaterThan(0);
  });

  it('performs interaction check', async () => {
    render(<DrugInteractionsPage />);

    const input = screen.getByPlaceholderText(/Search by drug name/i);
    for (const drug of ['Warfarin', 'Aspirin']) {
      fireEvent.change(input, { target: { value: drug } });
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(drug, 'i') }));
    }

    fireEvent.click(screen.getByText(/Check Interactions/i));

    await waitFor(() => {
      expect(
        screen.getAllByText(/Major interaction between Warfarin and Aspirin/i).length
      ).toBeGreaterThan(0);
    });
  });
});
