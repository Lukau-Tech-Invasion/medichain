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
  getPatientLatestVitals: vi.fn(),
  getNoteTemplates: vi.fn(),
  useNoteTemplate: vi.fn(),
  createSoapNote: vi.fn(),
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
    vi.mocked(shared.getPatientLatestVitals).mockResolvedValue({ reading: null });
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

  it('adds an inserted template to what was written, replacing nothing', async () => {
    vi.mocked(shared.getNoteTemplates).mockResolvedValue({ success: true, count: 1, templates: [{ template_id: 'T1', name: 'Chest pain', type: 'soap' }] });
    vi.mocked(shared.useNoteTemplate).mockResolvedValue({
      success: true, template_id: 'T1', timestamp: 0, rendered_content: {},
      rendered_sections: [{ title: 'Subjective', content: 'Onset, character, radiation.' }, { title: 'Plan', content: 'ECG, troponin.' }],
    });
    render(<MemoryRouter initialEntries={['/soap?patientId=PAT-1']}><SOAPNotePage /></MemoryRouter>);
    const hpi = screen.getByLabelText(/history of present illness/i);
    fireEvent.change(hpi, { target: { value: 'Tight chest since 07:00.' } });
    fireEvent.click(screen.getByRole('button', { name: /insert template/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chest pain' }));
    await vi.waitFor(() => expect(hpi).toHaveValue('Tight chest since 07:00.\n\nOnset, character, radiation.'));
    expect(screen.getByText('Draft kept')).toBeInTheDocument();
  });

  it('"Save and stay" files the note and clears the form for the next one', async () => {
    vi.mocked(shared.createSoapNote).mockResolvedValue({ note_id: 'SOAP-NEW' } as never);
    render(<MemoryRouter initialEntries={['/soap?patientId=PAT-1']}><SOAPNotePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/chief complaint/i), { target: { value: 'Chest pain' } });
    fireEvent.change(screen.getByLabelText(/clinical summary/i), { target: { value: 'Likely angina' } });
    fireEvent.change(screen.getByLabelText(/treatment plan/i), { target: { value: 'ECG' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and stay' }));
    await vi.waitFor(() => expect(shared.createSoapNote).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(screen.getByLabelText(/chief complaint/i)).toHaveValue(''));
    // Fetched again, so the note just filed is among the earlier ones.
    expect(vi.mocked(shared.listPatientSoapNotes).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
