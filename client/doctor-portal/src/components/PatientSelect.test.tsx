import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider, getApiClient } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PatientSelect from './PatientSelect';
import { resetDeclaredAccessForTests } from './ChartAccess';
import { useAuthStore } from '../store/authStore';

vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

function answer(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });
}

const PATIENT = { patient_id: 'PAT-SEL-1', full_name: 'Thandi Mokoena', health_id: 'HID-9', date_of_birth: '1990-01-01' };

/** The directory returns one patient; the access-context POST opens ACX-SEL. */
function server() {
  const fetchMock = vi.fn().mockImplementation((raw: unknown, init?: RequestInit) => {
    const url = String(raw);
    if (init?.method === 'POST' && url.includes('/access-context')) {
      return answer(201, { access_context_id: 'ACX-SEL', authority_type: 'care_relationship', expires_at: '2026-09-26T20:00:00Z' });
    }
    if (url.includes('/api/patients')) return answer(200, { data: [PATIENT] });
    return answer(200, {});
  });
  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

function Picker({ onChange }: { onChange: (id: string) => void }) {
  return (
    <I18nProvider>
      <PatientSelect id="patient" label="Patient" value="" onChange={onChange} />
    </I18nProvider>
  );
}

async function pick() {
  fireEvent.change(screen.getByLabelText(/Patient/), { target: { value: 'Than' } });
  fireEvent.click(await screen.findByRole('button', { name: /Thandi Mokoena/ }));
}

describe('PatientSelect access reason (WP10)', () => {
  beforeEach(() => {
    resetDeclaredAccessForTests();
    vi.mocked(useAuthStore).mockReturnValue({ user: { walletAddress: 'doctor', role: 'Doctor' } } as never);
  });

  it('asks why before handing the patient to the page, then cites the context on reads', async () => {
    const fetchMock = server();
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await pick();
    const dialog = screen.getByRole('dialog');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Treatment' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('PAT-SEL-1', expect.objectContaining({ patient_id: 'PAT-SEL-1' })));

    fetchMock.mockClear();
    await getApiClient().get('/api/clinical/patient/PAT-SEL-1/vitals');
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Access-Context']).toBe('ACX-SEL');
    expect(headers['X-Access-Reason']).toBe('treatment');
  });

  it('asks once per patient per tab', async () => {
    server();
    const first = render(<Picker onChange={vi.fn()} />);
    await pick();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Referral' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    first.unmount();

    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await pick();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith('PAT-SEL-1', expect.anything());
  });

  it('selects nothing when the clinician cancels', async () => {
    server();
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await pick();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
