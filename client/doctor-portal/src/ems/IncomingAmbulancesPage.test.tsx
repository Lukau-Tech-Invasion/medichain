/**
 * The incoming board (mockup c8): the ambulance at the door comes first and
 * carries the one big button; one still on its way can be received, quietly.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import { I18nProvider } from '@medichain/shared';
import type { EmsRunWithEvents } from '@medichain/shared';
import IncomingAmbulancesPage, { boardOrder } from './IncomingAmbulancesPage';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listIncomingEmsRuns: vi.fn(),
}));
vi.mock('../components/PatientSelect', () => ({ findDirectoryPatient: () => Promise.resolve(null) }));

function run(id: string, status: 'en_route' | 'arrived', extra: Partial<EmsRunWithEvents> = {}): EmsRunWithEvents {
  return {
    id, status, created_by: 'medic', crew: [], created_at: '2026-11-08T14:00:00Z', updated_at: '2026-11-08T14:30:00Z',
    unidentified_description: `Patient ${id}`, events: [], ...extra,
  } as EmsRunWithEvents;
}

describe('incoming board', () => {
  it('puts ambulances at the door first, then the rest by arrival time', () => {
    const order = boardOrder([
      run('late', 'en_route', { eta: '2026-11-08T15:00:00Z' }),
      run('no-eta', 'en_route'),
      run('door', 'arrived'),
      run('soon', 'en_route', { eta: '2026-11-08T14:40:00Z' }),
    ]).map((r) => r.id);
    expect(order).toEqual(['door', 'soon', 'late', 'no-eta']);
  });

  it('gives the arrived patient the main button and the one on its way a quiet one', async () => {
    vi.mocked(shared.listIncomingEmsRuns).mockResolvedValue({
      facility_id: 'F1',
      runs: [run('road', 'en_route', { eta: '2026-11-08T15:00:00Z' }), run('door', 'arrived')],
    });
    render(<I18nProvider><MemoryRouter><IncomingAmbulancesPage /></MemoryRouter></I18nProvider>);
    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]).getByRole('heading')).toHaveTextContent('Patient door');
    expect(within(cards[0]).getByRole('button', { name: 'Received' })).toBeInTheDocument();
    expect(within(cards[1]).getByRole('button', { name: 'Received early' })).toBeInTheDocument();
  });
});
