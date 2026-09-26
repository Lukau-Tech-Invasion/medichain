import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ResearchExportsPage from './ResearchExportsPage';
import { useAuthStore } from '../store/authStore';

vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

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

function run(overrides: Record<string, unknown>) {
  return {
    id: 'REX-1', purpose: 'Hypertension prevalence study for the province', proposed_by: 'admin_a',
    status: 'proposed', required_approvals: 2, approved_by: [], consent_version: 'research-consent-v1',
    created_at: '2026-09-26T10:00:00Z', ...overrides,
  };
}

function renderAs(wallet: string) {
  vi.mocked(useAuthStore).mockReturnValue({ user: { walletAddress: wallet } } as unknown as ReturnType<typeof useAuthStore>);
  render(<I18nProvider><ResearchExportsPage /></I18nProvider>);
}

describe('ResearchExportsPage', () => {
  beforeEach(() => mockFetch.mockReset());

  it('says when exports cannot run for want of a pseudonymisation key', async () => {
    mockFetch.mockImplementation(() => answer(200, { success: true, exports: [], configured: false }));
    renderAs('admin_a');
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument();
    expect(screen.getByText(/No exports have been proposed/i)).toBeInTheDocument();
  });

  it('does not offer the proposer an approve button on their own export', async () => {
    mockFetch.mockImplementation(() => answer(200, { success: true, exports: [run({})], configured: true }));
    renderAs('admin_a');
    expect(await screen.findByText(/two other administrators must approve/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).not.toBeInTheDocument();
  });

  it('runs an approved export and offers the released records once', async () => {
    mockFetch.mockImplementation((raw: unknown) =>
      String(raw).includes('/execute')
        ? answer(200, {
            success: true,
            export: run({ status: 'executed', included_count: 5, withheld_count: 1 }),
            records: [{ pseudonym: 'R-1', age_band: '40-49', sex: 'female', conditions: ['hypertension'] }],
          })
        : answer(200, { success: true, exports: [run({ status: 'approved', approved_by: ['b', 'c'] })], configured: true }),
    );
    renderAs('admin_b');
    fireEvent.click(await screen.findByRole('button', { name: /Run export/i }));
    expect(await screen.findByRole('button', { name: /Download the 1 released records/i })).toBeInTheDocument();
  });

  it('keeps the propose button disabled until a real purpose is written', async () => {
    mockFetch.mockImplementation(() => answer(200, { success: true, exports: [], configured: true }));
    renderAs('admin_a');
    const purpose = await screen.findByLabelText(/Purpose and recipient/i);
    fireEvent.change(purpose, { target: { value: 'study' } });
    expect(screen.getByRole('button', { name: /Propose export/i })).toBeDisabled();
    fireEvent.change(purpose, { target: { value: 'Hypertension prevalence study for the province' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Propose export/i })).toBeEnabled());
  });
});
