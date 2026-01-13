import React, { useState, useEffect } from 'react';
import {
  FileText,
  Search,
  User,
  Clock,
  Edit
} from 'lucide-react';

/**
 * ProgressNotePage
 * 
 * Page for writing and viewing clinical progress notes.
 * Implements progress note list, note editor, and patient timeline.
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
  const [activeTab, setActiveTab] = useState<'notes' | 'new' | 'timeline'>('notes');
  const [notes, setNotes] = useState<ProgressNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<ProgressNote | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<NoteType | 'all'>('all');

  useEffect(() => {
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

    setNotes([
      {
        id: 'PN-001',
        patientId: 'PAT-001',
        patientName: 'Abdullah Al-Mansouri',
        mrn: '123456',
        noteType: 'daily',
        status: 'signed',
        author: 'Dr. Khalid Rahman',
        authorRole: 'Attending Physician',
        createdAt: hoursAgo(4),
        updatedAt: hoursAgo(4),
        signedAt: hoursAgo(3),
        subjective: 'Patient reports improvement in chest pain. Pain now 3/10, down from 7/10 yesterday. Able to sleep through the night without discomfort.',
        objective: 'VS: BP 132/78, HR 72, RR 16, SpO2 98% RA. Cardiac: RRR, no murmurs. Lungs: CTA bilaterally. Abd: Soft, non-tender.',
        assessment: '1. Acute coronary syndrome, improving\n2. Hypertension, controlled\n3. Type 2 DM, stable on current regimen',
        plan: '1. Continue current cardiac medications\n2. Repeat troponins in AM\n3. Cardiology to evaluate for cath\n4. Continue telemetry monitoring'
      },
      {
        id: 'PN-002',
        patientId: 'PAT-002',
        patientName: 'Fatima Hassan',
        mrn: '234567',
        noteType: 'admission',
        status: 'draft',
        author: 'Dr. Sarah Ahmed',
        authorRole: 'Resident',
        createdAt: hoursAgo(1),
        updatedAt: hoursAgo(0.5),
        subjective: 'Patient presents with 2-day history of fever, productive cough with yellow sputum, and shortness of breath. Denies chest pain, hemoptysis.',
        objective: 'VS: T 38.9°C, BP 118/72, HR 98, RR 22, SpO2 92% RA. Lungs: Decreased breath sounds RLL with crackles. Cardiac: Tachycardic, regular rhythm.',
        assessment: '1. Community-acquired pneumonia, likely bacterial\n2. Acute hypoxic respiratory failure\n3. Dehydration',
        plan: '1. Start IV antibiotics (Ceftriaxone + Azithromycin)\n2. O2 supplementation to maintain SpO2 > 94%\n3. IV fluids\n4. Chest X-ray\n5. Blood cultures x2'
      },
      {
        id: 'PN-003',
        patientId: 'PAT-003',
        patientName: 'Omar Khalil',
        mrn: '345678',
        noteType: 'procedure',
        status: 'cosigned',
        author: 'Dr. Yusuf Nasser',
        authorRole: 'Interventional Cardiologist',
        createdAt: hoursAgo(6),
        updatedAt: hoursAgo(5),
        signedAt: hoursAgo(5),
        cosigner: 'Dr. Khalid Rahman',
        subjective: 'Patient underwent planned cardiac catheterization for evaluation of chest pain and positive stress test.',
        objective: 'Procedure: Cardiac catheterization via right radial artery approach. Findings: 70% stenosis of LAD, 50% stenosis of RCA. No significant disease in LCx. LV EF 55%.',
        assessment: 'Significant single vessel CAD with LAD stenosis amenable to PCI',
        plan: '1. PCI to LAD with DES planned for tomorrow\n2. Continue dual antiplatelet therapy\n3. Radial band removal in 2 hours\n4. NPO after midnight for procedure'
      }
    ]);
  }, []);

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

  const getStatusBadge = (status: NoteStatus) => {
    const styles: Record<NoteStatus, { bg: string; text: string }> = {
      'draft': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
      'signed': { bg: 'bg-green-100', text: 'text-green-700' },
      'cosigned': { bg: 'bg-blue-100', text: 'text-blue-700' },
      'addendum': { bg: 'bg-purple-100', text: 'text-purple-700' }
    };
    const s = styles[status];
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
        {status}
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
          <h1 className="text-2xl font-bold">Progress Notes</h1>
        </div>
        <p className="text-indigo-100">Clinical documentation and patient timeline</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{notes.length}</p>
          <p className="text-xs text-gray-500">Total Notes</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{notes.filter(n => n.status === 'draft').length}</p>
          <p className="text-xs text-gray-500">Drafts</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{notes.filter(n => n.status === 'signed' || n.status === 'cosigned').length}</p>
          <p className="text-xs text-gray-500">Signed</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {(['notes', 'new', 'timeline'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium capitalize ${
                activeTab === tab ? 'text-indigo-700 border-b-2 border-indigo-700' : 'text-gray-500'
              }`}
            >
              {tab === 'notes' ? 'All Notes' : tab === 'new' ? 'New Note' : 'Timeline'}
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
                placeholder="Search patient..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as NoteType | 'all')}
              className="border rounded-lg px-3 py-2"
            >
              <option value="all">All Types</option>
              <option value="daily">Daily</option>
              <option value="admission">Admission</option>
              <option value="discharge">Discharge</option>
              <option value="procedure">Procedure</option>
              <option value="consultation">Consultation</option>
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
                        {note.noteType}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">MRN: {note.mrn}</p>
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
            <h2 className="text-lg font-semibold mb-4">New Progress Note</h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Patient *</label>
                  <select className="w-full border rounded-lg px-3 py-2">
                    <option value="">Select patient...</option>
                    {notes.map(n => (
                      <option key={n.patientId} value={n.patientId}>{n.patientName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Note Type *</label>
                  <select className="w-full border rounded-lg px-3 py-2">
                    <option value="daily">Daily Progress</option>
                    <option value="admission">Admission</option>
                    <option value="discharge">Discharge</option>
                    <option value="procedure">Procedure</option>
                    <option value="consultation">Consultation</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Subjective *</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="Patient's complaints, symptoms, history..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Objective *</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="Vital signs, physical exam findings, lab results..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Assessment *</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2"
                  rows={2}
                  placeholder="Diagnoses, clinical impression..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Plan *</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  placeholder="Treatment plan, orders, follow-up..."
                />
              </div>

              <div className="flex gap-2">
                <button className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium">
                  Save as Draft
                </button>
                <button className="flex-1 py-3 bg-indigo-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                  <Edit className="w-5 h-5" /> Sign Note
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
            <h2 className="text-lg font-semibold mb-4">Patient Timeline</h2>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
              <div className="space-y-6">
                {notes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(note => (
                  <div key={note.id} className="relative pl-10">
                    <div className="absolute left-2.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white"></div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${getNoteTypeColor(note.noteType)}`}>
                          {note.noteType}
                        </span>
                        <span className="text-xs text-gray-500">{note.createdAt.toLocaleString()}</span>
                      </div>
                      <h4 className="font-medium">{note.patientName}</h4>
                      <p className="text-sm text-gray-600 mt-1">{note.assessment.split('\n')[0]}</p>
                      <p className="text-xs text-gray-500 mt-2">By {note.author}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
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
                <p className="text-sm text-gray-500">{selectedNote.noteType} note • {selectedNote.createdAt.toLocaleString()}</p>
              </div>
              <button onClick={() => setSelectedNote(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">SUBJECTIVE</h3>
                <p className="text-gray-700">{selectedNote.subjective}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">OBJECTIVE</h3>
                <p className="text-gray-700">{selectedNote.objective}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">ASSESSMENT</h3>
                <p className="text-gray-700 whitespace-pre-line">{selectedNote.assessment}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">PLAN</h3>
                <p className="text-gray-700 whitespace-pre-line">{selectedNote.plan}</p>
              </div>

              <div className="pt-4 border-t">
                <p className="text-sm text-gray-500">
                  <strong>Author:</strong> {selectedNote.author} ({selectedNote.authorRole})
                </p>
                {selectedNote.signedAt && (
                  <p className="text-sm text-gray-500">
                    <strong>Signed:</strong> {selectedNote.signedAt.toLocaleString()}
                  </p>
                )}
                {selectedNote.cosigner && (
                  <p className="text-sm text-gray-500">
                    <strong>Co-signed by:</strong> {selectedNote.cosigner}
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
