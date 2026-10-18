import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MyRecordsPage } from './MyRecordsPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
  }),
}));

/** Every section the records summary returns (WP11). */
const SUMMARY_KEYS = [
  'history-physicals', 'progress-notes', 'wounds', 'vitals', 'discharges', 'imaging', 'pathology',
  'consults', 'care-plans', 'blood', 'procedures', 'ama-discharges', 'intake-output',
  'pharmacy-decisions', 'ems-handoffs',
  'immunizations', 'medication-administrations', 'emergency-care',
];

describe('MyRecordsPage (Patient)', () => {
  const mockPatientId = 'HEALTH123';

  beforeEach(() => {
    // jsdom does not implement native dialogs; focus containment is verified in Chrome.
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    vi.clearAllMocks();
    usePatientAuthStore.setState({
      patient: {
        userId: 'test-patient-user-id',
        healthId: mockPatientId,
        fullName: 'Test Patient',
        firstName: 'Test',
        createdAt: '2025-01-01T00:00:00Z',
      },
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/lab/patient/')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            submissions: [
              {
                id: 'lab1',
                status: 'Approved',
                test_name: 'Blood Count',
                test_category: 'Hematology',
                submitted_by: 'Dr. Smith',
                submitted_at: '2025-01-01T10:00:00Z',
                results: [{ parameter: 'WBC', value: '5.0', unit: '10^9/L', reference_range: '4.0-11.0' }],
              }
            ],
          }),
        });
      }
      if (url.includes('/api/clinical/patient/') && url.endsWith('/gcs')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            assessments: [{ assessment_id: 'GCS-OWN', total_score: 15,
              interpretation: 'Stored interpretation', assessed_by: 'Nurse QA',
              assessed_at: '2026-10-10T10:00:00Z' }],
          }),
        });
      }
      if (url.includes('/records-summary')) {
        // One read for most sections (WP11); vitals arrive inside it.
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            patient_id: mockPatientId,
            page: 0,
            per_page: 50,
            unavailable: [],
            sections: {
              ...Object.fromEntries(SUMMARY_KEYS.map((key) => [key, {}])),
              vitals: {
                readings: [{
                  reading_id: 'VIT-1',
                  heart_rate: 84,
                  systolic_bp: 122,
                  diastolic_bp: 78,
                  temperature_celsius: 37.2,
                  recorded_by: 'Dr. Smith',
                  recorded_at: '2025-01-02T10:00:00Z',
                }],
              },
              immunizations: { immunizations: [{
                id: 'IMM-OWN', vaccine_name: 'QA influenza vaccination', dose_number: 1,
                lot_number: 'QA-LOT', administered_by_name: 'Nurse QA', administration_date: '2026-10-10',
              }] },
              'medication-administrations': { administrations: [{
                administration_id: 'ADM-OWN', medication_name: 'QA amlodipine', dose: '5 mg', route: 'PO',
                status: 'given', administered_by: 'Nurse QA', administered_at: '2026-10-18T08:00:00Z',
              }, {
                administration_id: 'ADM-HELD', medication_name: 'QA metformin', status: 'held',
                reason_not_given: 'Nil by mouth', administered_by: 'Nurse QA', record_date: '2026-10-18',
              }] },
              'emergency-care': { code_blues: [{
                id: 'CB-OWN', outcome: 'ROSC', documented_by: 'Doctor QA', created_at: '2026-10-18T09:00:00Z',
              }], traumas: [], strokes: [], cardiac_events: [], sepsis_assessments: [] },
              procedures: {
                anesthesia_records: [{ id: 'ANES-OWN', procedure_name: 'QA anaesthesia procedure', anesthesiologist_id: 'Doctor QA', created_at: '2026-10-11T10:30:00Z' }],
                pre_op_assessments: [{ id: 'PRE-OWN', procedure_name: 'QA pre-operative procedure', assessed_by: 'Doctor QA', assessed_at: '2026-10-11T10:00:00Z' }],
                operative_notes: [{ id: 'OP-OWN', procedure_name: 'QA operative procedure', surgeon_id: 'Doctor QA', created_at: '2026-10-11T11:00:00Z' }],
                post_op_notes: [{ id: 'POST-OWN', provider_id: 'Doctor QA', note_date: '2026-10-11T12:00:00Z' }],
              },
            },
          }),
        });
      }
      if (url.includes('/api/clinical/patient/') && url.includes('/vitals')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            readings: [{
              reading_id: 'VIT-1',
              heart_rate: 84,
              systolic_bp: 122,
              diastolic_bp: 78,
              temperature_celsius: 37.2,
              recorded_by: 'Dr. Smith',
              recorded_at: '2025-01-02T10:00:00Z',
            }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ records: [] }),
      });
    });
  });

  it('renders my records page with lab results', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/My Medical Records/i)).toBeInTheDocument();
      expect(screen.getByText(/Blood Count/i)).toBeInTheDocument();
    });
  });

  it('renders persisted vital readings from the current API contract', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/BP 122\/78/)).toBeInTheDocument();
      expect(screen.getByText(/37\.2 C/)).toBeInTheDocument();
    });
  });

  it('shows a resuscitation the patient was given', async () => {
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Resuscitation (code blue)' })).toBeInTheDocument();
    expect(screen.getAllByText('Outcome: ROSC').length).toBeGreaterThan(0);
  });

  it('shows the doses the ward recorded, including one that was held and why', async () => {
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Medication given: QA amlodipine' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Medication held: QA metformin' })).toBeInTheDocument();
    expect(screen.getAllByText(/Reason: Nil by mouth/).length).toBeGreaterThan(0);
  });

  it('includes stored immunizations in the vaccination filter and record details', async () => {
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    const record = await screen.findByRole('heading', { name: 'QA influenza vaccination' });
    fireEvent.click(screen.getByRole('button', { name: 'Vaccination' }));
    expect(record).toBeInTheDocument();
    expect(screen.queryByText('Blood Count')).not.toBeInTheDocument();
    fireEvent.click(record);
    expect(screen.getByText('Record Details')).toBeInTheDocument();
    expect(screen.getAllByText('Nurse QA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dose 1 · Lot QA-LOT').length).toBeGreaterThan(0);
  });

  it('keeps bedside observations out of lab results and labels their details accurately', async () => {
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Vital signs' });
    fireEvent.click(screen.getByRole('button', { name: 'Lab Result' }));
    expect(screen.getByText('Blood Count')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vital signs' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vital Signs' }));
    expect(screen.queryByText('Blood Count')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('heading', { name: 'Vital signs' }));
    expect(screen.getByText('Record Details')).toBeInTheDocument();
    expect(screen.getByText('Vital Signs', { selector: 'span' })).toBeInTheDocument();
  });

  it('lists GCS under assessments without mixing it into consultations', async () => {
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Glasgow Coma Scale 15' });
    fireEvent.click(screen.getByRole('button', { name: 'Consultation' }));
    expect(screen.queryByRole('heading', { name: 'Glasgow Coma Scale 15' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByRole('heading', { name: 'Glasgow Coma Scale 15' })).toBeInTheDocument();
    expect(screen.queryByText('Blood Count')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('heading', { name: 'Glasgow Coma Scale 15' }));
    expect(screen.getByText('Assessment', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByText('Stored interpretation').length).toBeGreaterThan(0);
  });

  it('filters records by search query', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Blood Count/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search records/i);
    fireEvent.change(searchInput, { target: { value: 'X-Ray' } });

    expect(screen.queryByText(/Blood Count/i)).not.toBeInTheDocument();
  });

  it('filters records by type', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Blood Count/i)).toBeInTheDocument();
    });

    // The type filter is a row of buttons, not a <select> — the generated test
    // assumed a dropdown that does not exist.
    fireEvent.click(screen.getByRole('button', { name: /Imaging/i }));

    expect(screen.queryByText(/Blood Count/i)).not.toBeInTheDocument();
  });

  it('opens record details when clicking on a record', async () => {
    render(
      <MemoryRouter>
        <MyRecordsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const record = screen.getByText(/Blood Count/i);
      fireEvent.click(record);
    });

    expect(screen.getByText(/Record Details/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Hematology/i).length).toBeGreaterThan(0);
  });

  it('says the record is partial when a summary section could not be read', async () => {
    const complete = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/records-summary')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            patient_id: mockPatientId,
            page: 0,
            per_page: 50,
            unavailable: ['imaging'],
            sections: Object.fromEntries(SUMMARY_KEYS.filter((key) => key !== 'imaging').map((key) => [key, {}])),
          }),
        });
      }
      return complete!(url, init);
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MyRecordsPage />
      </MemoryRouter>
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows the seal state of a stored document, and nothing chain-related', async () => {
    const complete = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes(`/api/records/${mockPatientId}`)) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve([{
            content_hash: 'Qm-sealed',
            metadata_hash: 'Qm-meta',
            record_type: 'discharge_summary',
            uploaded_at: 1_767_225_600,
            content_checksum: 'abc',
            seal_status: 'exported',
          }]),
        });
      }
      return complete!(url, init);
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MyRecordsPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('heading', { name: /Discharge Summary/i }));
    const badge = await screen.findByTestId('seal-badge');
    expect(badge).toHaveTextContent('Sealed and exported');
  });

  it('shows no seal badge for a record the server reported no seal state for', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MyRecordsPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByText(/Blood Count/i));
    await screen.findByText(/Record Details/i);
    expect(screen.queryByTestId('seal-badge')).not.toBeInTheDocument();
  });

  it('lists all three surgical documentation stages with their stored descriptions and providers', async () => {
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    for (const title of ['Pre-operative assessment', 'Operative note', 'Post-operative note']) {
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    }
    fireEvent.change(screen.getByPlaceholderText('Search records...'), { target: { value: 'QA pre-operative procedure' } });
    expect(screen.getByText('Doctor QA')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pre-operative assessment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Operative note' })).not.toBeInTheDocument();
  });

  it('classifies anaesthesia and surgical records as procedures in filters and details', async () => {
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Anaesthesia' });
    fireEvent.click(screen.getByRole('button', { name: 'Procedure' }));
    expect(screen.getByRole('heading', { name: 'Anaesthesia' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operative note' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-operative assessment' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('heading', { name: 'Anaesthesia' }));
    expect(screen.getByText('Record Details')).toBeInTheDocument();
    expect(screen.getAllByText('Procedure').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Consultation' }));
    expect(screen.queryByRole('heading', { name: 'Anaesthesia' })).not.toBeInTheDocument();
  });

  it('does not reopen a preview after its record details were dismissed during loading', async () => {
    let finish!: (response: unknown) => void;
    const previous = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => url.endsWith('/download')
      ? new Promise(resolve => { finish = resolve; }) : previous(url, init));
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('heading', { name: 'Anaesthesia' }));
    const details = screen.getByRole('dialog', { name: 'Record Details' });
    fireEvent.click(within(details).getByRole('button', { name: 'View' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent(details, new Event('cancel', { cancelable: true }));
    await act(async () => { finish({ ok: true, headers: new Headers({ 'content-type': 'text/plain' }),
      blob: async () => ({ text: async () => 'Late report' }) }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Late report')).not.toBeInTheDocument();
  });
});
