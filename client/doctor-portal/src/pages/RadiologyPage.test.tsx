import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import RadiologyPage, { toRadiologyStudy } from './RadiologyPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('RadiologyPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Radiologist',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    // One blanket response is not enough: the page loads patients and
    // radiology orders in the same Promise.all, so handing the patients call a
    // radiology payload rejects the pair and the page renders its error state.
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ patients: [] }),
        });
      }
      // listRadiology() GETs /api/platform/list/radiology-orders and wraps the
      // raw array as `orders.items`, so the endpoint must answer with the array
      // itself — not an `{ studies: [...] }` envelope, which nothing unwraps.
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve([
          {
            order_id: 'r1',
            accession_number: 'ACC-0001',
            patient_id: 'PAT-001',
            patient_name: 'Jane Doe',
            modality: 'XR',
            study_description: 'Chest X-Ray',
            study_date: new Date().toISOString(),
            referring_physician: 'Dr. Smith',
            status: 'final',
            priority: 'routine',
            num_images: 2,
          },
        ]),
      });
    });
  });

  it('renders radiology page', async () => {
    render(
      <MemoryRouter>
        <RadiologyPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Radiology Worklist/i)).toBeInTheDocument();
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Chest X-Ray/i)).toBeInTheDocument();
    });
  });

  it('shows study status', async () => {
    render(
      <MemoryRouter>
        <RadiologyPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      // Radiology reports are pending -> in-progress -> preliminary -> final
      // -> addendum; there is no 'completed' state.
      expect(screen.getAllByText(/Final/i).length).toBeGreaterThan(0);
    });
  });

  it.each([
    ['xray', 'XR'], ['X-Ray', 'XR'], ['CR', 'XR'],
    ['mr', 'MRI'], ['ultrasound', 'US'], ['ct', 'CT'],
  ])('keeps a stored %s study visible under its modality filter', async (modality, filter) => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(String(input).includes('radiology-orders') ? [{
        id: 'RAD-FILTER', patient_id: 'PAT-QA', modality,
        special_instructions: 'Synthetic modality filter study', status: 'Ordered',
      }] : []),
    }));
    render(<MemoryRouter><RadiologyPage /></MemoryRouter>);
    await screen.findByText('Synthetic modality filter study');
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: filter } });
    expect(screen.getByText('Synthetic modality filter study')).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: filter === 'CT' ? 'MRI' : 'CT' },
    });
    expect(screen.queryByText('Synthetic modality filter study')).not.toBeInTheDocument();
  });

  it('opens the complete stored report without replacing unknown or false values', async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => Promise.resolve({
      ok: true, headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(String(input).includes('radiology-reports') ? [{
        report_id: 'RAD-READ-QA', patient_id: 'PAT-QA', status: 'Preliminary',
        technique: 'Fictional stored acquisition note', comparison: 'No real comparison performed',
        findings: 'Fictional stored findings', impression: ['Synthetic QA only'],
        contrast: null, critical_finding: false, image_count: 0,
      }] : []),
    }));
    render(<MemoryRouter><RadiologyPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    const disclosure = await screen.findByText('Read saved report');
    fireEvent.click(disclosure);
    const detail = disclosure.closest('details')!;
    expect(detail).toHaveAttribute('open');
    for (const observation of ['Fictional stored acquisition note', 'No real comparison performed',
      'Fictional stored findings', 'Not recorded', 'No', '0']) {
      expect(detail).toHaveTextContent(observation);
    }
    expect(screen.queryByRole('button', { name: /Finalize Report/i })).not.toBeInTheDocument();
  });
});


describe('durable radiology order mapping', () => {
  it('preserves identifiers, clinical description, ordering date and pending status', () => {
    const study = toRadiologyStudy({
      id: 'RAD-123', patient_id: 'PAT-123', body_part: 'Chest',
      special_instructions: 'Synthetic chest radiograph', modality: 'xray',
      created_at: '2026-10-08T08:00:00Z', ordering_provider_id: 'DOC-123',
      status: 'Ordered', priority: 'Routine',
    });
    expect(study).toMatchObject({
      id: 'RAD-123', patientId: 'PAT-123', patientName: 'PAT-123',
      bodyPart: 'Chest', studyDescription: 'Synthetic chest radiograph',
      studyDate: '', orderCreatedAt: '2026-10-08T08:00:00Z', referringPhysician: 'DOC-123',
      status: 'pending', priority: 'routine',
    });
  });
});
