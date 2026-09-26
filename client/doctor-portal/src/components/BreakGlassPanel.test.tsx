import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BreakGlassPanel, I18nProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// The panel calls the shared API client, so the network edge is mocked.
const mockFetch = vi.fn();
global.fetch = mockFetch;

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

function renderPanel(onOpened = vi.fn()) {
  render(
    <I18nProvider>
      <BreakGlassPanel patientId="PAT-1" onOpened={onOpened} />
    </I18nProvider>,
  );
  return onOpened;
}

describe('BreakGlassPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('needs a real reason before the glass can be broken', () => {
    renderPanel();
    const submit = screen.getByRole('button', { name: /Break the glass/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why do you need this chart now/i), { target: { value: 'urgent' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why do you need this chart now/i), {
      target: { value: 'Unconscious in resus, no history available' },
    });
    expect(submit).toBeEnabled();
  });

  it('sends the reason and opens the chart once access is recorded', async () => {
    mockFetch.mockImplementation(() => answer(201, { success: true, grant_id: 'BG-1', expires_at: '2026-09-26T13:00:00Z' }));
    const onOpened = renderPanel();
    fireEvent.change(screen.getByLabelText(/Why do you need this chart now/i), {
      target: { value: 'Unconscious in resus, no history available' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Break the glass/i }));
    await waitFor(() => expect(onOpened).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/patients/PAT-1/break-glass');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'Unconscious in resus, no history available' });
  });

  it('keeps the chart closed and says so when access cannot be recorded', async () => {
    mockFetch.mockImplementation(() =>
      answer(503, { error: 'Emergency access could not be recorded. Please try again.', code: 'BREAK_GLASS_UNAVAILABLE' }),
    );
    const onOpened = renderPanel();
    fireEvent.change(screen.getByLabelText(/Why do you need this chart now/i), {
      target: { value: 'Unconscious in resus, no history available' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Break the glass/i }));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/could not be recorded/i);
    expect(onOpened).not.toHaveBeenCalled();
  });
});
