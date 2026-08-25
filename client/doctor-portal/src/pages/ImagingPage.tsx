import { useState, useEffect } from 'react';
import { Camera, User, AlertCircle, Search, Plus } from 'lucide-react';
import { useToastActions } from '../components/Toast';
import { useAuthStore } from '../store/authStore';
import { apiUrl, getApiClient, getPatients, useTranslation } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';

type ImagingModality = 'xray' | 'ct' | 'mri' | 'ultrasound' | 'fluoro' | 'mammo' | 'dexa' | 'pet' | 'nuclear';
type ImagingStatus = 'ordered' | 'scheduled' | 'in-progress' | 'completed' | 'prelim' | 'final';
type ImagingPriority = 'stat' | 'urgent' | 'routine';

interface ImagingOrder {
  id: string;
  patientId: string;
  patientName: string;
  modality: ImagingModality;
  study: string;
  bodyPart: string;
  laterality: 'left' | 'right' | 'bilateral' | 'na';
  indication: string;
  priority: ImagingPriority;
  status: ImagingStatus;
  orderedBy: string;
  orderedAt: string;
  scheduledAt?: string;
  completedAt?: string;
  contrast: boolean;
  allergies: string;
  creatinine?: number;
  pregnant?: string;
  findings?: string;
  impression?: string;
  radiologist?: string;
  criticalValue: boolean;
}

const modalityLabels: Record<ImagingModality, string> = {
  xray: 'X-Ray', ct: 'CT Scan', mri: 'MRI', ultrasound: 'Ultrasound',
  fluoro: 'Fluoroscopy', mammo: 'Mammography', dexa: 'DEXA', pet: 'PET Scan', nuclear: 'Nuclear Medicine'
};

const bodyParts = [
  'Head', 'Brain', 'Neck', 'Spine - Cervical', 'Spine - Thoracic', 'Spine - Lumbar', 'Spine - Sacral',
  'Chest', 'Abdomen', 'Pelvis', 'Shoulder', 'Elbow', 'Wrist', 'Hand', 'Hip', 'Knee', 'Ankle', 'Foot',
  'Upper Extremity', 'Lower Extremity', 'Whole Body'
];

const ImagingPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showWarning, showError } = useToastActions();

  const modalityLabel = (m: ImagingModality): string => {
    switch (m) {
      case 'xray': return t('docImaging.modXray');
      case 'ct': return t('docImaging.modCt');
      case 'mri': return t('docImaging.modMri');
      case 'ultrasound': return t('docImaging.modUltrasound');
      case 'fluoro': return t('docImaging.modFluoro');
      case 'mammo': return t('docImaging.modMammo');
      case 'dexa': return t('docImaging.modDexa');
      case 'pet': return t('docImaging.modPet');
      case 'nuclear': return t('docImaging.modNuclear');
    }
  };

  const priorityLabel = (p: ImagingPriority): string => {
    switch (p) {
      case 'stat': return t('docImaging.priStat');
      case 'urgent': return t('docImaging.priUrgent');
      case 'routine': return t('docImaging.priRoutine');
    }
  };

  const statusLabel = (s: ImagingStatus): string => {
    switch (s) {
      case 'ordered': return t('docImaging.statusOrdered');
      case 'scheduled': return t('docImaging.statusScheduled');
      case 'in-progress': return t('docImaging.statusInProgress');
      case 'completed': return t('docImaging.statusCompleted');
      case 'prelim': return t('docImaging.statusPrelim');
      case 'final': return t('docImaging.statusFinal');
    }
  };
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [orders, setOrders] = useState<ImagingOrder[]>([]);
  const [activeTab, setActiveTab] = useState<'orders' | 'new' | 'results'>('orders');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterModality, setFilterModality] = useState<string>('all');

  // New order form
  const [selectedPatient, setSelectedPatient] = useState('');
  const [modality, setModality] = useState<ImagingModality>('xray');
  const [study, setStudy] = useState('');
  const [bodyPart, setBodyPart] = useState('Chest');
  const [laterality, setLaterality] = useState<'left' | 'right' | 'bilateral' | 'na'>('na');
  const [indication, setIndication] = useState('');
  const [priority, setPriority] = useState<ImagingPriority>('routine');
  const [contrast, setContrast] = useState(false);
  const [allergies, setAllergies] = useState('');
  const [creatinine, setCreatinine] = useState<number | undefined>();
  const [pregnant, setPregnant] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const pts = await getPatients();
        setPatients(pts);
      } catch (err) {
        console.error('Failed to load patients:', err);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (!user) return;
    const fetchOrders = async () => {
      try {
        const res = await fetch(apiUrl('/api/platform/list/radiology-orders'), {
          headers: {
            ...getApiClient().getSessionHeaders(user.walletAddress),
            'X-Provider-Role': user.role || 'Doctor',
          },
        });
        if (res.ok) {
          const data = await res.json();
          const rawOrders = Array.isArray(data) ? data : (data.orders || []);
          const fetchedOrders: ImagingOrder[] = rawOrders.map((entity: any) => {
            if (entity.patientId && entity.modality) return entity as ImagingOrder;
            const raw = entity.data && typeof entity.data === 'object' ? entity.data : entity;
            const patient = patients.find(p => p.patient_id === (raw.patient_id || entity.patient_id));
            return {
              id: raw.order_id || entity.id,
              patientId: raw.patient_id || entity.patient_id,
              patientName: patient?.full_name || raw.patient_id || entity.patient_id,
              modality: ({ XRay: 'xray', CT: 'ct', CTWithContrast: 'ct', MRI: 'mri', MRIWithContrast: 'mri', Ultrasound: 'ultrasound', Nuclear: 'nuclear', PET: 'pet', Fluoroscopy: 'fluoro', Mammography: 'mammo', Angiography: 'ct' } as Record<string, ImagingModality>)[raw.study_type] || 'xray',
              study: raw.special_instructions || raw.study_type || entity.study_type,
              bodyPart: raw.body_part || entity.body_part,
              laterality: String(raw.laterality || entity.laterality || 'NA').toLowerCase() as ImagingOrder['laterality'],
              indication: raw.indication || entity.clinical_indication,
              priority: String(raw.priority || entity.priority || 'Routine').toLowerCase() as ImagingPriority,
              status: ({ Ordered: 'ordered', Scheduled: 'scheduled', InProgress: 'in-progress', Completed: 'completed', Preliminary: 'prelim', Final: 'final' } as Record<string, ImagingStatus>)[raw.status] || 'ordered',
              orderedBy: raw.ordering_provider || entity.ordering_provider_id,
              orderedAt: raw.order_time ? new Date(raw.order_time * 1000).toISOString() : entity.created_at,
              contrast: Boolean(raw.contrast), allergies: raw.allergies_reviewed ? 'Reviewed' : '',
              criticalValue: false,
            };
          });
          setOrders(fetchedOrders);
        }
      } catch (err) {
        console.error('Failed to fetch imaging orders:', err);
      }
    };
    fetchOrders();
  }, [user, patients]);

  const handleSubmit = async () => {
    if (!selectedPatient || !indication) {
      showWarning(t('docImaging.fillRequired'));
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    if (!user) return;
    const order: ImagingOrder = {
      id: `IMG-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      modality, study: study || `${modalityLabel(modality)} ${bodyPart}`,
      bodyPart, laterality, indication, priority, status: 'ordered',
      orderedBy: user?.username || t('docImaging.unknown'),
      orderedAt: new Date().toISOString(),
      contrast, allergies, creatinine, pregnant, criticalValue: false
    };
    const studyTypes: Record<ImagingModality, string> = {
      xray: 'XRay', ct: contrast ? 'CTWithContrast' : 'CT',
      mri: contrast ? 'MRIWithContrast' : 'MRI', ultrasound: 'Ultrasound',
      fluoro: 'Fluoroscopy', mammo: 'Mammography', dexa: 'XRay',
      pet: 'PET', nuclear: 'Nuclear',
    };
    setSubmitting(true);
    try {
      const response = await fetch(apiUrl('/api/surgical/radiology/order'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({
          order_id: order.id, patient_id: order.patientId,
          study_type: studyTypes[modality], body_part: bodyPart,
          laterality: ({ left: 'Left', right: 'Right', bilateral: 'Bilateral', na: 'NA' } as const)[laterality],
          indication, priority: priority[0].toUpperCase() + priority.slice(1),
          ordering_provider: user.walletAddress,
          order_time: Math.floor(Date.now() / 1000), contrast,
          allergies_reviewed: Boolean(allergies.trim()),
          creatinine_checked: contrast ? creatinine !== undefined : null,
          pregnancy_checked: pregnant ? pregnant === 'no' : null,
          special_instructions: study || null, status: 'Ordered',
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Imaging order could not be saved.');
      }
      setOrders(current => [order, ...current]);
      showSuccess(t('docImaging.orderPlaced'));
      setActiveTab('orders');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Imaging order could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: ImagingStatus) => {
    const styles: Record<ImagingStatus, string> = {
      ordered: 'bg-notice-subtle text-notice-subtle-fg',
      scheduled: 'bg-surface-sunken text-content-secondary',
      'in-progress': 'bg-caution-subtle text-caution-subtle-fg',
      completed: 'bg-surface-sunken text-content-secondary',
      prelim: 'bg-surface-sunken text-content-secondary',
      final: 'bg-ok-subtle text-ok-subtle-fg'
    };
    return styles[status];
  };

  const getPriorityBadge = (p: ImagingPriority) => {
    if (p === 'stat') return 'bg-critical text-white';
    if (p === 'urgent') return 'bg-orange-500 text-white';
    return 'bg-surface-sunken text-content-secondary';
  };

  const filteredOrders = orders.filter(o => {
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    if (filterModality !== 'all' && o.modality !== filterModality) return false;
    if (searchTerm && !(o.patientName?.toLowerCase() || '').includes(searchTerm.toLowerCase())
        && !(o.study?.toLowerCase() || '').includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-700 to-gray-600 text-white p-6">
        <div className="flex items-center gap-3">
          <Camera className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docImaging.title')}</h1>
            <p className="text-slate-200">{t('docImaging.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {[{ id: 'orders', label: t('docImaging.tabOrders') }, { id: 'new', label: t('docImaging.tabNew') }, { id: 'results', label: t('docImaging.tabResults') }].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'orders' | 'new' | 'results')}
              className={`px-6 py-3 font-medium flex items-center gap-2 ${activeTab === tab.id
                ? 'text-content-secondary border-b-2 border-slate-700'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab.id === 'new' && <Plus className="w-4 h-4" />}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {/* Search & Filters */}
            <div className="bg-surface rounded-lg shadow p-4 flex gap-4 items-center flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-64">
                <Search className="w-5 h-5 text-content-muted" />
                <input
                  type="text"
                  placeholder={t('docImaging.searchPlaceholder')}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="flex-1 border rounded p-2"
                />
              </div>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="border rounded p-2"
              >
                <option value="all">{t('docImaging.allStatus')}</option>
                <option value="ordered">{t('docImaging.stOrdered')}</option>
                <option value="scheduled">{t('docImaging.stScheduled')}</option>
                <option value="in-progress">{t('docImaging.stInProgress')}</option>
                <option value="prelim">{t('docImaging.stPrelim')}</option>
                <option value="final">{t('docImaging.stFinal')}</option>
              </select>
              <select
                value={filterModality}
                onChange={e => setFilterModality(e.target.value)}
                className="border rounded p-2"
              >
                <option value="all">{t('docImaging.allModalities')}</option>
                {Object.keys(modalityLabels).map((k) => (
                  <option key={k} value={k}>{modalityLabel(k as ImagingModality)}</option>
                ))}
              </select>
            </div>

            {/* Orders List */}
            {filteredOrders.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docImaging.noOrders')}</div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map(o => (
                  <div key={o.id} className={`bg-surface rounded-lg shadow p-4 border-l-4 ${o.criticalValue ? 'border-red-500' : 'border-transparent'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{o.patientName}</h3>
                          {o.criticalValue && (
                            <span className="flex items-center gap-1 text-critical-subtle-fg text-xs font-medium">
                              <AlertCircle className="w-4 h-4" /> {t('docImaging.critical')}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-content-muted">{o.study}</p>
                        <p className="text-xs text-content-muted">
                          {t('docImaging.orderedByLine', { date: new Date(o.orderedAt).toLocaleString(), by: o.orderedBy })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityBadge(o.priority)}`}>
                          {priorityLabel(o.priority)}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs ${getStatusBadge(o.status)}`}>
                          {statusLabel(o.status)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-4 text-sm">
                      <span className="text-content-muted">{t('docImaging.modalityInline')}<strong>{modalityLabel(o.modality)}</strong></span>
                      <span className="text-content-muted">{t('docImaging.bodyPartInline')}<strong>{o.bodyPart}</strong></span>
                      {o.contrast && <span className="text-content-secondary">{t('docImaging.contrast')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'new' && (
          <div className="space-y-6">
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docImaging.patientStudy')}
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="imaging-patient" className="text-sm text-content-muted">{t('docImaging.patientRequired')}</label>
                  <select
                    id="imaging-patient"
                    value={selectedPatient}
                    onChange={e => setSelectedPatient(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docImaging.selectPlaceholder')}</option>
                    {patients.map(p => (
                      <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="imaging-modality" className="text-sm text-content-muted">{t('docImaging.modality')}</label>
                  <select
                    id="imaging-modality"
                    value={modality}
                    onChange={e => setModality(e.target.value as ImagingModality)}
                    className="w-full border rounded p-2"
                  >
                    {Object.keys(modalityLabels).map((k) => (
                      <option key={k} value={k}>{modalityLabel(k as ImagingModality)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="imaging-body-part" className="text-sm text-content-muted">{t('docImaging.bodyPart')}</label>
                  <select
                    id="imaging-body-part"
                    value={bodyPart}
                    onChange={e => setBodyPart(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    {bodyParts.map(bp => <option key={bp} value={bp}>{bp}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="imaging-laterality" className="text-sm text-content-muted">{t('docImaging.laterality')}</label>
                  <select
                    id="imaging-laterality"
                    value={laterality}
                    onChange={e => setLaterality(e.target.value as 'left' | 'right' | 'bilateral' | 'na')}
                    className="w-full border rounded p-2"
                  >
                    <option value="na">{t('docImaging.latNa')}</option>
                    <option value="left">{t('docImaging.latLeft')}</option>
                    <option value="right">{t('docImaging.latRight')}</option>
                    <option value="bilateral">{t('docImaging.latBilateral')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="imaging-priority" className="text-sm text-content-muted">{t('docImaging.priority')}</label>
                  <select
                    id="imaging-priority"
                    value={priority}
                    onChange={e => setPriority(e.target.value as ImagingPriority)}
                    className="w-full border rounded p-2"
                  >
                    <option value="routine">{t('docImaging.optRoutine')}</option>
                    <option value="urgent">{t('docImaging.optUrgent')}</option>
                    <option value="stat">{t('docImaging.optStat')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="imaging-study-name" className="text-sm text-content-muted">{t('docImaging.studyName')}</label>
                  <input
                    id="imaging-study-name"
                    type="text"
                    value={study}
                    onChange={e => setStudy(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docImaging.studyPlaceholder')}
                  />
                </div>
              </div>
              <div className="mt-4">
                <label htmlFor="imaging-clinical-indication" className="text-sm text-content-muted">{t('docImaging.clinicalIndication')}</label>
                <textarea
                  id="imaging-clinical-indication"
                  value={indication}
                  onChange={e => setIndication(e.target.value)}
                  className="w-full border rounded p-2 h-20"
                  placeholder={t('docImaging.indicationPlaceholder')}
                />
              </div>
            </div>

            {/* Safety Screening */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docImaging.safetyScreening')}</h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div className="flex items-center gap-2">
                  <input
                    id="imaging-contrast-required"
                    type="checkbox"
                    checked={contrast}
                    onChange={e => setContrast(e.target.checked)}
                  />
                  <label htmlFor="imaging-contrast-required" className="text-sm">{t('docImaging.contrastRequired')}</label>
                </div>
                <div>
                  <label htmlFor="imaging-allergies" className="text-sm text-content-muted">{t('docImaging.allergies')}</label>
                  <input
                    id="imaging-allergies"
                    type="text"
                    value={allergies}
                    onChange={e => setAllergies(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docImaging.allergiesPlaceholder')}
                  />
                </div>
                {contrast && (
                  <div>
                    <label htmlFor="imaging-creatinine" className="text-sm text-content-muted">{t('docImaging.creatinine')}</label>
                    <input
                      id="imaging-creatinine"
                      type="number"
                      step="0.1"
                      value={creatinine || ''}
                      onChange={e => setCreatinine(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full border rounded p-2"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="imaging-pregnancy-status" className="text-sm text-content-muted">{t('docImaging.pregnancyStatus')}</label>
                  <select
                    id="imaging-pregnancy-status"
                    value={pregnant}
                    onChange={e => setPregnant(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docImaging.pregNa')}</option>
                    <option value="no">{t('docImaging.pregNo')}</option>
                    <option value="yes">{t('docImaging.pregYes')}</option>
                    <option value="unknown">{t('docImaging.pregUnknown')}</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 bg-slate-700 text-white rounded-lg font-semibold hover:bg-slate-800"
            >
              {t('docImaging.submitOrder')}
            </button>
          </div>
        )}

        {activeTab === 'results' && (
          <div className="space-y-4">
            {orders.filter(o => o.status === 'final' || o.status === 'prelim').length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docImaging.noResults')}</div>
            ) : (
              orders.filter(o => o.status === 'final' || o.status === 'prelim').map(o => (
                <div key={o.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold">{o.patientName}</h3>
                      <p className="text-sm">{o.study}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${getStatusBadge(o.status)}`}>
                      {o.status === 'final' ? t('docImaging.finalReport') : t('docImaging.preliminary')}
                    </span>
                  </div>
                  {o.findings && (
                    <div className="mb-2">
                      <p className="text-sm font-medium text-content-secondary">{t('docImaging.findings')}</p>
                      <p className="text-sm text-content-muted">{o.findings}</p>
                    </div>
                  )}
                  {o.impression && (
                    <div className="border-t pt-2">
                      <p className="text-sm font-medium text-content-secondary">{t('docImaging.impression')}</p>
                      <p className="text-sm">{o.impression}</p>
                    </div>
                  )}
                  {o.radiologist && <p className="text-xs text-content-muted mt-2">{t('docImaging.readBy', { radiologist: o.radiologist })}</p>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImagingPage;
