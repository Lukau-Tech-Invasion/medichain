import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LabResultsPage from './LabResultsPage';
import { useAuthStore } from '../store';

// Its own file: StaffName caches the staff directory per module, so the
// directory this test serves must be the first one the module sees.
vi.mock('../store', () => ({ useAuthStore: vi.fn() }));

const SUBMITTER = '00dd8ee7-5c1f-4c2e-9a5b-0d3b1f6a2e11';
const json = (body: unknown) => Promise.resolve({
  ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
});

describe('LabResultsPage review queue', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'DOC-001' } });
    global.fetch = vi.fn((url: string) => String(url).includes('/api/providers')
      ? json({ success: true, count: 1, providers: [{ user_id: SUBMITTER, name: 'Thabo Mokoena', role: 'LabTechnician' }] })
      : json([{
        id: 'LAB-001', patient_id: 'PAT-001', patient_name: 'John Doe', test_name: 'CBC',
        test_category: 'Hematology', results: [], submitted_by: SUBMITTER,
        submitted_at: new Date().toISOString(), status: 'Pending',
      }])) as unknown as typeof fetch;
  });

  it('names who submitted a result, not their account id', async () => {
    render(<MemoryRouter><LabResultsPage /></MemoryRouter>);
    expect(await screen.findByText('Thabo Mokoena')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(SUBMITTER))).not.toBeInTheDocument();
  });
});
