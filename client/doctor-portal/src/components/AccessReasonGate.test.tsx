import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, getApiClient } from '@medichain/shared';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AccessReasonGate, DirectoryReasonGate } from './AccessReasonGate';

function renderGate(patientId: string | undefined) {
  return render(
    <I18nProvider>
      <AccessReasonGate patientId={patientId}>
        <p>chart contents</p>
      </AccessReasonGate>
    </I18nProvider>,
  );
}

describe('AccessReasonGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not mount the chart, so nothing is read, until a reason is chosen', () => {
    renderGate('PAT-GATE-1');
    expect(screen.queryByText('chart contents')).not.toBeInTheDocument();
    expect(screen.getByTestId('access-reason-gate')).toBeInTheDocument();
  });

  it('sends the chosen reason with the chart and clears it when the chart closes', () => {
    const setContext = vi.spyOn(getApiClient(), 'setPatientAccessContext');
    const { unmount } = renderGate('PAT-GATE-2');
    fireEvent.click(screen.getByRole('button', { name: 'Treatment' }));
    expect(screen.getByText('chart contents')).toBeInTheDocument();
    expect(setContext).toHaveBeenCalledWith({ patientId: 'PAT-GATE-2', reason: 'treatment' });
    unmount();
    expect(setContext).toHaveBeenLastCalledWith(undefined);
  });

  it('accepts a short free-text reason', () => {
    const setContext = vi.spyOn(getApiClient(), 'setPatientAccessContext');
    renderGate('PAT-GATE-3');
    fireEvent.change(screen.getByLabelText('Another reason'), { target: { value: '  Follow-up call  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(setContext).toHaveBeenCalledWith({ patientId: 'PAT-GATE-3', reason: 'Follow-up call' });
  });

  it('does not ask again when returning to a chart in the same tab', () => {
    const first = renderGate('PAT-GATE-4');
    fireEvent.click(screen.getByRole('button', { name: 'Referral' }));
    first.unmount();
    renderGate('PAT-GATE-4');
    expect(screen.getByText('chart contents')).toBeInTheDocument();
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
