import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HistoryAndPhysicalPage, { normalizeHistoryPhysical } from './HistoryAndPhysicalPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { fillField, fieldValue } from '../test/fields';

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

describe('HistoryAndPhysicalPage', () => {
  it('normalizes a saved wire record without losing its examination or crashing its summary', () => {
    const record = normalizeHistoryPhysical({
      hp_id: 'HP-saved', patient_id: 'PAT-synthetic', patient_name: 'Thandiwe Ndlovu',
      chief_complaint: 'Diabetes follow-up', history_of_present_illness: 'Improved energy',
      vital_signs: { bloodPressure: '128/80', heartRate: '78' }, status: 'signed',
      addenda: [{ addendum_id: 'HPA-saved', content: 'Follow-up arranged', author_id: 'doctor', created_at: '2026-10-08T00:00:00Z' }],
    });
    expect(record.id).toBe('HP-saved');
    expect(record.patientName).toBe('Thandiwe Ndlovu');
    expect(record.chiefComplaint).toBe('Diabetes follow-up');
    expect(record.historyOfPresentIllness).toBe('Improved energy');
    expect(record.vitalSigns.bloodPressure).toBe('128/80');
    expect(record.vitalSigns.respiratoryRate).toBe('');
    expect(record.addenda?.[0].content).toBe('Follow-up arranged');
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

  it('renders H&P page', async () => {
    render(<HistoryAndPhysicalPage />);

    expect(screen.getByText(/History & Physical/i)).toBeInTheDocument();
    expect(screen.getByText(/Document comprehensive patient evaluations/i)).toBeInTheDocument();
  });

  it('displays assessment sections', async () => {
    render(<HistoryAndPhysicalPage />);

    // The H&P form is in the 'New H&P' tab; the page opens on the records
    // list, and fetches on mount so the tab strip is not there at once.
    await waitFor(() => expect(screen.getAllByText(/New H&P/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/New H&P/i)[0]);

    expect(screen.getAllByText(/Chief Complaint/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/History of Present Illness/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Review of Systems/i).length).toBeGreaterThan(0);
  });

  it('allows entering chief complaint', async () => {
    render(<HistoryAndPhysicalPage />);

    // The H&P form is in the 'New H&P' tab; the page opens on the records
    // list, and fetches on mount so the tab strip is not there at once.
    await waitFor(() => expect(screen.getAllByText(/New H&P/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/New H&P/i)[0]);

    const input = screen.getByLabelText(/Chief Complaint/i);
    fireEvent.change(input, { target: { value: 'Severe headache' } });
    expect(input).toHaveValue('Severe headache');
  });

  it('uses a selected template to open the matching editable examination form', async () => {
    render(<HistoryAndPhysicalPage />);
    await waitFor(() => expect(screen.getByText(/^Templates$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Templates$/i));
    fireEvent.click(screen.getAllByRole('button', { name: /Use Template/i })[2]);

    expect(document.querySelector<HTMLInputElement>('input[name="examType"][value="pre-operative"]')).toBeChecked();
  });

  it('leaves uncollected social history unknown until explicitly selected', async () => {
    render(<HistoryAndPhysicalPage />);
    await waitFor(() => expect(screen.getAllByText(/New H&P/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/New H&P/i)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Medical History' }));
    for (const label of ['Tobacco Use', 'Alcohol Use', 'Illicit Drugs']) {
      expect(fieldValue(label)).toBe('');
    }
    fillField('Tobacco Use', 'former');
    expect(fieldValue('Tobacco Use')).toBe('former');
    expect(fieldValue('Alcohol Use')).toBe('');
  });

  it('reads back the saved histories, examination and unknown observations in View', async () => {
    vi.spyOn(shared, 'listHistoryPhysicals').mockResolvedValueOnce([{
      hp_id: 'HP-readback-QA', patient_id: 'PAT-QA', patient_name: 'Synthetic QA Patient',
      status: 'in-progress', exam_type: 'admission', date_of_exam: '2026-10-09T06:00:00Z',
      chief_complaint: 'Synthetic review', history_of_present_illness: 'QA narrative',
      past_medical_history: ['QA medical history'], past_surgical_history: ['QA surgical history'],
      medications: ['QA medication'], allergies: ['QA allergy'], family_history: ['QA family history'],
      social_history: { smoking: '', alcohol: '', drugs: '', occupation: 'QA occupation', exercise: '' },
      review_of_systems: { respiratory: 'abnormal' },
      physical_exam: { respiratory: { status: 'abnormal', notes: 'QA examination finding' } },
      vital_signs: { bloodPressure: '128/80' }, assessment: 'QA assessment', plan: 'QA plan',
    }] as never);
    render(<HistoryAndPhysicalPage />);
    fireEvent.click(await screen.findByTitle('View'));
    const detail = within(screen.getByRole('dialog'));
    for (const text of ['QA medical history', 'QA surgical history', 'QA medication', 'QA allergy',
      'QA family history', 'QA occupation', 'QA examination finding', '128/80']) {
      expect(detail.getByText(text)).toBeInTheDocument();
    }
    expect(detail.getAllByText('Not recorded').length).toBeGreaterThan(0);
    fireEvent.click(detail.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens only the selected record as a printable document before invoking print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    vi.spyOn(shared, 'listHistoryPhysicals').mockResolvedValueOnce([
      { hp_id: 'HP-print-one', patient_id: 'PAT-one', patient_name: 'First QA Patient',
        date_of_exam: '2026-10-09T06:00:00Z', status: 'in-progress', exam_type: 'admission',
        history_of_present_illness: 'First saved narrative', plan: 'First saved plan' },
      { hp_id: 'HP-print-two', patient_id: 'PAT-two', patient_name: 'Other QA Patient',
        date_of_exam: '2026-10-09T06:00:00Z', status: 'signed', exam_type: 'follow-up',
        history_of_present_illness: 'Other confidential narrative', plan: 'Other saved plan' },
    ] as never);
    render(<HistoryAndPhysicalPage />);
    fireEvent.click((await screen.findAllByTitle('Print'))[0]);
    const document = screen.getByRole('dialog');
    expect(document.closest('.hp-record-document')?.parentElement).toBe(window.document.body);
    expect(within(document).getByText('First saved narrative')).toBeInTheDocument();
    expect(within(document).queryByText('Other confidential narrative')).not.toBeInTheDocument();
    expect(within(document).queryByText('Other QA Patient')).not.toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(within(document).getByRole('button', { name: 'Print document' }));
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });
});
