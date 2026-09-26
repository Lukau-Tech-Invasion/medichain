import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, getApiClient } from '@medichain/shared';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AccessReasonGate, DirectoryReasonGate } from './AccessReasonGate';
import { resetDeclaredAccessForTests } from './ChartAccess';

function renderGate(patientId: string | undefined) {
  return render(
    <I18nProvider>
      <AccessReasonGate patientId={patientId}>
        <p>chart contents</p>
      </AccessReasonGate>
    </I18nProvider>,
  );
}

/** A fetch answer with a JSON body. */
function answer(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });
}

/** Answer the access-context POST the way the server does for an authorised clinician. */
function serverOpensContexts(contextId = 'ACX-1') {
  global.fetch = vi.fn().mockImplementation(() =>
    answer(201, { access_context_id: contextId, authority_type: 'care_relationship', expires_at: '2026-09-26T20:00:00Z' }),
  ) as typeof fetch;
}

describe('AccessReasonGate', () => {
  beforeEach(() => {
    resetDeclaredAccessForTests();
    serverOpensContexts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not mount the chart, so nothing is read, until a reason is chosen', () => {
    renderGate('PAT-GATE-1');
    expect(screen.queryByText('chart contents')).not.toBeInTheDocument();
    expect(screen.getByTestId('access-reason-gate')).toBeInTheDocument();
  });

  it('opens a server-issued context, sends it with the chart, and clears it on close', async () => {
    const setContext = vi.spyOn(getApiClient(), 'setPatientAccessContext');
    const { unmount } = renderGate('PAT-GATE-2');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    expect(await screen.findByText('chart contents')).toBeInTheDocument();
    expect(setContext).toHaveBeenCalledWith({ patientId: 'PAT-GATE-2', reason: 'treatment', contextId: 'ACX-1' });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain('/api/patients/PAT-GATE-2/access-context');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ reason: 'treatment' });
    unmount();
    expect(setContext).toHaveBeenLastCalledWith(undefined);
  });

  it('accepts a short free-text reason', async () => {
    const setContext = vi.spyOn(getApiClient(), 'setPatientAccessContext');
    renderGate('PAT-GATE-3');
    fireEvent.change(screen.getByLabelText('Another reason'), { target: { value: '  Follow-up call  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('chart contents');
    expect(setContext).toHaveBeenCalledWith({ patientId: 'PAT-GATE-3', reason: 'Follow-up call', contextId: 'ACX-1' });
  });

  it('does not ask again when returning to a chart in the same tab', async () => {
    const first = renderGate('PAT-GATE-4');
    fireEvent.click(screen.getByRole('button', { name: 'Referral' }));
    await screen.findByText('chart contents');
    first.unmount();
    renderGate('PAT-GATE-4');
    expect(screen.getByText('chart contents')).toBeInTheDocument();
  });

  it('offers break-glass when the server finds no care relationship', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      answer(403, { error: 'No care relationship', code: 'CARE_RELATIONSHIP_REQUIRED', break_glass_available: true }),
    ) as typeof fetch;
    renderGate('PAT-GATE-5');
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    expect(await screen.findByRole('button', { name: /Break the glass/i })).toBeInTheDocument();
    expect(screen.queryByText('chart contents')).not.toBeInTheDocument();
  });

  it('keeps the chart closed and says so when the context cannot be opened', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      answer(503, { error: 'Access to this chart cannot be checked right now.', code: 'ACCESS_CHECK_UNAVAILABLE' }),
    ) as typeof fetch;
    renderGate('PAT-GATE-6');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/cannot be checked/i);
    expect(screen.queryByText('chart contents')).not.toBeInTheDocument();
  });
});

describe('DirectoryReasonGate', () => {
  it('does not mount directory callers before a purpose is declared', () => {
    const setPurpose = vi.spyOn(getApiClient(), 'setDirectoryPurpose');
    const { unmount } = render(
      <I18nProvider><DirectoryReasonGate><p>directory callers</p></DirectoryReasonGate></I18nProvider>,
    );
    expect(screen.queryByText('directory callers')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    expect(screen.getByText('directory callers')).toBeInTheDocument();
    expect(setPurpose).toHaveBeenCalledWith('treatment');
    unmount();
    expect(setPurpose).toHaveBeenLastCalledWith(undefined);
    vi.restoreAllMocks();
  });

  it('sends the declared purpose with a directory request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [], total: 0 }),
    });
    const { unmount } = render(
      <I18nProvider><DirectoryReasonGate><p>directory callers</p></DirectoryReasonGate></I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Referral' }));
    await getApiClient().get('/api/patients?q=Smith');
    const options = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    expect((options.headers as Record<string, string>)['X-Access-Reason']).toBe('referral');
    unmount();
  });
});
