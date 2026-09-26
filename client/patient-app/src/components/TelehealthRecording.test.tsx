import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider, RecordingControls, TelehealthRecordingList } from '@medichain/shared';
import type { RecordingStatus } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// The components call the shared API client, so the network edge is mocked.
const mockFetch = vi.fn();
global.fetch = mockFetch;

/** A fetch answer with a JSON body. */
function answer(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob([])),
  });
}

function recordingStatus(overrides: Partial<RecordingStatus> = {}): RecordingStatus {
  return {
    session_id: 'TH-1',
    configured: true,
    provider_consented: false,
    patient_consented: false,
    recording: false,
    your_party: 'patient',
    ...overrides,
  };
}

/** Answer each request by its URL and method. */
function route(handlers: Record<string, () => Promise<unknown>>) {
  mockFetch.mockImplementation((raw: unknown, init?: RequestInit) => {
    const url = String(raw);
    const method = init?.method ?? 'GET';
    const key = Object.keys(handlers).find((k) => {
      const [m, fragment] = k.split(' ');
      return m === method && url.includes(fragment);
    });
    return key ? handlers[key]() : answer(404, { error: 'not found', code: 'NOT_FOUND' });
  });
}

function wrap(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('telehealth recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('says plainly when the clinic has no recorder, with no dead button', async () => {
    route({ 'GET recording-status': () => answer(200, recordingStatus({ configured: false })) });
    wrap(<RecordingControls sessionId="TH-1" />);
    expect(await screen.findByText(/Recording is not set up for this clinic/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets the patient consent for themselves and shows the recording indicator', async () => {
    let current = recordingStatus({ provider_consented: true });
    route({
      'GET recording-status': () => answer(200, current),
      'POST recording-consent': () => {
        current = { ...current, patient_consented: true, recording: true };
        return answer(200, current);
      },
    });
    wrap(<RecordingControls sessionId="TH-1" />);
    expect(await screen.findByText(/Your clinician has consented/i)).toBeInTheDocument();
    // A patient never gets a start button: only their own consent.
    expect(screen.queryByRole('button', { name: /Start recording/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /I consent to recording/i }));
    expect(await screen.findByRole('button', { name: /Withdraw my consent/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Recording/);
    const consentCall = mockFetch.mock.calls.find(([url]) => String(url).includes('recording-consent'));
    expect(JSON.parse(String(consentCall?.[1]?.body))).toEqual({ consent: true });
  });

  it('keeps the clinician from starting until both have consented', async () => {
    route({
      'GET recording-status': () =>
        answer(200, recordingStatus({ your_party: 'provider', provider_consented: true })),
    });
    wrap(<RecordingControls sessionId="TH-1" />);
    expect(await screen.findByText(/Waiting for the patient to consent/i)).toBeInTheDocument();
    expect(screen.getByText(/once you and the patient have both consented/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start recording/i })).not.toBeInTheDocument();
  });

  it('distinguishes an unavailable status from not recording', async () => {
    route({ 'GET recording-status': () => answer(503, { error: 'down', code: 'RECORDING_UNAVAILABLE' }) });
    wrap(<RecordingControls sessionId="TH-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });

  it('lists recordings on request, and says when there are none', async () => {
    route({ 'GET /recordings': () => answer(200, { recordings: [] }) });
    wrap(<TelehealthRecordingList sessionId="TH-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Recordings/i }));
    expect(await screen.findByText(/This consultation was not recorded/i)).toBeInTheDocument();
  });

  it('does not present a failed listing as an empty one', async () => {
    route({ 'GET /recordings': () => answer(503, { error: 'down', code: 'RECORDING_UNAVAILABLE' }) });
    wrap(<TelehealthRecordingList sessionId="TH-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Recordings/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not a confirmation that there are none/i));
  });
});
