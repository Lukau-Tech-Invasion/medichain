import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BurnPage from './BurnPage';
import { patientProfile } from '../test/fixtures';
import * as shared from '@medichain/shared';

// The chart is served by `GET /api/clinical/scoring/catalog`, so these tests
// have to supply it. That is the point of the change they cover: the region set
// and the per-age region sizes are clinical protocol and no longer live in the
// component. A page with no catalog renders no chart, deliberately — a burn
// chart with no region sizes is not a burn chart.
//
// Only the three regions the assertions need, with real Lund-Browder numbers.
const CATALOG = {
  burn: {
    lund_browder: {
      age_bands: [0, 1, 5, 10, 15, 18],
      age_band_labels: [
        'under 1 year',
        '1 to 4 years',
        '5 to 9 years',
        '10 to 14 years',
        '15 to 17 years',
        '18 years and over',
      ],
      regions: [
        { id: 'head', name: 'Head', percent_by_age_band: [19, 17, 13, 11, 9, 7] },
        { id: 'neck', name: 'Neck', percent_by_age_band: [2, 2, 2, 2, 2, 2] },
        {
          id: 'right_forearm',
          name: 'Right forearm',
          percent_by_age_band: [3, 3, 3, 3, 3, 3],
        },
      ],
    },
    parkland_ml_per_kg_per_percent: 4,
    urine_target_ml_kg_hr: 0.5,
    first_block_fraction: 0.5,
    first_block_hours: 8,
    second_block_hours: 16,
    severity: {
      major_tbsa_percent: 25,
      moderate_tbsa_percent: 10,
      major_regardless_of_tbsa: ['inhalation_injury', 'circumferential_burn'],
    },
  },
};

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  createBurn: vi.fn(),
  useScoringCatalog: vi.fn(),
}));

/** An adult and a five-year-old, so the age band can be seen to matter. */
const ADULT = patientProfile({
  patient_id: 'PAT-ADULT',
  full_name: 'Adult Patient',
  date_of_birth: '1980-01-01',
});
const CHILD = patientProfile({
  patient_id: 'PAT-CHILD',
  full_name: 'Child Patient',
  date_of_birth: '2021-01-01',
});

function renderPage() {
  return render(
    <MemoryRouter>
      <BurnPage />
    </MemoryRouter>,
  );
}

/** Pick a patient from the roster by name. */
async function selectPatient(name: string) {
  const row = await screen.findByText(name);
  fireEvent.click(row);
}

describe('BurnPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `getPatients` resolves to the bare array: ApiClient unwraps the list
    // envelope. See the api-client-unwraps-list-envelopes note.
    vi.mocked(shared.getPatients).mockResolvedValue([ADULT, CHILD] as never);
    vi.mocked(shared.useScoringCatalog).mockReturnValue({
      catalog: CATALOG as never,
      isLoading: false,
      error: null,
    });
  });

  it('renders the burn page against the Lund-Browder chart', () => {
    renderPage();

    expect(screen.getByText(/Burn Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Lund-Browder Chart & Parkland Formula/i)).toBeInTheDocument();
  });

  it('renders the body chart from the catalog rather than its own region list', async () => {
    renderPage();
    await selectPatient('Adult Patient');

    // The regions come from the served chart. `Right forearm` in particular is
    // a Lund-Browder region: Rule of 9s charts a whole arm as one 9% block and
    // has no forearm at all.
    expect(await screen.findByText('Right forearm')).toBeInTheDocument();
    expect(screen.getByText('Head')).toBeInTheDocument();
    expect(screen.getByText('Neck')).toBeInTheDocument();
  });

  it("sizes the head from the patient's age, not from a checkbox", async () => {
    renderPage();
    await selectPatient('Child Patient');

    // A five-year-old's head is 13% of body surface. An adult's is 7%. The
    // chart this replaced offered one `isChild` toggle, which cannot express a
    // proportion that moves at five points before adulthood — and TBSA is what
    // the Parkland volume is computed from.
    await waitFor(() => {
      expect(screen.getByText(/5 to 9 years/)).toBeInTheDocument();
    });
    expect(screen.getByText('13% of body')).toBeInTheDocument();
  });

  it('charts a share of the region and shows what it adds to TBSA', async () => {
    const { container } = renderPage();
    await selectPatient('Adult Patient');

    await waitFor(() => {
      expect(container.querySelector('#burn-percent-head')).toBeInTheDocument();
    });

    // Half an adult head. 7% x 50% = 3.5% TBSA — the multiplication the
    // clinician used to have to do in their head.
    const percent = container.querySelector('#burn-percent-head') as HTMLInputElement;
    fireEvent.change(percent, { target: { value: '50' } });

    expect(await screen.findByText(/Adds 3.5% TBSA/)).toBeInTheDocument();
  });

  it('disables the depth selector until the region has a burned area', async () => {
    const { container } = renderPage();
    await selectPatient('Adult Patient');

    await waitFor(() => {
      expect(container.querySelector('#burn-depth-head')).toBeInTheDocument();
    });

    // A depth with no area is not a meaningful entry. The product uses ABA
    // depth terms (superficial / partial / full thickness), not "degree".
    const depth = container.querySelector('#burn-depth-head') as HTMLSelectElement;
    expect(depth).toBeDisabled();

    const percent = container.querySelector('#burn-percent-head') as HTMLInputElement;
    fireEvent.change(percent, { target: { value: '25' } });

    expect(depth).not.toBeDisabled();
    fireEvent.change(depth, { target: { value: 'full-thickness' } });
    expect(depth).toHaveValue('full-thickness');
  });

  it('refuses to chart a patient whose date of birth is unknown', async () => {
    vi.mocked(shared.getPatients).mockResolvedValue([
      patientProfile({ patient_id: 'PAT-NODOB', full_name: 'No Birthday', date_of_birth: '' }),
    ] as never);

    const { container } = renderPage();
    await selectPatient('No Birthday');

    // There is no safe default column. The adult chart puts an infant's head at
    // 7% when it is 19%, so the inputs stay disabled and the page says why.
    await waitFor(() => {
      expect(screen.getByText(/date of birth is needed/i)).toBeInTheDocument();
    });
    const percent = container.querySelector('#burn-percent-head') as HTMLInputElement;
    expect(percent).toBeDisabled();
  });
});
