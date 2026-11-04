/**
 * Patient first: inside the workspace a form needs no patient picking, the
 * banner keeps the patient identifiable, every save lands in "This visit", and
 * closing the patient lists what was saved and warns about what was not.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, getApiClient, useUnsavedChanges } from '@medichain/shared';
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

function server() {
  const fetchMock = vi.fn().mockImplementation((raw: unknown, init?: RequestInit) => {
    const url = String(raw);
    if (init?.method === 'POST' && url.includes('/api/clinical/soap')) return answer(201, { id: 'SOAP-1' });
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

function renderAt(path: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientWorkspace forms={{ soap: <FakeSoapForm /> }} home={<p>Chart home</p>} />} />
          <Route path="/patients/:patientId/:form" element={<PatientWorkspace forms={{ soap: <FakeSoapForm /> }} home={<p>Chart home</p>} />} />
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
});
