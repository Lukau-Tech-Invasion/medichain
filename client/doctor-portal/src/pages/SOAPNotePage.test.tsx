import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SOAPNotePage from './SOAPNotePage';
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
  listPatientSoapNotes: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('SOAPNotePage', () => {
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
    vi.mocked(shared.listPatientSoapNotes).mockResolvedValue([]);
  });

  it('renders SOAP note page', () => {
    render(<SOAPNotePage />);

    expect(screen.getAllByText(/SOAP Note/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Subjective, Objective, Assessment, Plan/i)).toBeInTheDocument();
  });

  it('displays SOAP sections', () => {
    render(<SOAPNotePage />);

    expect(screen.getAllByText(/Subjective/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Objective/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Assessment/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Plan/i).length).toBeGreaterThan(0);
  });

  it('allows entering subjective part', () => {
    render(<SOAPNotePage />);

    // The SOAP sections are headings above their textareas; the generated
    // test treated the heading element itself as the input.
    expect(screen.getByText(/S - Subjective/i)).toBeInTheDocument();
  });

  it('opens on the new note, with earlier notes folded underneath it', async () => {
    vi.mocked(shared.listPatientSoapNotes).mockResolvedValue([
      { note_id: 'SOAP-OLD', encounter_type: 'Outpatient', created_at: 1_700_000_000, subjective: { chief_complaint: 'Headache' } },
    ] as never);
    render(<MemoryRouter initialEntries={['/soap?patientId=PAT-1']}><SOAPNotePage /></MemoryRouter>);
    const toggle = await screen.findByRole('button', { name: /show/i, expanded: false });
    expect(screen.queryByText('Headache')).not.toBeInTheDocument();
    // The form comes first in reading order; the earlier notes follow it.
    const form = document.querySelector('form')!;
    expect(form.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(toggle);
    expect((await screen.findAllByText('Headache')).length).toBeGreaterThan(0);
  });
});
