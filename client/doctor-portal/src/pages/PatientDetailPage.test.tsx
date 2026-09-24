import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PatientDetailPage, { downloadPatientSummary } from './PatientDetailPage';
import { useAuthStore } from '../store';
import * as shared from '@medichain/shared';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// The capsule and guardian panels call the shared client rather than fetch, so
// they need their own mocks: without them the Access tab renders its "could not
// be read" branch and every assertion below is about an error state.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEmergencyCapsuleVersions: vi.fn(),
  getEmergencyCapsuleAccessLog: vi.fn(),
  publishEmergencyCapsule: vi.fn(),
  revokeEmergencyCapsule: vi.fn(),
  getGuardiansForWard: vi.fn(),
  updatePatient: vi.fn(),
}));

describe('PatientDetailPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  const mockPatientData = {
    patient_id: 'PAT-001',
    full_name: 'John Doe',
    date_of_birth: '1980-05-15',
    national_id: 'ID12345',
    emergency_info: {
      blood_type: 'A+',
      allergies: [{ name: 'Peanuts' }],
      current_medications: ['Lisinopril'],
      chronic_conditions: ['Hypertension'],
      emergency_contacts: [
        { name: 'Jane Doe', phone: '555-1212', relationship: 'Spouse' }
      ],
      organ_donor: true,
      dnr_status: false,
    },
    last_updated: '2025-01-01',
    primary_doctor: { name: 'Dr Test', phone: '+27000000000' },
  };

  it('exports only the displayed patient summary as JSON', () => {
    const createObjectUrl = vi.fn(() => 'blob:summary');
    const revokeObjectUrl = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });

    downloadPatientSummary({
      patientId: 'PAT-001', fullName: 'John Doe', dateOfBirth: '1980-05-15',
      nationalHealthId: 'ID12345', bloodType: 'A+', allergies: ['Peanuts'],
      currentMedications: ['Lisinopril'], chronicConditions: ['Hypertension'],
      emergencyContacts: [], organDonor: true, dnrStatus: false,
      lastUpdated: '2025-01-01', primaryDoctor: 'Dr Test',
    });

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:summary');
    click.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    vi.mocked(shared.getEmergencyCapsuleVersions).mockResolvedValue({
      success: true,
      patient_id: 'PAT-001',
      current: null,
      count: 0,
      versions: [],
    } as never);
    vi.mocked(shared.getEmergencyCapsuleAccessLog).mockResolvedValue({
      success: true,
      patient_id: 'PAT-001',
      count: 0,
      accesses: [],
    } as never);
    vi.mocked(shared.getGuardiansForWard).mockResolvedValue({
      success: true,
      count: 0,
      relationships: [],
    } as never);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockPatientData,
    });
  });

  it('renders loading state initially', () => {
    render(
      <MemoryRouter initialEntries={['/patients/PAT-001']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Loading patient information/i)).toBeInTheDocument();
  });

  it('renders patient details after loading', async () => {
    render(
      <MemoryRouter initialEntries={['/patients/PAT-001']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText(/ID12345/i)).toBeInTheDocument();
      expect(screen.getByText(/A\+/i)).toBeInTheDocument();
      expect(screen.getByText(/Peanuts/i)).toBeInTheDocument();
      expect(screen.getByText(/Lisinopril/i)).toBeInTheDocument();
      expect(screen.getByText(/Hypertension/i)).toBeInTheDocument();
    });
  });

  it('shows error message when patient is not found', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Patient not found', code: 'PATIENT_NOT_FOUND' }),
    });

    render(
      <MemoryRouter initialEntries={['/patients/INVALID']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Patient not found/i)).toBeInTheDocument();
    });
  });

  it('allows switching between tabs', async () => {
    render(
      <MemoryRouter initialEntries={['/patients/PAT-001']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Records$/i }));

    expect(screen.getByRole('heading', { name: /Medical Records/i })).toBeInTheDocument();
    expect(screen.getByText(/stored encrypted on IPFS/i)).toBeInTheDocument();
  });

  it('saves supported clinical details through the provider update API', async () => {
    vi.mocked(shared.updatePatient).mockResolvedValue({
      success: true,
      patient_id: 'PAT-001',
      updated_by: mockUser.walletAddress,
      message: 'Patient record updated successfully',
    });

    render(
      <MemoryRouter initialEntries={['/patients/PAT-001']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    fireEvent.change(screen.getByLabelText(/^Allergies$/i), { target: { value: 'Peanuts\nLatex' } });
    fireEvent.click(screen.getByRole('button', { name: /save clinical details/i }));

    await waitFor(() =>
      expect(shared.updatePatient).toHaveBeenCalledWith('PAT-001', expect.objectContaining({
        allergies: ['Peanuts', 'Latex'],
        current_medications: ['Lisinopril'],
        chronic_conditions: ['Hypertension'],
        organ_donor: true,
      }))
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Latex')).toBeInTheDocument();
  });

  // --- The emergency capsule -------------------------------------------------
  //
  // The capsule is what a paramedic reads within three seconds of tapping the
  // card. Until this panel existed, no screen in either client could publish
  // one, and the revoke endpoint took a version number that was not readable
  // anywhere.

  const capsuleVersion = (over: Record<string, unknown> = {}) => ({
    patient_id: 'PAT-001',
    version: 2,
    commitment: 'abc123',
    key_version: 1,
    created_by: '5GrwvaEF...mock',
    created_at: '2026-09-15T00:00:00Z',
    revoked_at: null,
    revoked_by: null,
    revocation_reason: null,
    chain_tx_hash: null,
    chain_finalized: false,
    ...over,
  });

  async function openAccessTab() {
    render(
      <MemoryRouter initialEntries={['/patients/PAT-001']}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /access/i }));
  }

  it('shows which capsule version is in force', async () => {
    vi.mocked(shared.getEmergencyCapsuleVersions).mockResolvedValue({
      success: true,
      patient_id: 'PAT-001',
      current: capsuleVersion(),
      count: 1,
      versions: [capsuleVersion()],
    } as never);
    await openAccessTab();

    await waitFor(() =>
      expect(screen.getByText(/Version 2 is in force/i)).toBeInTheDocument()
    );
  });

  it('does not claim an on-chain anchoring for an unfinalized hash', async () => {
    // A transaction hash with `chain_finalized: false` is a placeholder. Showing
    // it as an anchoring would assert something that did not happen.
    vi.mocked(shared.getEmergencyCapsuleVersions).mockResolvedValue({
      success: true,
      patient_id: 'PAT-001',
      current: capsuleVersion({ chain_tx_hash: '0xdeadbeef', chain_finalized: false }),
      count: 1,
      versions: [capsuleVersion({ chain_tx_hash: '0xdeadbeef', chain_finalized: false })],
    } as never);
    await openAccessTab();

    await waitFor(() =>
      expect(screen.getByText(/Not anchored on-chain/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/0xdeadbeef/)).not.toBeInTheDocument();
  });

  it('keeps a revoked version listed and offers no revoke button for it', async () => {
    vi.mocked(shared.getEmergencyCapsuleVersions).mockResolvedValue({
      success: true,
      patient_id: 'PAT-001',
      current: null,
      count: 1,
      versions: [capsuleVersion({ revoked_at: '2026-09-15T01:00:00Z' })],
    } as never);
    await openAccessTab();

    // That a directive was in force between two dates is part of the record.
    await waitFor(() => expect(screen.getByText(/Revoked/i)).toBeInTheDocument());
    expect(screen.getByText(/No capsule has been published/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Revoke$/i })).not.toBeInTheDocument();
  });

  it('reports a failed capsule read instead of an empty card', async () => {
    vi.mocked(shared.getEmergencyCapsuleVersions).mockRejectedValue(new Error('boom'));
    await openAccessTab();

    // "No capsule" tells a clinician the card is blank. "Could not be read"
    // tells them they do not know, which is the truth.
    await waitFor(() =>
      expect(screen.getByText(/could not be read. This is not an empty card/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/No capsule has been published/i)).not.toBeInTheDocument();
  });

  it('shows which fields a break-glass read actually revealed', async () => {
    vi.mocked(shared.getEmergencyCapsuleVersions).mockResolvedValue({
      success: true,
      patient_id: 'PAT-001',
      current: capsuleVersion(),
      count: 1,
      versions: [capsuleVersion()],
    } as never);
    vi.mocked(shared.getEmergencyCapsuleAccessLog).mockResolvedValue({
      success: true,
      patient_id: 'PAT-001',
      count: 1,
      accesses: [
        {
          id: 'ACC-1',
          patient_id: 'PAT-001',
          capsule_version: 2,
          accessed_by: '5Paramedic...mock',
          grant_id: 'GRANT-1',
          reason_code: 'emergency_nfc_access',
          reason_text: null,
          fields_revealed: ['blood_type', 'allergies'],
          commitment_verified: true,
          accessed_at: '2026-09-15T02:00:00Z',
        },
      ],
    } as never);
    await openAccessTab();

    // The panel this replaced said "View complete audit trail of who accessed
    // this patient's records" and showed nothing at all.
    await waitFor(() => expect(screen.getByText(/5Paramedic/)).toBeInTheDocument());
    expect(screen.getByText(/blood_type, allergies/)).toBeInTheDocument();
  });

});
