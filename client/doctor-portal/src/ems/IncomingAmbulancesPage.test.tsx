/**
 * The incoming board (mockup c8): the ambulance at the door comes first and
 * carries the one big button; one still on its way can be received, quietly.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
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
const directory = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));
vi.mock('../components/PatientSelect', () => ({
  findDirectoryPatient: (id: string) => Promise.resolve(directory.rows.get(id) ?? null),
}));

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

  it('says who an identified patient is, and who brought them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T14:40:00Z'));
    directory.rows.set('P1', {
      patient_id: 'P1', full_name: 'Thandiwe Ndlovu', date_of_birth: '1992-03-12', health_id: 'MCHI-48217703', gender: 'Female',
    });
    vi.mocked(shared.listIncomingEmsRuns).mockResolvedValue({
      facility_id: 'F1',
      runs: [run('door', 'arrived', {
        patient_id: 'P1', unidentified_description: null, unit_number: '14', crew: ['P. Mokoena'],
        events: [
          { id: 'e1', run_id: 'door', kind: 'dispatched', occurred_at: '2026-11-08T14:02:00Z', payload: null },
          { id: 'e2', run_id: 'door', kind: 'treatment', occurred_at: '2026-11-08T14:13:00Z', payload: { name: 'Splint left forearm' } },
        ],
      } as Partial<EmsRunWithEvents>)],
    });
    render(<I18nProvider><MemoryRouter><IncomingAmbulancesPage /></MemoryRouter></I18nProvider>);
    const card = (await screen.findAllByRole('listitem'))[0];
    expect(await within(card).findByRole('heading', { name: 'Thandiwe Ndlovu' })).toBeInTheDocument();
    expect(card).toHaveTextContent(/Female · 34 years · born .* · Health ID MCHI-48217703 · Unit 14 \(P\. Mokoena\)/);
    expect(within(card).getByText('34 years · Female')).toBeInTheDocument();
    vi.useRealTimers();

    const toggle = within(card).getByRole('button', { name: 'Full timeline (2 entries)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const entries = within(card).getAllByRole('listitem').map((li) => li.textContent);
    expect(entries[0]).toMatch(/Dispatched/);
    expect(entries[1]).toMatch(/Treatment · Splint left forearm/);
  });

  it("shows the pre-alerts, allergies, blood group and the server's trend", async () => {
    vi.mocked(shared.listIncomingEmsRuns).mockResolvedValue({
      facility_id: 'F1',
      runs: [{
        ...run('door', 'arrived', {
          patient_id: 'P9', alerts: ['stemi'],
          events: [
            { id: 'v1', run_id: 'door', kind: 'vitals', occurred_at: '2026-11-08T14:12:00Z', recorded_by: 'm', payload: { heart_rate: 118 } },
            { id: 'v2', run_id: 'door', kind: 'vitals', occurred_at: '2026-11-08T14:24:00Z', recorded_by: 'm', payload: { heart_rate: 106 } },
          ],
        } as Partial<EmsRunWithEvents>),
        emergency: { allergies: [{ name: 'Penicillin', severity: 'Severe' }, { name: 'Latex', severity: 'Mild' }], blood_type: 'O+' },
        vitals_trend: {
          direction: 'improving', heart_rate: 'better', systolic_bp: null, spo2: null, gcs: null,
          respiratory_rate: null, temperature: null, parameters_compared: 1,
        },
      }],
    });
    render(<I18nProvider><MemoryRouter><IncomingAmbulancesPage /></MemoryRouter></I18nProvider>);
    const card = (await screen.findAllByRole('listitem'))[0];
    expect(within(card).getByText('STEMI alert')).toBeInTheDocument();
    expect(card).toHaveTextContent('Penicillin · Latex');
    expect(within(card).getByText('Blood O+')).toBeInTheDocument();
    expect(within(card).getByText('Improving since the first reading')).toBeInTheDocument();
    // The arrow is on the latest heart rate, coloured by the server's verdict.
    expect(within(card).getByText('▼').parentElement).toHaveClass('text-ok');
    expect(card).toHaveTextContent('106▼ better');
  });

  it('says there is no trend from one set of readings, rather than none', async () => {
    vi.mocked(shared.listIncomingEmsRuns).mockResolvedValue({
      facility_id: 'F1',
      runs: [{ ...run('road', 'en_route', {
        events: [{ id: 'v1', run_id: 'road', kind: 'vitals', occurred_at: '2026-11-08T14:12:00Z', recorded_by: 'm', payload: { heart_rate: 98 } }],
      } as Partial<EmsRunWithEvents>), vitals_trend: null, emergency: null }],
    });
    render(<I18nProvider><MemoryRouter><IncomingAmbulancesPage /></MemoryRouter></I18nProvider>);
    const card = (await screen.findAllByRole('listitem'))[0];
    expect(within(card).getByText('One set of readings — no trend yet')).toBeInTheDocument();
    expect(within(card).queryByText(/allergies recorded/)).not.toBeInTheDocument();
  });

  it('marks a patient nobody has identified yet, and records nothing about them', async () => {
    vi.mocked(shared.listIncomingEmsRuns).mockResolvedValue({
      facility_id: 'F1',
      runs: [run('road', 'en_route', { unidentified_description: 'Unknown man, about 40', unit_number: '22' })],
    });
    render(<I18nProvider><MemoryRouter><IncomingAmbulancesPage /></MemoryRouter></I18nProvider>);
    const card = (await screen.findAllByRole('listitem'))[0];
    expect(within(card).getByText('?')).toBeInTheDocument();
    expect(card).toHaveTextContent(/Unit 22 · not yet identified — will link when scanned or registered/);
    // No entries: no timeline link promising some.
    expect(within(card).queryByRole('button', { name: /Full timeline/ })).not.toBeInTheDocument();
  });

  it('moves only an ambulance that arrives after the board opened (c10, once)', async () => {
    vi.mocked(shared.listIncomingEmsRuns).mockResolvedValue({ facility_id: 'F1', runs: [run('first', 'arrived')] });
    render(<I18nProvider><MemoryRouter><IncomingAmbulancesPage /></MemoryRouter></I18nProvider>);
    const [opened] = await screen.findAllByRole('listitem');
    expect(opened.className).not.toContain('mc-slide-in');

    vi.mocked(shared.listIncomingEmsRuns).mockResolvedValue({
      facility_id: 'F1', runs: [run('first', 'arrived'), run('next', 'en_route', { eta: '2026-11-08T15:00:00Z' })],
    });
    window.dispatchEvent(new Event('focus'));
    const next = (await screen.findByRole('heading', { name: 'Patient next' })).closest('li')!;
    expect(next.className).toContain('mc-slide-in');
    expect(screen.getByRole('heading', { name: 'Patient first' }).closest('li')!.className).not.toContain('mc-slide-in');
  });
});
