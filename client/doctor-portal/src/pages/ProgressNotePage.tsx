import React, { useState, useEffect } from 'react';
import {
  FileText,
  Search,
  User,
  Clock,
  Edit,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { apiUrl, getApiClient, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import PatientSelect, { type Patient } from '../components/PatientSelect';

/**
 * ProgressNotePage
 * 
 * Page for writing and viewing clinical progress notes.
 * Implements progress note list, note editor, and patient timeline.
 * Data is fetched from the real API - no mock/seed data.
 */

type NoteType = 'daily' | 'admission' | 'discharge' | 'procedure' | 'consultation' | 'transfer';
type NoteStatus = 'draft' | 'signed' | 'cosigned' | 'addendum';

interface ProgressNote {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  noteType: NoteType;
  status: NoteStatus;
  author: string;
  authorRole: string;
  createdAt: Date;
  updatedAt: Date;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  signedAt?: Date;
  cosigner?: string;
}

const ProgressNotePage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'notes' | 'new' | 'timeline'>('notes');
  const [notes, setNotes] = useState<ProgressNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<ProgressNote | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<NoteType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    patientId: '', patientName: '', noteType: 'daily' as NoteType,
    subjective: '', objective: '', assessment: '', plan: '',
  });

  useEffect(() => {
    const fetchNotes = async () => {
      if (!user) return;
      
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(apiUrl('/api/platform/list/progress-notes'), {
          headers: {
            ...getApiClient().getSessionHeaders(user.walletAddress),
            'X-Provider-Role': user.role,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const patientsResponse = await fetch(apiUrl('/api/patients'), {
            headers: {
              ...getApiClient().getSessionHeaders(user.walletAddress),
              'X-Provider-Role': user.role,
            },
          });
          const patientsBody = patientsResponse.ok ? await patientsResponse.json() : { data: [] };
          const patientNames = new Map(
            (patientsBody.data || patientsBody || []).map((patient: any) => [patient.patient_id, patient.full_name])
          );
          // The list endpoint returns a bare array of record entities of the
          // shape { id, patient_id, data: {...the note...}, created_at }. Flatten
          // the inner `data` up so the note's own fields (note_type, status, …)
          // are readable, while keeping the entity's id/patient_id/timestamps.
          // Tolerant of a bare array, a { notes } or { items } envelope, and a
          // record that is already flat.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawItems: Record<string, any>[] = Array.isArray(data)
            ? data
            : (data.notes || data.items || []);
          const transformedNotes: ProgressNote[] = rawItems.map((item) => {
            const inner = (item.data && typeof item.data === 'object' ? item.data : {});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const note: Record<string, any> = { ...item, ...inner };
            return ({
            id: note.note_id || note.id,
            patientId: note.patient_id,
            patientName: note.patient_name || patientNames.get(note.patient_id) || t('docProgressNote.unknownPatient'),
            mrn: note.mrn || note.patient_id || '',
            noteType: (note.note_type || 'daily') as NoteType,
            status: (note.status === 'final' ? 'signed' : (note.status || 'draft')) as NoteStatus,
            author: note.author || note.created_by || '',
            authorRole: note.author_role || 'Physician',
            createdAt: new Date(note.created_at as string || Date.now()),
            updatedAt: new Date(note.updated_at as string || Date.now()),
            subjective: note.subjective as string || '',
            objective: note.objective || note.exam || '',
            assessment: Array.isArray(note.assessment)
              ? note.assessment.map((problem: any) => problem.problem || '').filter(Boolean).join('\n')
              : (note.assessment || ''),
            plan: Array.isArray(note.plan) ? note.plan.join('\n') : (note.plan || ''),
            signedAt: note.signed_at ? new Date(note.signed_at as string) : undefined,
            cosigner: note.cosigner as string | undefined,
            });
          });
          setNotes(transformedNotes);
        } else {
          setError(t('docProgressNote.failFetch'));
        }
      } catch (err) {
        setError(t('docProgressNote.cannotConnect'));
      } finally {
        setLoading(false);
      }
    };

    fetchNotes();
  }, [user, t]);

  const getNoteTypeColor = (type: NoteType): string => {
    const colors: Record<NoteType, string> = {
      'daily': 'bg-notice-subtle text-notice-subtle-fg',
      'admission': 'bg-ok-subtle text-ok-subtle-fg',
      'discharge': 'bg-surface-sunken text-content-secondary',
      'procedure': 'bg-surface-sunken text-content-secondary',
      'consultation': 'bg-surface-sunken text-content-secondary',
      'transfer': 'bg-caution-subtle text-caution-subtle-fg'
    };
    return colors[type];
  };

  const noteTypeLabel = (type: NoteType): string => {
    switch (type) {
      case 'daily': return t('docProgressNote.ntDaily');
      case 'admission': return t('docProgressNote.ntAdmission');
      case 'discharge': return t('docProgressNote.ntDischarge');
      case 'procedure': return t('docProgressNote.ntProcedure');
      case 'consultation': return t('docProgressNote.ntConsultation');
      case 'transfer': return t('docProgressNote.ntTransfer');
    }
  };

  const getStatusBadge = (status: NoteStatus) => {
    const styles: Record<NoteStatus, { bg: string; text: string }> = {
      'draft': { bg: 'bg-caution-subtle', text: 'text-caution-subtle-fg' },
      'signed': { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg' },
      'cosigned': { bg: 'bg-notice-subtle', text: 'text-notice-subtle-fg' },
      'addendum': { bg: 'bg-surface-sunken', text: 'text-content-secondary' }
    };
    const labels: Record<NoteStatus, string> = {
      'draft': t('docProgressNote.stDraft'),
      'signed': t('docProgressNote.stSigned'),
      'cosigned': t('docProgressNote.stCosigned'),
      'addendum': t('docProgressNote.stAddendum'),
    };
    const s = styles[status];
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
        {labels[status]}
      </span>
    );
  };

  const filteredNotes = notes.filter(n => {
    const matchesSearch = n.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.mrn.includes(searchQuery);
    const matchesType = filterType === 'all' || n.noteType === filterType;
    return matchesSearch && matchesType;
  });

  const updateForm = (field: keyof typeof form, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const selectPatient = (patientId: string, patient?: Patient) => {
    setForm(current => ({
      ...current,
      patientId,
      patientName: patient?.full_name || '',
    }));
  };

  const saveNote = async (status: 'draft' | 'signed') => {
    if (!user || !form.patientId || !form.subjective || !form.objective || !form.assessment || !form.plan) {
      setError(t('docProgressNote.patientRequired'));
      return;
    }

    setSaving(true);
    setError(null);
    const now = new Date();
    const noteId = `PN-${Date.now()}`;
    const payload = {
      note_id: noteId,
      patient_id: form.patientId,
      note_date: now.toISOString().slice(0, 10),
      hospital_day: 1,
      post_op_day: null,
      subjective: form.subjective,
      overnight_events: '',
      vital_signs: form.objective,
      io_summary: null,
      exam: form.objective,
      labs_studies: '',
      assessment: [{ problem_number: 1, problem: form.assessment, status: 'stable', plan: form.plan }],
      plan: [form.plan],
      disposition: null,
      code_status: 'Full code',
      discussed_with: null,
      author: user.username,
      note_time: Math.floor(now.getTime() / 1000),
      cosigned_by: status === 'signed' ? user.username : null,
    };

    try {
      const response = await fetch(apiUrl('/api/clinical/progress-note'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t('docProgressNote.failFetch'));
      }
      setNotes(current => [{
        id: noteId, patientId: form.patientId, patientName: form.patientName,
        mrn: form.patientId, noteType: form.noteType, status,
        author: user.username, authorRole: user.role, createdAt: now, updatedAt: now,
        subjective: form.subjective, objective: form.objective,
        assessment: form.assessment, plan: form.plan,
        signedAt: status === 'signed' ? now : undefined,
      }, ...current]);
      setForm({ patientId: '', patientName: '', noteType: 'daily', subjective: '', objective: '', assessment: '', plan: '' });
      setActiveTab('notes');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('docProgressNote.cannotConnect'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <FileText className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docProgressNote.title')}</h1>
        </div>
        <p className="text-indigo-100">{t('docProgressNote.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-content-secondary animate-spin mb-2" />
          <p className="text-content-muted">{t('docProgressNote.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docProgressNote.apiHint')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-content-secondary">{notes.length}</p>
              <p className="text-xs text-content-muted">{t('docProgressNote.totalNotes')}</p>
            </div>
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-caution-subtle-fg">{notes.filter(n => n.status === 'draft').length}</p>
              <p className="text-xs text-content-muted">{t('docProgressNote.drafts')}</p>
            </div>
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-ok-subtle-fg">{notes.filter(n => n.status === 'signed' || n.status === 'cosigned').length}</p>
              <p className="text-xs text-content-muted">{t('docProgressNote.signed')}</p>
            </div>
          </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {(['notes', 'new', 'timeline'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium ${
                activeTab === tab ? 'text-content-secondary border-b-2 border-indigo-700' : 'text-content-muted'
              }`}
            >
              {tab === 'notes' ? t('docProgressNote.tabNotes') : tab === 'new' ? t('docProgressNote.tabNew') : t('docProgressNote.tabTimeline')}
            </button>
          ))}
        </div>
      </div>

      {/* Notes Tab */}
      {activeTab === 'notes' && (
        <div className="p-4">
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('docProgressNote.searchPlaceholder')}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as NoteType | 'all')}
              className="border rounded-lg px-3 py-2"
            >
              <option value="all">{t('docProgressNote.allTypes')}</option>
              <option value="daily">{t('docProgressNote.filterDaily')}</option>
              <option value="admission">{t('docProgressNote.filterAdmission')}</option>
              <option value="discharge">{t('docProgressNote.filterDischarge')}</option>
              <option value="procedure">{t('docProgressNote.filterProcedure')}</option>
              <option value="consultation">{t('docProgressNote.filterConsultation')}</option>
            </select>
          </div>

          <div className="space-y-3">
            {filteredNotes.map(note => (
              <div
                key={note.id}
                onClick={() => setSelectedNote(note)}
                className={`bg-surface rounded-lg shadow border p-4 cursor-pointer hover:shadow-md ${
                  note.status === 'draft' ? 'border-l-4 border-l-yellow-500' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{note.patientName}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs ${getNoteTypeColor(note.noteType)}`}>
                        {noteTypeLabel(note.noteType)}
                      </span>
                    </div>
                    <p className="text-sm text-content-muted">{t('docProgressNote.mrn', { mrn: note.mrn })}</p>
                  </div>
                  {getStatusBadge(note.status)}
                </div>

                <p className="text-sm text-content-muted line-clamp-2 mb-3">{note.assessment}</p>

                <div className="flex items-center justify-between text-xs text-content-muted">
                  <div className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    <span>{note.author}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{note.createdAt.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Note Tab */}
      {activeTab === 'new' && (
        <div className="p-4">
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docProgressNote.newNote')}</h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="progress-patient" className="block text-sm font-medium mb-1">{t('docProgressNote.patientRequired')}</label>
                  <PatientSelect id="progress-patient" value={form.patientId} onChange={selectPatient}
                    placeholder={t('docProgressNote.selectPatient')} required />
                </div>
                <div>
                  <label htmlFor="progress-note-type" className="block text-sm font-medium mb-1">{t('docProgressNote.noteTypeRequired')}</label>
                  <select id="progress-note-type" value={form.noteType}
                    onChange={e => updateForm('noteType', e.target.value)} className="w-full border rounded-lg px-3 py-2">
                    <option value="daily">{t('docProgressNote.typeDailyProgress')}</option>
                    <option value="admission">{t('docProgressNote.typeAdmission')}</option>
                    <option value="discharge">{t('docProgressNote.typeDischarge')}</option>
                    <option value="procedure">{t('docProgressNote.typeProcedure')}</option>
                    <option value="consultation">{t('docProgressNote.typeConsultation')}</option>
                    <option value="transfer">{t('docProgressNote.typeTransfer')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="progress-subjective" className="block text-sm font-medium mb-1">{t('docProgressNote.subjectiveRequired')}</label>
                <textarea
                  id="progress-subjective"
                  value={form.subjective}
                  onChange={e => updateForm('subjective', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder={t('docProgressNote.subjectivePlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="progress-objective" className="block text-sm font-medium mb-1">{t('docProgressNote.objectiveRequired')}</label>
                <textarea
                  id="progress-objective"
                  value={form.objective}
                  onChange={e => updateForm('objective', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder={t('docProgressNote.objectivePlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="progress-assessment" className="block text-sm font-medium mb-1">{t('docProgressNote.assessmentRequired')}</label>
                <textarea
                  id="progress-assessment"
                  value={form.assessment}
                  onChange={e => updateForm('assessment', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={2}
                  placeholder={t('docProgressNote.assessmentPlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="progress-plan" className="block text-sm font-medium mb-1">{t('docProgressNote.planRequired')}</label>
                <textarea
                  id="progress-plan"
                  value={form.plan}
                  onChange={e => updateForm('plan', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder={t('docProgressNote.planPlaceholder')}
                />
              </div>

              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => saveNote('draft')}
                  className="flex-1 py-3 bg-surface-sunken text-content-secondary rounded-lg font-medium disabled:opacity-50">
                  {t('docProgressNote.saveDraft')}
                </button>
                <button type="button" disabled={saving} onClick={() => saveNote('signed')}
                  className="flex-1 py-3 bg-indigo-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                  <Edit className="w-5 h-5" /> {t('docProgressNote.signNote')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Tab */}
      {activeTab === 'timeline' && (
        <div className="p-4">
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docProgressNote.timelineTitle')}</h2>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-surface-sunken"></div>
              <div className="space-y-6">
                {notes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(note => (
                  <div key={note.id} className="relative pl-10">
                    <div className="absolute left-2.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white"></div>
                    <div className="bg-surface-sunken rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${getNoteTypeColor(note.noteType)}`}>
                          {noteTypeLabel(note.noteType)}
                        </span>
                        <span className="text-xs text-content-muted">{note.createdAt.toLocaleString()}</span>
                      </div>
                      <h4 className="font-medium">{note.patientName}</h4>
                      <p className="text-sm text-content-muted mt-1">{note.assessment.split('\n')[0]}</p>
                      <p className="text-xs text-content-muted mt-2">{t('docProgressNote.by', { author: note.author })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Note Detail Modal */}
      {selectedNote && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold">{selectedNote.patientName}</h2>
                  {getStatusBadge(selectedNote.status)}
                </div>
                <p className="text-sm text-content-muted">{t('docProgressNote.noteSuffix', { type: noteTypeLabel(selectedNote.noteType), date: selectedNote.createdAt.toLocaleString() })}</p>
              </div>
              <button onClick={() => setSelectedNote(null)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-content-muted mb-1">{t('docProgressNote.secSubjective')}</h3>
                <p className="text-content-secondary">{selectedNote.subjective}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-content-muted mb-1">{t('docProgressNote.secObjective')}</h3>
                <p className="text-content-secondary">{selectedNote.objective}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-content-muted mb-1">{t('docProgressNote.secAssessment')}</h3>
                <p className="text-content-secondary whitespace-pre-line">{selectedNote.assessment}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-content-muted mb-1">{t('docProgressNote.secPlan')}</h3>
                <p className="text-content-secondary whitespace-pre-line">{selectedNote.plan}</p>
              </div>

              <div className="pt-4 border-t">
                <p className="text-sm text-content-muted">
                  <strong>{t('docProgressNote.authorLabel')}</strong> {selectedNote.author} ({selectedNote.authorRole})
                </p>
                {selectedNote.signedAt && (
                  <p className="text-sm text-content-muted">
                    <strong>{t('docProgressNote.signedLabel')}</strong> {selectedNote.signedAt.toLocaleString()}
                  </p>
                )}
                {selectedNote.cosigner && (
                  <p className="text-sm text-content-muted">
                    <strong>{t('docProgressNote.cosignedLabel')}</strong> {selectedNote.cosigner}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProgressNotePage;
