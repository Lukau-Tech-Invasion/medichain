import React, { useState, useEffect } from 'react';
import {
  TestTube,
  Search,
  Plus,
  Clock,
  CheckCircle,
  AlertTriangle,
  User,
  Truck,
  FlaskConical,
  Droplet,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { apiUrl, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

/**
 * SpecimenPage
 * 
 * Page for managing specimen collection and tracking in the clinical workflow.
 * Implements table/list of specimens, add specimen, and status tracking.
 */

type SpecimenType = 'blood' | 'urine' | 'stool' | 'swab' | 'tissue' | 'csf' | 'sputum' | 'other';
type CollectionStatus = 'pending' | 'collected' | 'in-transit' | 'received' | 'processing' | 'completed' | 'rejected';
type Priority = 'routine' | 'urgent' | 'stat';

interface Specimen {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  specimenType: SpecimenType;
  testOrdered: string;
  status: CollectionStatus;
  priority: Priority;
  orderedBy: string;
  orderedAt: Date;
  collectedBy?: string;
  collectedAt?: Date;
  receivedAt?: Date;
  notes?: string;
}

const SpecimenPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'specimens' | 'add' | 'tracking'>('specimens');
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [selectedSpecimen, setSelectedSpecimen] = useState<Specimen | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<CollectionStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

  useEffect(() => {
    const fetchSpecimens = async () => {
      if (!user?.walletAddress) {
        setError(t('docSpecimen.notAuthenticated'));
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(apiUrl('/api/clinical/specimens'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'LabTechnician'
          }
        });

        if (!response.ok) {
          throw new Error(t('docSpecimen.fetchError', { status: response.status }));
        }

        const data = await response.json();
        // Convert date strings to Date objects
        const specimenData = data.map((s: Specimen) => ({
          ...s,
          orderedAt: new Date(s.orderedAt),
          collectedAt: s.collectedAt ? new Date(s.collectedAt) : undefined,
          receivedAt: s.receivedAt ? new Date(s.receivedAt) : undefined
        }));
        setSpecimens(specimenData);
        setError(null);
      } catch (err) {
        console.error('Error fetching specimens:', err);
        setError(err instanceof Error ? err.message : t('docSpecimen.failLoad'));
      } finally {
        setLoading(false);
      }
    };

    fetchSpecimens();
  }, [user, t]);

  const getSpecimenIcon = (type: SpecimenType) => {
    const icons: Record<SpecimenType, React.ReactNode> = {
      'blood': <Droplet className="w-5 h-5 text-red-500" />,
      'urine': <TestTube className="w-5 h-5 text-yellow-500" />,
      'stool': <TestTube className="w-5 h-5 text-amber-700" />,
      'swab': <TestTube className="w-5 h-5 text-blue-500" />,
      'tissue': <FlaskConical className="w-5 h-5 text-pink-500" />,
      'csf': <Droplet className="w-5 h-5 text-purple-500" />,
      'sputum': <TestTube className="w-5 h-5 text-green-500" />,
      'other': <TestTube className="w-5 h-5 text-gray-500" />
    };
    return icons[type];
  };

  const getStatusBadge = (status: CollectionStatus) => {
    const styles: Record<CollectionStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'pending': { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <Clock className="w-3 h-3" /> },
      'collected': { bg: 'bg-blue-100', text: 'text-blue-700', icon: <CheckCircle className="w-3 h-3" /> },
      'in-transit': { bg: 'bg-purple-100', text: 'text-purple-700', icon: <Truck className="w-3 h-3" /> },
      'received': { bg: 'bg-cyan-100', text: 'text-cyan-700', icon: <FlaskConical className="w-3 h-3" /> },
      'processing': { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: <FlaskConical className="w-3 h-3" /> },
      'completed': { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
      'rejected': { bg: 'bg-red-100', text: 'text-red-700', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const labels: Record<CollectionStatus, string> = {
      'pending': t('docSpecimen.stPending'),
      'collected': t('docSpecimen.stCollected'),
      'in-transit': t('docSpecimen.stInTransit'),
      'received': t('docSpecimen.stReceived'),
      'processing': t('docSpecimen.stProcessing'),
      'completed': t('docSpecimen.stCompleted'),
      'rejected': t('docSpecimen.stRejected'),
    };
    const s = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {labels[status]}
      </span>
    );
  };

  const getPriorityBadge = (priority: Priority) => {
    const colors: Record<Priority, string> = {
      'routine': 'bg-gray-100 text-gray-600',
      'urgent': 'bg-orange-100 text-orange-700',
      'stat': 'bg-red-100 text-red-700'
    };
    const labels: Record<Priority, string> = {
      'routine': t('docSpecimen.priRoutine'),
      'urgent': t('docSpecimen.priUrgent'),
      'stat': t('docSpecimen.priStat'),
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${colors[priority]}`}>
        {labels[priority]}
      </span>
    );
  };

  const typeLabel = (type: SpecimenType): string => {
    switch (type) {
      case 'blood': return t('docSpecimen.typeBlood');
      case 'urine': return t('docSpecimen.typeUrine');
      case 'stool': return t('docSpecimen.typeStool');
      case 'swab': return t('docSpecimen.typeSwab');
      case 'tissue': return t('docSpecimen.typeTissue');
      case 'csf': return t('docSpecimen.typeCsf');
      case 'sputum': return t('docSpecimen.typeSputum');
      case 'other': return t('docSpecimen.typeOther');
    }
  };

  const filteredSpecimens = specimens.filter(s => {
    const matchesSearch = s.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.mrn.includes(searchQuery) || s.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || s.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = specimens.filter(s => s.status === 'pending').length;
  const statCount = specimens.filter(s => s.priority === 'stat' && s.status !== 'completed').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-600 to-cyan-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <TestTube className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docSpecimen.title')}</h1>
        </div>
        <p className="text-teal-100">{t('docSpecimen.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-teal-600 animate-spin mb-2" />
          <p className="text-gray-500">{t('docSpecimen.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-red-700">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docSpecimen.apiHint')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-gray-800">{specimens.length}</p>
              <p className="text-xs text-gray-500">{t('docSpecimen.total')}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
              <p className="text-xs text-gray-500">{t('docSpecimen.pending')}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{statCount}</p>
              <p className="text-xs text-gray-500">{t('docSpecimen.statOrders')}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white border-b">
            <div className="flex">
              {(['specimens', 'add', 'tracking'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium ${
                    activeTab === tab ? 'text-teal-700 border-b-2 border-teal-700' : 'text-gray-500'
                  }`}
                >
                  {tab === 'specimens' ? t('docSpecimen.tabAll') : tab === 'add' ? t('docSpecimen.tabCollect') : t('docSpecimen.tabTracking')}
                </button>
              ))}
            </div>
          </div>

          {/* Specimens Tab */}
          {activeTab === 'specimens' && (
            <div className="p-4">
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('docSpecimen.searchPlaceholder')}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg"
                  />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as CollectionStatus | 'all')}
              className="border rounded-lg px-3 py-2"
            >
              <option value="all">{t('docSpecimen.allStatus')}</option>
              <option value="pending">{t('docSpecimen.filterPending')}</option>
              <option value="collected">{t('docSpecimen.filterCollected')}</option>
              <option value="processing">{t('docSpecimen.filterProcessing')}</option>
              <option value="completed">{t('docSpecimen.filterCompleted')}</option>
            </select>
          </div>

          <div className="space-y-3">
            {filteredSpecimens.map(specimen => (
              <div
                key={specimen.id}
                onClick={() => setSelectedSpecimen(specimen)}
                className={`bg-white rounded-lg shadow border p-4 cursor-pointer hover:shadow-md ${
                  specimen.priority === 'stat' ? 'border-l-4 border-l-red-500' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {getSpecimenIcon(specimen.specimenType)}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{specimen.patientName}</h3>
                        {getPriorityBadge(specimen.priority)}
                      </div>
                      <p className="text-sm text-gray-500">{t('docSpecimen.mrnId', { mrn: specimen.mrn, id: specimen.id })}</p>
                    </div>
                  </div>
                  {getStatusBadge(specimen.status)}
                </div>

                <div className="bg-gray-50 rounded p-2 mb-2">
                  <p className="text-sm"><strong>{t('docSpecimen.testLabel')}</strong> {specimen.testOrdered}</p>
                  <p className="text-sm"><strong>{t('docSpecimen.typeLabelInline')}</strong> {typeLabel(specimen.specimenType)}</p>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    <span>{t('docSpecimen.orderedByLine', { by: specimen.orderedBy })}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{specimen.orderedAt.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Specimen Tab */}
      {activeTab === 'add' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docSpecimen.collectTitle')}</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="specimen-patient" className="block text-sm font-medium mb-1">{t('docSpecimen.patientRequired')}</label>
                <select id="specimen-patient" className="w-full border rounded-lg px-3 py-2">
                  <option value="">{t('docSpecimen.selectPatient')}</option>
                  {specimens.map(s => (
                    <option key={s.patientId} value={s.patientId}>{s.patientName} - {s.mrn}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="specimen-type" className="block text-sm font-medium mb-1">{t('docSpecimen.specimenTypeRequired')}</label>
                  <select id="specimen-type" className="w-full border rounded-lg px-3 py-2">
                    <option value="blood">{t('docSpecimen.typeBlood')}</option>
                    <option value="urine">{t('docSpecimen.typeUrine')}</option>
                    <option value="stool">{t('docSpecimen.typeStool')}</option>
                    <option value="swab">{t('docSpecimen.typeSwab')}</option>
                    <option value="tissue">{t('docSpecimen.typeTissue')}</option>
                    <option value="csf">{t('docSpecimen.typeCsf')}</option>
                    <option value="sputum">{t('docSpecimen.typeSputum')}</option>
                    <option value="other">{t('docSpecimen.typeOther')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="specimen-priority" className="block text-sm font-medium mb-1">{t('docSpecimen.priorityRequired')}</label>
                  <select id="specimen-priority" className="w-full border rounded-lg px-3 py-2">
                    <option value="routine">{t('docSpecimen.optRoutine')}</option>
                    <option value="urgent">{t('docSpecimen.optUrgent')}</option>
                    <option value="stat">{t('docSpecimen.optStat')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="specimen-tests-ordered" className="block text-sm font-medium mb-1">{t('docSpecimen.testsOrderedRequired')}</label>
                <input id="specimen-tests-ordered" type="text" className="w-full border rounded-lg px-3 py-2" placeholder={t('docSpecimen.testsPlaceholder')} />
              </div>

              <div>
                <label htmlFor="specimen-collection-site" className="block text-sm font-medium mb-1">{t('docSpecimen.collectionSite')}</label>
                <input id="specimen-collection-site" type="text" className="w-full border rounded-lg px-3 py-2" placeholder={t('docSpecimen.sitePlaceholder')} />
              </div>

              <div>
                <label htmlFor="specimen-notes" className="block text-sm font-medium mb-1">{t('docSpecimen.notes')}</label>
                <textarea id="specimen-notes" className="w-full border rounded-lg px-3 py-2" rows={2} placeholder={t('docSpecimen.notesPlaceholder')} />
              </div>

              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                <p className="text-sm text-teal-700 font-medium mb-2">{t('docSpecimen.checklist')}</p>
                <div className="space-y-1">
                  {[t('docSpecimen.chkVerifyId'), t('docSpecimen.chkRequirements'), t('docSpecimen.chkLabel'), t('docSpecimen.chkTime')].map((item, idx) => (
                    <label key={idx} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="w-4 h-4" />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button className="w-full py-3 bg-teal-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" /> {t('docSpecimen.recordCollection')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tracking Tab */}
      {activeTab === 'tracking' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docSpecimen.trackingTitle')}</h2>
            <div className="space-y-4">
              {specimens.filter(s => s.status !== 'completed').map(specimen => (
                <div key={specimen.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {getSpecimenIcon(specimen.specimenType)}
                      <div>
                        <p className="font-medium">{specimen.id}</p>
                        <p className="text-sm text-gray-500">{specimen.patientName}</p>
                      </div>
                    </div>
                    {getPriorityBadge(specimen.priority)}
                  </div>

                  <div className="relative">
                    <div className="absolute top-2 left-2 right-2 h-1 bg-gray-200 rounded"></div>
                    <div className="flex justify-between relative z-10">
                      {(['pending', 'collected', 'in-transit', 'received', 'processing', 'completed'] as CollectionStatus[]).map((step, idx) => {
                        const steps: CollectionStatus[] = ['pending', 'collected', 'in-transit', 'received', 'processing', 'completed'];
                        const currentIdx = steps.indexOf(specimen.status);
                        const isActive = idx <= currentIdx;
                        return (
                          <div key={step} className="flex flex-col items-center">
                            <div className={`w-4 h-4 rounded-full ${isActive ? 'bg-teal-500' : 'bg-gray-300'}`}></div>
                            <span className={`text-xs mt-1 ${isActive ? 'text-teal-600' : 'text-gray-400'}`}>
                              {step.split('-').map(w => w[0].toUpperCase()).join('')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Specimen Detail Modal */}
      {selectedSpecimen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getSpecimenIcon(selectedSpecimen.specimenType)}
                <div>
                  <h2 className="text-xl font-semibold">{selectedSpecimen.id}</h2>
                  <p className="text-sm text-gray-500">{t('docSpecimen.specimenSuffix', { type: typeLabel(selectedSpecimen.specimenType) })}</p>
                </div>
              </div>
              <button onClick={() => setSelectedSpecimen(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                {getStatusBadge(selectedSpecimen.status)}
                {getPriorityBadge(selectedSpecimen.priority)}
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">{t('docSpecimen.patientInfo')}</h3>
                <p><strong>{t('docSpecimen.nameLabel')}</strong> {selectedSpecimen.patientName}</p>
                <p><strong>{t('docSpecimen.mrnLabelBold')}</strong> {selectedSpecimen.mrn}</p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">{t('docSpecimen.testDetails')}</h3>
                <p><strong>{t('docSpecimen.testsOrderedLabel')}</strong> {selectedSpecimen.testOrdered}</p>
                <p><strong>{t('docSpecimen.orderedByLabel')}</strong> {selectedSpecimen.orderedBy}</p>
                <p><strong>{t('docSpecimen.orderedAtLabel')}</strong> {selectedSpecimen.orderedAt.toLocaleString()}</p>
              </div>

              {selectedSpecimen.collectedBy && (
                <div className="bg-blue-50 rounded-lg p-4">
                  <h3 className="font-medium mb-2">{t('docSpecimen.collectionDetails')}</h3>
                  <p><strong>{t('docSpecimen.collectedByLabel')}</strong> {selectedSpecimen.collectedBy}</p>
                  <p><strong>{t('docSpecimen.collectedAtLabel')}</strong> {selectedSpecimen.collectedAt?.toLocaleString()}</p>
                  {selectedSpecimen.notes && <p><strong>{t('docSpecimen.notesLabel')}</strong> {selectedSpecimen.notes}</p>}
                </div>
              )}

              {selectedSpecimen.status === 'pending' && (
                <button className="w-full py-3 bg-teal-600 text-white rounded-lg font-medium">
                  {t('docSpecimen.markCollected')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpecimenPage;
