import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NoteTemplatesPage, { mapNoteTemplate } from './NoteTemplatesPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNoteTemplates: vi.fn(),
  useNoteTemplate: vi.fn(),
  createNoteTemplate: vi.fn(),
  deactivateNoteTemplate: vi.fn(),
}));

const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('../components/Toast', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useToastActions: () => toast,
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

  describe('templates saved on the server', () => {
    // The server's shape: built-ins flagged, clinician templates with ordered sections.
    const SERVER_TEMPLATES = [
      {
        template_id: 'TPL-SOAP-ROUTINE', name: 'Routine Follow-up SOAP', category: 'SOAP', built_in: true,
        content: { subjective: 'Reports [SYMPTOMS].' },
      },
      {
        template_id: 'TPL-USR-mine', name: 'Asthma review', type: 'soap', category: 'medicine',
        description: 'After an exacerbation', built_in: false, is_active: true, created_by: '5GrwvaEF...mock',
        sections: [{ sectionId: 'TPL-USR-mine-S01', title: 'Subjective', content: 'Night symptoms', required: true, order: 1 }],
      },
      {
        template_id: 'TPL-USR-theirs', name: 'Wound check', type: 'procedure', category: 'surgery',
        description: 'Post-op wound', built_in: false, is_active: true, created_by: '5Colleague',
        sections: [{ sectionId: 'TPL-USR-theirs-S01', title: 'Site', content: 'Clean', required: false, order: 1 }],
      },
    ];

    beforeEach(() => {
      vi.mocked(shared.getNoteTemplates).mockResolvedValue({ success: true, templates: SERVER_TEMPLATES, count: 3 });
    });

    it('offers Deactivate only on a template the user wrote', async () => {
      render(<NoteTemplatesPage />);
      await screen.findByText('Asthma review');

      // Built-ins are read-only and a colleague's template is theirs to retire.
      expect(screen.getAllByRole('button', { name: /Deactivate/i })).toHaveLength(1);
      expect(screen.getByText('Built-in')).toBeInTheDocument();
    });

    it('saves a duplicate on the server and reloads the list from it', async () => {
      vi.mocked(shared.createNoteTemplate).mockResolvedValue({ success: true, template: {} });
      render(<NoteTemplatesPage />);
      await screen.findByText('Wound check');

      fireEvent.click(screen.getAllByRole('button', { name: /Duplicate/i })[2]);

      await waitFor(() => expect(shared.createNoteTemplate).toHaveBeenCalledTimes(1));
      const payload = vi.mocked(shared.createNoteTemplate).mock.calls[0][0];
      expect(payload.name).toMatch(/^Wound check/);
      expect(payload.sections).toEqual([{ title: 'Site', content: 'Clean', required: false }]);
      await waitFor(() => expect(shared.getNoteTemplates).toHaveBeenCalledTimes(2));
      expect(toast.showSuccess).toHaveBeenCalled();
    });

    it('says so when the server refuses, and claims no success', async () => {
      vi.mocked(shared.createNoteTemplate).mockRejectedValue(new Error('down'));
      render(<NoteTemplatesPage />);
      await screen.findByText('Wound check');

      fireEvent.click(screen.getAllByRole('button', { name: /Duplicate/i })[0]);

      await waitFor(() => expect(toast.showError).toHaveBeenCalled());
      expect(toast.showSuccess).not.toHaveBeenCalled();
      expect(shared.getNoteTemplates).toHaveBeenCalledTimes(1);
    });

    it('deactivates through the server after confirmation', async () => {
      vi.mocked(shared.deactivateNoteTemplate).mockResolvedValue({ success: true, template_id: 'TPL-USR-mine' });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<NoteTemplatesPage />);
      await screen.findByText('Asthma review');

      fireEvent.click(screen.getByRole('button', { name: /Deactivate/i }));

      await waitFor(() => expect(shared.deactivateNoteTemplate).toHaveBeenCalledWith('TPL-USR-mine'));
      await waitFor(() => expect(shared.getNoteTemplates).toHaveBeenCalledTimes(2));
    });

    it('shows a rendered draft section by section, in order', async () => {
      vi.mocked(shared.useNoteTemplate).mockResolvedValue({
        success: true, template_id: 'TPL-USR-mine', timestamp: 1,
        rendered_content: { Plan: 'Review in 2 weeks', Subjective: 'Night symptoms' },
        rendered_sections: [
          { title: 'Subjective', content: 'Night symptoms' },
          { title: 'Plan', content: 'Review in 2 weeks' },
        ],
      });
      render(<NoteTemplatesPage />);
      await screen.findByText('Asthma review');

      fireEvent.click(screen.getAllByRole('button', { name: /Use template/i })[1]);

      const draft = (await screen.findByText(/Rendered draft/i)).parentElement!;
      const text = draft.textContent ?? '';
      expect(text.indexOf('Subjective')).toBeLessThan(text.indexOf('Plan'));
      expect(text).toContain('Review in 2 weeks');
    });
  });
});

