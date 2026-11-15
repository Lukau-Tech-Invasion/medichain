/**
 * Which triage readings are critical comes from the server's catalogue
 * (rule 8). The page's own copy disagreed with it on four of six limits: an
 * SpO2 of 91 raised a server alert and no warning here.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import TriagePage from './TriagePage';
import { useAuthStore } from '../store';

vi.mock('../store', () => ({ useAuthStore: vi.fn() }));
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScoringCatalog: vi.fn(),
  getPatients: vi.fn().mockResolvedValue([]),
  getTriageQueue: vi.fn().mockResolvedValue([]),
}));

const band = (key: string, critical_low: number | null, critical_high: number | null) => ({
  key, normal_low: null, normal_high: null, critical_low, critical_high,
});

function renderWith(catalog: shared.ScoringCatalog | null) {
  vi.mocked(shared.useScoringCatalog).mockReturnValue({ catalog, isLoading: false, error: null });
  return render(<MemoryRouter><TriagePage /></MemoryRouter>);
}

describe('triage critical vitals', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'nurse-1', role: 'Nurse' }, isAuthenticated: true });
  });

  it('flags a reading the server calls critical, using the server’s limit', () => {
    renderWith({ vital_signs: [band('oxygen_saturation', 92, null)] } as shared.ScoringCatalog);
    expect(screen.queryByText('Critical Values Detected')).toBeNull();
    fireEvent.change(document.getElementById('triage-oxygen-saturation')!, { target: { value: '91' } });
    expect(screen.getByText('Critical Values Detected')).toBeTruthy();
  });

  it('claims nothing without a catalogue, rather than guessing', () => {
    renderWith(null);
    fireEvent.change(document.getElementById('triage-oxygen-saturation')!, { target: { value: '60' } });
    expect(screen.queryByText('Critical Values Detected')).toBeNull();
  });
});
