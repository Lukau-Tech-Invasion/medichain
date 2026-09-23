import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FamilyGroup } from '@medichain/shared';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FamilyGroupPage } from './FamilyGroupPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { answerConfirm } from '../../../shared/src/testing/dialogs';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMyFamilyGroups: vi.fn(),
  createFamilyGroup: vi.fn(),
  addFamilyMember: vi.fn(),
  getMyWards: vi.fn(),
  listMyMedicalIdentities: vi.fn(),
  removeFamilyMember: vi.fn(),
}));

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

describe('FamilyGroupPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  const mockGroups = [
    {
      // `family_id` / `family_name`, which is what the API returns. The mock
      // used `group_id` / `group_name` — the names the page normalises *to* —
      // so it only ever exercised the fallback half of that normalisation.
      family_id: 'group1',
      family_name: 'The Smiths',
      primary_account_id: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
      members: [
        { patient_id: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z', name: 'Test Patient', relationship: 'Self' },
        { patient_id: 'HEALTH456', name: 'Jane Smith', relationship: 'Spouse' }
      ],
      created_at: 0,
      last_modified: 0,
    }
  ] as unknown as FamilyGroup[];

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
    });
    vi.mocked(shared.getMyFamilyGroups).mockResolvedValue({
      success: true,
      groups: mockGroups,
      count: mockGroups.length,
    });
    vi.mocked(shared.listMyMedicalIdentities).mockResolvedValue({ identities: [] });
    vi.mocked(shared.getMyWards).mockResolvedValue({
      success: true,
      relationships: [],
      count: 0,
    });
  });

  it('renders family groups page with list of groups', async () => {
    render(
      <MemoryRouter>
        <FamilyGroupPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Family Groups/i)).toBeInTheDocument();
      expect(screen.getByText(/The Smiths/i)).toBeInTheDocument();
    });
  });

  it('allows expanding a group to see members', async () => {
    render(
      <MemoryRouter>
        <FamilyGroupPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/The Smiths/i)).toBeInTheDocument();
    });

    // Find the toggle button (it's the one with the Chevron)
    const toggleButton = screen.getByRole('button', { name: /The Smiths/i });
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByText(/Jane Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Spouse/i)).toBeInTheDocument();
    });
  });

  it('allows creating a new family group', async () => {
    vi.mocked(shared.createFamilyGroup).mockResolvedValue({
      success: true,
      group_id: 'group2',
      message: 'created',
    });
    
    render(
      <MemoryRouter>
        <FamilyGroupPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Group name/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Group name/i);
    fireEvent.change(input, { target: { value: 'New Family Group' } });

    // 'Create New Group' is the section heading; the submit control is a
    // button labelled 'Create'.
    const createButton = screen.getByRole('button', { name: /^Create$/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(shared.createFamilyGroup).toHaveBeenCalledWith(expect.objectContaining({
        group_name: 'New Family Group',
        primary_contact_id: mockPatient.walletAddress,
      }));
    });
  });

  it('removes a non-primary member through the persisted API action', async () => {
    vi.mocked(shared.removeFamilyMember).mockResolvedValue({ success: true, message: 'removed' });
    render(<MemoryRouter><FamilyGroupPage /></MemoryRouter>);
    await screen.findByText(/The Smiths/i);
    fireEvent.click(screen.getByRole('button', { name: /The Smiths/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Remove Member/i }));
    await answerConfirm(true);

    await waitFor(() => {
      expect(shared.removeFamilyMember).toHaveBeenCalledWith('group1', 'HEALTH456');
    });
  });

  it('adds a member using the wallet identity the server authorizes', async () => {
    vi.mocked(shared.addFamilyMember).mockResolvedValue({ success: true, message: 'added' });

    render(<MemoryRouter><FamilyGroupPage /></MemoryRouter>);
    await screen.findByText(/The Smiths/i);
    fireEvent.click(screen.getByRole('button', { name: /The Smiths/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Add Family Member/i }));
    fireEvent.change(screen.getByPlaceholderText(/Member wallet address/i), {
      target: { value: '5FnewMemberWallet' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Relationship/i), {
      target: { value: 'Spouse' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));

    await waitFor(() => {
      expect(shared.addFamilyMember).toHaveBeenCalledWith('group1', expect.objectContaining({
        patient_id: '5FnewMemberWallet', relationship: 'Spouse',
      }));
    });
  });

  it('shows revoked authority as history rather than current record access', async () => {
    vi.mocked(shared.getMyWards).mockResolvedValue({
      success: true,
      count: 1,
      relationships: [{
        id: 'ward-relationship-1',
        guardian_wallet: mockPatient.walletAddress,
        ward_patient_id: 'PAT-CHILD-001',
        relationship_type: 'parent_or_guardian',
        permissions: ['view_records'],
        verified_by: 'admin-1',
        verified_at: '2026-09-01T08:00:00Z',
        active: false,
        revoked_at: '2026-09-10T08:00:00Z',
        revoked_reason: 'Custody updated',
      }],
    });

    render(<MemoryRouter><FamilyGroupPage /></MemoryRouter>);

    const history = await screen.findByTestId('guardianship-history-list');
    expect(history).toHaveTextContent('PAT-CHILD-001');
    expect(history).toHaveTextContent('Revoked');
    expect(history).toHaveTextContent('Custody updated');
    expect(screen.queryByTestId('medical-identity-list')).not.toBeInTheDocument();
  });
});
