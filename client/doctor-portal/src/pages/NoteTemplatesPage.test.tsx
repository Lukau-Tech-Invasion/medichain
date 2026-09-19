import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NoteTemplatesPage, { mapNoteTemplate } from './NoteTemplatesPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNoteTemplates: vi.fn(),
  useNoteTemplate: vi.fn(),
}));

// Templates come from the API — this page ships no built-in set, so a run with
// no seeded templates correctly shows the empty state.
const TEMPLATES = [
  {
    templateId: 'TMP-001',
    name: 'SOAP Note',
    type: 'soap',
    category: 'general',
    description: 'Subjective, Objective, Assessment, Plan',
    sections: [{ id: 's1', title: 'Subjective', content: '', required: true, order: 0 }],
    macros: [],
    createdBy: 'Dr Smith',
    createdAt: '2026-08-01',
    lastModified: '2026-08-01',
    usageCount: 12,
    isActive: true,
    tags: ['soap'],
  },
  {
    templateId: 'TMP-002',
    name: 'New H&P',
    type: 'history-physical',
    category: 'medicine',
    description: 'History and physical',
    sections: [],
    macros: [],
    createdBy: 'Dr Smith',
    createdAt: '2026-08-01',
    lastModified: '2026-08-01',
    usageCount: 3,
    isActive: true,
    tags: ['h&p'],
  },
  {
    templateId: 'TMP-003',
    name: 'Discharge Summary',
    type: 'discharge-summary',
    category: 'general',
    description: 'Discharge documentation',
    sections: [],
    macros: [],
    createdBy: 'Dr Smith',
    createdAt: '2026-08-01',
    lastModified: '2026-08-01',
    usageCount: 7,
    isActive: true,
    tags: ['discharge'],
  },
];

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

describe('NoteTemplatesPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getNoteTemplates).mockResolvedValue({ success: true, templates: TEMPLATES, count: TEMPLATES.length });
    vi.mocked(shared.useNoteTemplate).mockResolvedValue({ success: true, template_id: 'TMP-001', rendered_content: { subjective: 'Draft text' }, timestamp: 1 });
  });

  it('renders note templates page', () => {
    render(<NoteTemplatesPage />);

    expect(screen.getByText(/Note Templates/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search by name, description, or tags/i)).toBeInTheDocument();
  });

  it('displays default templates', async () => {
    render(<NoteTemplatesPage />);

    // Templates arrive from the API, so the list is empty on first render.
    await waitFor(() =>
      expect(screen.getByText(/SOAP Note/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/New H&P/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Discharge Summary/i).length).toBeGreaterThan(0);
  });

  it('lists each template with its description', async () => {
    render(<NoteTemplatesPage />);

    await waitFor(() =>
      expect(screen.getByText(/Subjective, Objective, Assessment, Plan/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/History and physical/i)).toBeInTheDocument();
  });

  it('maps the server registry shape into renderable template sections', () => {
    const template = mapNoteTemplate({
      template_id: 'TPL-SOAP-ROUTINE', name: 'Routine Follow-up SOAP', category: 'SOAP',
      content: { subjective: 'Reports [SYMPTOMS].', plan: 'Follow up in [TIMEFRAME].' },
    });

    expect(template.templateId).toBe('TPL-SOAP-ROUTINE');
    expect(template.type).toBe('soap');
    expect(template.sections).toHaveLength(2);
    expect(template.sections[0].content).toContain('[SYMPTOMS]');
  });

  it('renders a selected built-in template through the API', async () => {
    render(<NoteTemplatesPage />);
    await screen.findByText(/SOAP Note/i);
    fireEvent.click(screen.getAllByRole('button', { name: /Use template/i })[0]);

    await waitFor(() => expect(shared.useNoteTemplate).toHaveBeenCalledWith({ template_id: 'TMP-001', variables: {} }));
    expect(await screen.findByText(/Rendered draft/i)).toBeInTheDocument();
  });
});
