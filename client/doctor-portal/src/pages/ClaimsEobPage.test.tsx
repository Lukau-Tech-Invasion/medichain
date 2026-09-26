import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ClaimsEobPage from './ClaimsEobPage';

// The patient picker has its own tests; here it is a plain input so the page's
// own states can be driven directly.
vi.mock('../components/PatientSelect', () => ({
  default: ({ value, onChange, label }: { value: string; onChange: (id: string) => void; label?: string }) => (
    <label>
      {label}
      <input aria-label="patient id" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
}));

// The page calls the shared API client, so the network edge is mocked.
const mockFetch = vi.fn();
global.fetch = mockFetch;

function answer(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });
}

const CLAIM = {
  claim_id: 'CLM-1',
  service_date: '2026-09-01',
  status: 'Paid',
  insurance: { payer_name: 'Synthetic Medical Aid' },
  eob_documents: [],
};

function renderPage() {
  render(
    <I18nProvider>
      <ClaimsEobPage />
    </I18nProvider>,
  );
}

function choosePatient() {
  fireEvent.change(screen.getByLabelText('patient id'), { target: { value: 'PAT-001' } });
}

describe('ClaimsEobPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('asks for a patient before loading anything', () => {
    renderPage();
    expect(screen.getByText(/Choose a patient/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lists the patient's claims with an honest EOB state", async () => {
    mockFetch.mockImplementation(() => answer(200, { success: true, claims: [CLAIM], count: 1 }));
    renderPage();
    choosePatient();
    expect(await screen.findByText('Synthetic Medical Aid')).toBeInTheDocument();
    expect(screen.getByText('No EOB received yet')).toBeInTheDocument();
  });

  it('files an EOB and shows it on the claim', async () => {
    mockFetch
      .mockImplementationOnce(() => answer(200, { success: true, claims: [CLAIM], count: 1 }))
      .mockImplementationOnce(() =>
        answer(201, {
          success: true,
          document: {
            id: 'EOB-1', claim_id: 'CLM-1', filename: 'eob.pdf', content_type: 'application/pdf',
            size_bytes: 2048, scan_status: 'clean', created_at: '2026-09-26T10:00:00Z',
          },
        }),
      );
    renderPage();
    choosePatient();
    const input = await screen.findByLabelText(/EOB file/i);
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'eob.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: /File EOB/i }));
    expect(await screen.findByRole('button', { name: /eob.pdf/i })).toBeInTheDocument();
    expect(screen.queryByText('No EOB received yet')).not.toBeInTheDocument();
  });

  it('refuses a file type before sending it', async () => {
    mockFetch.mockImplementation(() => answer(200, { success: true, claims: [CLAIM], count: 1 }));
    renderPage();
    choosePatient();
    const input = await screen.findByLabelText(/EOB file/i);
    fireEvent.change(input, { target: { files: [new File(['x'], 'eob.docx', { type: 'application/msword' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/not a PDF, JPEG or PNG/i);
    expect(screen.getByRole('button', { name: /File EOB/i })).toBeDisabled();
  });

  it('reports a failed load as an error, not as "no claims"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch.mockImplementation(() => answer(403, { error: { code: 'FORBIDDEN', message: 'Access denied' } }));
    renderPage();
    choosePatient();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByText(/no insurance claims/i)).not.toBeInTheDocument();
  });
});
