/**
 * Patient first: inside the workspace a form needs no patient picking, the
 * banner keeps the patient identifiable, every save lands in "This visit", and
 * closing the patient lists what was saved and warns about what was not.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, clearAllDrafts, draftsForPatient, getApiClient, useUnsavedChanges, writeDraft } from '@medichain/shared';
import { PatientWorkspace } from './PatientWorkspace';
import PatientSelect from '../components/PatientSelect';
import { useAuthStore } from '../store/authStore';
import { clearVisit } from './visitLog';

vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));
vi.mock('../components/AccessReasonGate', () => ({
  AccessReasonGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const PID = 'PAT-WS-1';

function answer(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

/** The clinician's booked day, as /api/dashboard/doctor/today answers it. */
let todayBody: unknown = {};

function server() {
  const fetchMock = vi.fn().mockImplementation((raw: unknown, init?: RequestInit) => {
    const url = String(raw);
    if (init?.method === 'POST' && url.includes('/api/clinical/soap')) return answer(201, { id: 'SOAP-1' });
    if (url.includes('/api/dashboard/doctor/today')) return answer(200, todayBody);
    if (url.includes(`/api/patients/${PID}`)) {
      return answer(200, {
        patient_id: PID, full_name: 'Thandiwe Ndlovu', date_of_birth: '1992-03-12', gender: 'Female',
        national_id: '', created_at: '', last_updated: '',
        emergency_info: { patient_id: PID, blood_type: 'O+', allergies: [{ name: 'Penicillin', severity: 'Severe' }],
          current_medications: [], chronic_conditions: [], emergency_contacts: [], organ_donor: false, dnr_status: false, last_updated: '' },
      });
    }
    if (url.includes('/api/patients')) return answer(200, { data: [{ patient_id: PID, full_name: 'Thandiwe Ndlovu', date_of_birth: '1992-03-12' }] });
    return answer(200, {});
  });
  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

/** A stand-in for any existing form: it picks a patient and saves. */
function FakeSoapForm() {
  const [patientId, setPatientId] = useState('');
  const [text, setText] = useState('');
  useUnsavedChanges(text !== '', 'SOAP note');
  return (
    <form onSubmit={(e) => { e.preventDefault(); void getApiClient().post('/api/clinical/soap', { patient_id: patientId }); }}>
      <PatientSelect id="soap-patient" label="Patient" value={patientId} onChange={setPatientId} />
      <p data-testid="chosen">{patientId}</p>
      <label htmlFor="s">Subjective</label>
      <input id="s" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit">Save SOAP</button>
    </form>
  );
}

/** A form that keeps no draft and registers nothing: most of the forty. */
function PlainOrderForm() {
  return (
    <form>
      <label htmlFor="o">Order details</label>
      <input id="o" defaultValue="" />
    </form>
  );
}

const FORMS = { soap: <FakeSoapForm />, orders: <PlainOrderForm /> };

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/patients/:patientId" element={<PatientWorkspace forms={FORMS} home={<p>Chart home</p>} />} />
          <Route path="/patients/:patientId/:form" element={<PatientWorkspace forms={FORMS} home={<p>Chart home</p>} />} />
          <Route path="/dashboard" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('PatientWorkspace', () => {
  beforeEach(() => {
    const state = { user: { userId: 'doctor-1', role: 'Doctor' } };
    vi.mocked(useAuthStore).mockImplementation(((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state)) as never);
    server();
  });
  afterEach(() => {
    clearVisit('doctor-1', PID);
    clearAllDrafts();
    todayBody = {};
  });

  it('shows the patient with two identifiers and their allergies in the banner', async () => {
    renderAt(`/patients/${PID}`);
    const banner = await screen.findByRole('banner', { name: /open patient/i });
    await within(banner).findByRole('heading', { name: 'Thandiwe Ndlovu' });
    expect(within(banner).getByText(/born/)).toBeInTheDocument();
    expect(within(banner).getByText(/Penicillin/)).toBeInTheDocument();
    expect(screen.getByText('Chart home')).toBeInTheDocument();
  });

  it('offers the doctor’s common forms and opens one with the patient already chosen', async () => {
    renderAt(`/patients/${PID}/soap`);
    const nav = await screen.findByRole('navigation', { name: /forms for this patient/i });
    expect(within(nav).getByRole('link', { name: /SOAP/i })).toHaveAttribute('aria-current', 'page');
    // The form's own picker adopted the workspace patient: nothing to search for.
    await waitFor(() => expect(screen.getByTestId('chosen')).toHaveTextContent(PID));
    expect(screen.queryByRole('textbox', { name: /patient: search/i })).not.toBeInTheDocument();
  });

  it('records a save in "This visit" under the form that was open', async () => {
    renderAt(`/patients/${PID}/soap`);
    await waitFor(() => expect(screen.getByTestId('chosen')).toHaveTextContent(PID));
    fireEvent.click(screen.getByRole('button', { name: 'Save SOAP' }));
    const visit = await screen.findByRole('complementary', { name: /this visit/i });
    await within(visit).findByText(/SOAP Notes saved/i);
  });

  it('closing lists what was saved and warns about unsaved work', async () => {
    renderAt(`/patients/${PID}/soap`);
    await waitFor(() => expect(screen.getByTestId('chosen')).toHaveTextContent(PID));
    fireEvent.click(screen.getByRole('button', { name: 'Save SOAP' }));
    await screen.findByText(/SOAP Notes saved/i);
    fireEvent.change(screen.getByLabelText('Subjective'), { target: { value: 'Chest pain' } });

    fireEvent.click(screen.getByRole('button', { name: /close patient/i }));
    const dialog = await screen.findByRole('dialog', { name: /close thandiwe ndlovu/i });
    expect(within(dialog).getByText("SOAP Notes")).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('SOAP note');

    fireEvent.click(within(dialog).getByRole('button', { name: /close and discard/i }));
    await screen.findByText('Dashboard');
  });

  it('catches typing in a form that keeps no draft of its own', async () => {
    renderAt(`/patients/${PID}/orders`);
    fireEvent.input(await screen.findByLabelText('Order details'), { target: { value: 'CBC' } });
    fireEvent.click(screen.getByRole('button', { name: /close patient/i }));
    const dialog = await screen.findByRole('dialog', { name: /close thandiwe ndlovu/i });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Physician Orders');
    fireEvent.click(within(dialog).getByRole('button', { name: /close and discard/i }));
    await screen.findByText('Dashboard');
  });

  it('discards the work in the form on screen, one item at a time', async () => {
    renderAt(`/patients/${PID}/orders`);
    fireEvent.input(await screen.findByLabelText('Order details'), { target: { value: 'CBC' } });
    fireEvent.click(screen.getByRole('button', { name: /close patient/i }));
    const dialog = await screen.findByRole('dialog', { name: /close thandiwe ndlovu/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard Physician Orders' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());
    // Nothing left to lose: the plain close is offered again.
    expect(within(dialog).getByRole('button', { name: 'Close patient' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /back to patient/i }));
    // The form came back empty.
    expect(await screen.findByLabelText('Order details')).toHaveValue('');
  });

  it('opens the form holding a draft so it can be saved there', async () => {
    writeDraft('soap', PID, { subjective: 'Headache' });
    renderAt(`/patients/${PID}/orders`);
    fireEvent.click(await screen.findByRole('button', { name: /close patient/i }));
    const dialog = await screen.findByRole('dialog', { name: /close thandiwe ndlovu/i });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('SOAP Notes is not saved');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open SOAP Notes to save it' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/patients/${PID}/soap`));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(draftsForPatient(PID)).toEqual(['soap']);
  });

  it('discards a draft kept for another form without opening it', async () => {
    writeDraft('soap', PID, { subjective: 'Headache' });
    renderAt(`/patients/${PID}/orders`);
    fireEvent.click(await screen.findByRole('button', { name: /close patient/i }));
    const dialog = await screen.findByRole('dialog', { name: /close thandiwe ndlovu/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard SOAP Notes' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());
    expect(draftsForPatient(PID)).toEqual([]);
  });

  it('goes straight on to the next booked patient', async () => {
    const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    todayBody = {
      today: { date: '', patients: [], appointments: [
        { id: 'A1', patient_id: 'PAT-NEXT', title: 'Appointment', detail: null, at: soon, urgency: 'routine' },
      ], consults: [], refills: [], results_to_review: [], critical_values: [], unavailable: [] },
      names: [{ patient_id: 'PAT-NEXT', full_name: 'Sipho Mabaso', date_of_birth: '1980-01-01', content_available: true }],
    };
    renderAt(`/patients/${PID}`);
    fireEvent.click(await screen.findByRole('button', { name: /close patient/i }));
    const dialog = await screen.findByRole('dialog', { name: /close thandiwe ndlovu/i });
    expect(within(dialog).getByText(/opened /)).toBeInTheDocument();
    fireEvent.click(await within(dialog).findByRole('button', { name: /close · next: sipho mabaso/i }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/patients/PAT-NEXT'));
  });
});
