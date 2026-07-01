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
import { apiUrl, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

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

  useEffect(() => {
    const fetchNotes = async () => {
      if (!user) return;
      
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(apiUrl('/api/clinical/progress-notes'), {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          // Transform API response to match ProgressNote interface
          const transformedNotes: ProgressNote[] = (data.notes || []).map((note: Record<string, unknown>) => ({
            id: note.note_id || note.id,
            patientId: note.patient_id,
            patientName: note.patient_name || t('docProgressNote.unknownPatient'),
            mrn: note.mrn || '',
            noteType: (note.note_type || 'daily') as NoteType,
            status: (note.status || 'draft') as NoteStatus,
            author: note.author || note.created_by || '',
            authorRole: note.author_role || 'Physician',
            createdAt: new Date(note.created_at as string || Date.now()),
            updatedAt: new Date(note.updated_at as string || Date.now()),
            subjective: note.subjective as string || '',
            objective: note.objective as string || '',
            assessment: note.assessment as string || '',
            plan: note.plan as string || '',
            signedAt: note.signed_at ? new Date(note.signed_at as string) : undefined,
            cosigner: note.cosigner as string | undefined,
          }));
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
      'daily': 'bg-blue-100 text-blue-700',
      'admission': 'bg-green-100 text-green-700',
      'discharge': 'bg-purple-100 text-purple-700',
      'procedure': 'bg-orange-100 text-orange-700',
      'consultation': 'bg-cyan-100 text-cyan-700',
      'transfer': 'bg-yellow-100 text-yellow-700'
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
      'draft': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
      'signed': { bg: 'bg-green-100', text: 'text-green-700' },
      'cosigned': { bg: 'bg-blue-100', text: 'text-blue-700' },
      'addendum': { bg: 'bg-purple-100', text: 'text-purple-700' }
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

  return (
    <div className="min-h-screen bg-gray-50">
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
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
          <p className="text-gray-500">{t('docProgressNote.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-red-700">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docProgressNote.apiHint')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-gray-800">{notes.length}</p>
              <p className="text-xs text-gray-500">{t('docProgressNote.totalNotes')}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-yellow-600">{notes.filter(n => n.status === 'draft').length}</p>
              <p className="text-xs text-gray-500">{t('docProgressNote.drafts')}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{notes.filter(n => n.status === 'signed' || n.status === 'cosigned').length}</p>
              <p className="text-xs text-gray-500">{t('docProgressNote.signed')}</p>
            </div>
          </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {(['notes', 'new', 'timeline'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium ${
                activeTab === tab ? 'text-indigo-700 border-b-2 border-indigo-700' : 'text-gray-500'
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
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
                className={`bg-white rounded-lg shadow border p-4 cursor-pointer hover:shadow-md ${
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
                    <p className="text-sm text-gray-500">{t('docProgressNote.mrn', { mrn: note.mrn })}</p>
                  </div>
                  {getStatusBadge(note.status)}
                </div>

                <p className="text-sm text-gray-600 line-clamp-2 mb-3">{note.assessment}</p>

                <div className="flex items-center justify-between text-xs text-gray-500">
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docProgressNote.newNote')}</h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="progress-patient" className="block text-sm font-medium mb-1">{t('docProgressNote.patientRequired')}</label>
                  <select id="progress-patient" className="w-full border rounded-lg px-3 py-2">
                    <option value="">{t('docProgressNote.selectPatient')}</option>
                    {notes.map(n => (
                      <option key={n.patientId} value={n.patientId}>{n.patientName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="progress-note-type" className="block text-sm font-medium mb-1">{t('docProgressNote.noteTypeRequired')}</label>
                  <select id="progress-note-type" className="w-full border rounded-lg px-3 py-2">
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
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder={t('docProgressNote.subjectivePlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="progress-objective" className="block text-sm font-medium mb-1">{t('docProgressNote.objectiveRequired')}</label>
                <textarea
                  id="progress-objective"
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder={t('docProgressNote.objectivePlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="progress-assessment" className="block text-sm font-medium mb-1">{t('docProgressNote.assessmentRequired')}</label>
                <textarea
                  id="progress-assessment"
                  className="w-full border rounded-lg px-3 py-2"
                  rows={2}
                  placeholder={t('docProgressNote.assessmentPlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="progress-plan" className="block text-sm font-medium mb-1">{t('docProgressNote.planRequired')}</label>
                <textarea
                  id="progress-plan"
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder={t('docProgressNote.planPlaceholder')}
                />
              </div>

              <div className="flex gap-2">
                <button className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium">
                  {t('docProgressNote.saveDraft')}
                </button>
                <button className="flex-1 py-3 bg-indigo-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docProgressNote.timelineTitle')}</h2>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
              <div className="space-y-6">
                {notes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(note => (
                  <div key={note.id} className="relative pl-10">
                    <div className="absolute left-2.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white"></div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${getNoteTypeColor(note.noteType)}`}>
                          {noteTypeLabel(note.noteType)}
                        </span>
                        <span className="text-xs text-gray-500">{note.createdAt.toLocaleString()}</span>
                      </div>
                      <h4 className="font-medium">{note.patientName}</h4>
                      <p className="text-sm text-gray-600 mt-1">{note.assessment.split('\n')[0]}</p>
                      <p className="text-xs text-gray-500 mt-2">{t('docProgressNote.by', { author: note.author })}</p>
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
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold">{selectedNote.patientName}</h2>
                  {getStatusBadge(selectedNote.status)}
                </div>
                <p className="text-sm text-gray-500">{t('docProgressNote.noteSuffix', { type: noteTypeLabel(selectedNote.noteType), date: selectedNote.createdAt.toLocaleString() })}</p>
              </div>
              <button onClick={() => setSelectedNote(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">{t('docProgressNote.secSubjective')}</h3>
                <p className="text-gray-700">{selectedNote.subjective}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">{t('docProgressNote.secObjective')}</h3>
                <p className="text-gray-700">{selectedNote.objective}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">{t('docProgressNote.secAssessment')}</h3>
                <p className="text-gray-700 whitespace-pre-line">{selectedNote.assessment}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">{t('docProgressNote.secPlan')}</h3>
                <p className="text-gray-700 whitespace-pre-line">{selectedNote.plan}</p>
              </div>

              <div className="pt-4 border-t">
                <p className="text-sm text-gray-500">
                  <strong>{t('docProgressNote.authorLabel')}</strong> {selectedNote.author} ({selectedNote.authorRole})
                </p>
                {selectedNote.signedAt && (
                  <p className="text-sm text-gray-500">
                    <strong>{t('docProgressNote.signedLabel')}</strong> {selectedNote.signedAt.toLocaleString()}
                  </p>
                )}
                {selectedNote.cosigner && (
                  <p className="text-sm text-gray-500">
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
