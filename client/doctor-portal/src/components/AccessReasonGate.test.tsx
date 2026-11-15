import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider, getApiClient } from '@medichain/shared';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AccessReasonGate, DirectoryReasonGate } from './AccessReasonGate';
import { ReasonPrompt, resetDeclaredAccessForTests } from './ChartAccess';

// The chart is the test's own child, so it is found by test id: asserting its
// text made `check-frontend-test-drift.py` read ten assertions about a string the
// product never renders and classify a passing suite as ORPHANED.
function renderGate(patientId: string | undefined) {
  return render(
    <I18nProvider>
      <AccessReasonGate patientId={patientId}>
        <p data-testid="chart-contents">chart contents</p>
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
    answer(201, { access_context_id: contextId, authority_type: 'care_relationship', expires_at: new Date(Date.now() + 3600000).toISOString() }),
  ) as unknown as typeof fetch;
}

describe('AccessReasonGate', () => {
  beforeEach(() => {
    resetDeclaredAccessForTests();
    getApiClient().setUserId('doctor-session-qa');
    getApiClient().clearTokens();
    serverOpensContexts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not mount the chart, so nothing is read, until a reason is chosen', () => {
    renderGate('PAT-GATE-1');
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
    expect(screen.getByTestId('access-reason-gate')).toBeInTheDocument();
  });

  it('opens a server-issued context, sends it with the chart, and clears it on close', async () => {
    const setContext = vi.spyOn(getApiClient(), 'setPatientAccessContext');
    const { unmount } = renderGate('PAT-GATE-2');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    expect(await screen.findByTestId('chart-contents')).toBeInTheDocument();
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
    await screen.findByTestId('chart-contents');
    expect(setContext).toHaveBeenCalledWith({ patientId: 'PAT-GATE-3', reason: 'Follow-up call', contextId: 'ACX-1' });
  });

  it('does not ask again when returning to a chart in the same tab', async () => {
    const first = renderGate('PAT-GATE-4');
    fireEvent.click(screen.getByRole('button', { name: 'Referral' }));
    await screen.findByTestId('chart-contents');
    first.unmount();
    renderGate('PAT-GATE-4');
    expect(screen.getByTestId('chart-contents')).toBeInTheDocument();
  });

  it('does not reuse a previous login session chart context', async () => {
    getApiClient().setTokens('session-qa-first');
    const first = renderGate('PAT-SESSION-BOUND');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    await screen.findByTestId('chart-contents');
    first.unmount();
    getApiClient().clearTokens();
    getApiClient().setTokens('session-qa-second');
    renderGate('PAT-SESSION-BOUND');
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
    expect(screen.getByTestId('access-reason-gate')).toBeInTheDocument();
  });

  it('does not reuse an expired chart context', async () => {
    const first = renderGate('PAT-EXPIRED-CONTEXT');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    await screen.findByTestId('chart-contents');
    first.unmount();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 13 * 60 * 60 * 1000);
    renderGate('PAT-EXPIRED-CONTEXT');
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
    expect(screen.getByTestId('access-reason-gate')).toBeInTheDocument();
  });

  it('does not reuse another clinician context', async () => {
    const first = renderGate('PAT-OWNER-BOUND');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    await screen.findByTestId('chart-contents');
    first.unmount();
    getApiClient().setUserId('second-doctor-qa');
    renderGate('PAT-OWNER-BOUND');
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
    expect(screen.getByTestId('access-reason-gate')).toBeInTheDocument();
  });

  it('discards a context response when the signed-in clinician changes in flight', async () => {
    let finish!: (value: Awaited<ReturnType<typeof answer>>) => void;
    global.fetch = vi.fn(() => new Promise<Awaited<ReturnType<typeof answer>>>(resolve => { finish = resolve; })) as unknown as typeof fetch;
    renderGate('PAT-LATE-CONTEXT');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    getApiClient().setUserId('second-doctor-qa');
    finish(await answer(201, { access_context_id: 'ACX-LATE', expires_at: new Date(Date.now() + 3600000).toISOString() }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
  });

  it('refuses a context that the server already reports as expired', async () => {
    global.fetch = vi.fn(() => answer(201, { access_context_id: 'ACX-STALE', expires_at: new Date(Date.now() - 1000).toISOString() })) as unknown as typeof fetch;
    renderGate('PAT-STALE-CONTEXT');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
  });

  it('restores the reason before a reopened chart sends its first read', async () => {
    const first = renderGate('PAT-REOPEN');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    await screen.findByTestId('chart-contents');
    first.unmount();
    const setContext = vi.spyOn(getApiClient(), 'setPatientAccessContext');
    const firstRead = vi.fn();
    function ReadingChart() {
      useEffect(() => { firstRead(); }, []);
      return <p>reopened chart</p>;
    }
    render(<I18nProvider><AccessReasonGate patientId="PAT-REOPEN"><ReadingChart /></AccessReasonGate></I18nProvider>);
    expect(setContext).toHaveBeenCalledWith({ patientId: 'PAT-REOPEN', reason: 'treatment', contextId: 'ACX-1' });
    expect(setContext.mock.invocationCallOrder[0]).toBeLessThan(firstRead.mock.invocationCallOrder[0]);
  });
  it('offers break-glass when the server finds no care relationship', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      answer(403, { error: 'No care relationship', code: 'CARE_RELATIONSHIP_REQUIRED', break_glass_available: true }),
    ) as unknown as typeof fetch;
    renderGate('PAT-GATE-5');
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    expect(await screen.findByRole('button', { name: /Break the glass/i })).toBeInTheDocument();
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
  });

  it('requests normal patient approval without mounting the chart or using break-glass', async () => {
    let approved = false;
    global.fetch = vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes('/api/access/patient/PAT-NORMAL/requests')) {
        return answer(201, { request: { id: 'REQ-QA', status: 'pending' } });
      }
      return approved ? answer(201, { access_context_id: 'ACX-APPROVED', expires_at: new Date(Date.now() + 3600000).toISOString() })
        : answer(403, { error: 'No care relationship', code: 'CARE_RELATIONSHIP_REQUIRED' });
    }) as unknown as typeof fetch;
    renderGate('PAT-NORMAL');
    fireEvent.click(screen.getByRole('button', { name: 'Referral' }));
    // Asking the patient is the folded, non-emergency path below break-glass.
    fireEvent.click(await screen.findByText(/Not an emergency?/));
    const reason = await screen.findByLabelText('Reason for chart access');
    fireEvent.change(reason, { target: { value: 'Synthetic normal consent test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request chart access' }));
    expect(await screen.findByText(/Request sent/)).toBeVisible();
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
    approved = true;
    fireEvent.click(screen.getByRole('button', { name: 'Check chart access' }));
    expect(await screen.findByTestId('chart-contents')).toBeInTheDocument();
    expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('break-glass'))).toBe(false);
  });

  it('keeps the chart closed and says so when the context cannot be opened', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      answer(503, { error: 'Access to this chart cannot be checked right now.', code: 'ACCESS_CHECK_UNAVAILABLE' }),
    ) as unknown as typeof fetch;
    renderGate('PAT-GATE-6');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/cannot be checked/i);
    expect(screen.queryByTestId('chart-contents')).not.toBeInTheDocument();
  });
});

describe('DirectoryReasonGate', () => {
  it('opens portal navigation without a reason popup and keeps directory auditing', async () => {
    const setPurpose = vi.spyOn(getApiClient(), 'setDirectoryPurpose');
    const { unmount } = render(
      <I18nProvider><DirectoryReasonGate><p data-testid="directory-callers">directory callers</p></DirectoryReasonGate></I18nProvider>,
    );
    expect(await screen.findByTestId('directory-callers')).toBeInTheDocument();
    expect(screen.queryByTestId('access-reason-gate')).not.toBeInTheDocument();
    expect(setPurpose).toHaveBeenCalledWith('Patient directory lookup');
    unmount();
    expect(setPurpose).toHaveBeenLastCalledWith(undefined);
    vi.restoreAllMocks();
  });

  it('sends an honest workflow label with a directory request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [], total: 0 }),
    });
    const { unmount } = render(
      <I18nProvider><DirectoryReasonGate><p data-testid="directory-callers">directory callers</p></DirectoryReasonGate></I18nProvider>,
    );
    await screen.findByTestId('directory-callers');
    await getApiClient().get('/api/patients?q=Smith');
    const options = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    expect((options.headers as Record<string, string>)['X-Access-Reason']).toBe('Patient directory lookup');
    unmount();
  });
});



describe('chart reason inside a clinical form', () => {
  it('Continue and Enter declare a reason without submitting the surrounding form', () => {
    const declare = vi.fn();
    const submit = vi.fn(event => event.preventDefault());
    const view = render(<I18nProvider><form onSubmit={submit}>
      <ReasonPrompt title="QA purpose" onDeclare={declare} />
    </form></I18nProvider>);
    const reason = screen.getByLabelText('Another reason');
    fireEvent.change(reason, { target: { value: 'Synthetic QA only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.keyDown(reason, { key: 'Enter' });
    expect(declare).toHaveBeenCalledTimes(2);
    expect(declare).toHaveBeenCalledWith('Synthetic QA only');
    expect(submit).not.toHaveBeenCalled();
    expect(view.container.querySelectorAll('form')).toHaveLength(1);
  });
});
