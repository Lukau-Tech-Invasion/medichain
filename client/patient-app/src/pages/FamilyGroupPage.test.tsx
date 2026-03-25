import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FamilyGroupPage } from './FamilyGroupPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getMyFamilyGroups: vi.fn(),
  createFamilyGroup: vi.fn(),
  addFamilyMember: vi.fn(),
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
      group_id: 'group1',
      group_name: 'The Smiths',
      members: [
        { patient_id: 'HEALTH123', name: 'Test Patient', relationship: 'Self' },
        { patient_id: 'HEALTH456', name: 'Jane Smith', relationship: 'Spouse' }
      ],
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
    });
    (shared.getMyFamilyGroups as any).mockResolvedValue({ groups: mockGroups });
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
    (shared.createFamilyGroup as any).mockResolvedValue({});
    
    render(
      <MemoryRouter>
        <FamilyGroupPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/New Group Name/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/New Group Name/i);
    fireEvent.change(input, { target: { value: 'New Family Group' } });

    const createButton = screen.getByText(/Create Group/i);
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(shared.createFamilyGroup).toHaveBeenCalledWith(expect.objectContaining({
        group_name: 'New Family Group',
        primary_contact_id: 'HEALTH123',
      }));
    });
  });
});
