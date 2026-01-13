import { useState, useEffect } from 'react';
import { Camera, User, AlertCircle, Search, Plus } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients } from '@medichain/shared';
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
  const { user } = useAuthStore();
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

  const handleSubmit = () => {
    if (!selectedPatient || !indication) {
      alert('Please fill required fields');
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const order: ImagingOrder = {
      id: `IMG-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      modality, study: study || `${modalityLabels[modality]} ${bodyPart}`,
      bodyPart, laterality, indication, priority, status: 'ordered',
      orderedBy: user?.username || 'Unknown',
      orderedAt: new Date().toISOString(),
      contrast, allergies, creatinine, pregnant, criticalValue: false
    };
    setOrders([order, ...orders]);
    alert('Imaging order placed!');
    setActiveTab('orders');
  };

  const getStatusBadge = (status: ImagingStatus) => {
    const styles: Record<ImagingStatus, string> = {
      ordered: 'bg-blue-100 text-blue-700',
      scheduled: 'bg-purple-100 text-purple-700',
      'in-progress': 'bg-yellow-100 text-yellow-700',
      completed: 'bg-gray-100 text-gray-700',
      prelim: 'bg-orange-100 text-orange-700',
      final: 'bg-green-100 text-green-700'
    };
    return styles[status];
  };

  const getPriorityBadge = (p: ImagingPriority) => {
    if (p === 'stat') return 'bg-red-600 text-white';
    if (p === 'urgent') return 'bg-orange-500 text-white';
    return 'bg-gray-200 text-gray-700';
  };

  const filteredOrders = orders.filter(o => {
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    if (filterModality !== 'all' && o.modality !== filterModality) return false;
    if (searchTerm && !o.patientName.toLowerCase().includes(searchTerm.toLowerCase())
        && !o.study.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-700 to-gray-600 text-white p-6">
        <div className="flex items-center gap-3">
          <Camera className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">Imaging Studies</h1>
            <p className="text-slate-200">Order and view diagnostic imaging</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {[{ id: 'orders', label: 'Orders' }, { id: 'new', label: 'New Order' }, { id: 'results', label: 'Results' }].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'orders' | 'new' | 'results')}
              className={`px-6 py-3 font-medium flex items-center gap-2 ${activeTab === tab.id
                ? 'text-slate-700 border-b-2 border-slate-700'
                : 'text-gray-500 hover:text-gray-700'}`}
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
            <div className="bg-white rounded-lg shadow p-4 flex gap-4 items-center flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-64">
                <Search className="w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search patient or study..."
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
                <option value="all">All Status</option>
                <option value="ordered">Ordered</option>
                <option value="scheduled">Scheduled</option>
                <option value="in-progress">In Progress</option>
                <option value="prelim">Preliminary</option>
                <option value="final">Final</option>
              </select>
              <select
                value={filterModality}
                onChange={e => setFilterModality(e.target.value)}
                className="border rounded p-2"
              >
                <option value="all">All Modalities</option>
                {Object.entries(modalityLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Orders List */}
            {filteredOrders.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No imaging orders found</div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map(o => (
                  <div key={o.id} className={`bg-white rounded-lg shadow p-4 border-l-4 ${o.criticalValue ? 'border-red-500' : 'border-transparent'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{o.patientName}</h3>
                          {o.criticalValue && (
                            <span className="flex items-center gap-1 text-red-600 text-xs font-medium">
                              <AlertCircle className="w-4 h-4" /> Critical
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">{o.study}</p>
                        <p className="text-xs text-gray-500">
                          Ordered: {new Date(o.orderedAt).toLocaleString()} by {o.orderedBy}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityBadge(o.priority)}`}>
                          {o.priority.toUpperCase()}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs ${getStatusBadge(o.status)}`}>
                          {o.status}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-4 text-sm">
                      <span className="text-gray-500">Modality: <strong>{modalityLabels[o.modality]}</strong></span>
                      <span className="text-gray-500">Body Part: <strong>{o.bodyPart}</strong></span>
                      {o.contrast && <span className="text-orange-600">Contrast</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'new' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> Patient & Study
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-gray-600">Patient *</label>
                  <select
                    value={selectedPatient}
                    onChange={e => setSelectedPatient(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">Select...</option>
                    {patients.map(p => (
                      <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Modality</label>
                  <select
                    value={modality}
                    onChange={e => setModality(e.target.value as ImagingModality)}
                    className="w-full border rounded p-2"
                  >
                    {Object.entries(modalityLabels).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Body Part</label>
                  <select
                    value={bodyPart}
                    onChange={e => setBodyPart(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    {bodyParts.map(bp => <option key={bp} value={bp}>{bp}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Laterality</label>
                  <select
                    value={laterality}
                    onChange={e => setLaterality(e.target.value as 'left' | 'right' | 'bilateral' | 'na')}
                    className="w-full border rounded p-2"
                  >
                    <option value="na">N/A</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="bilateral">Bilateral</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as ImagingPriority)}
                    className="w-full border rounded p-2"
                  >
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="stat">STAT</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Study Name (optional)</label>
                  <input
                    type="text"
                    value={study}
                    onChange={e => setStudy(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., CT Abdomen/Pelvis with contrast"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="text-sm text-gray-600">Clinical Indication *</label>
                <textarea
                  value={indication}
                  onChange={e => setIndication(e.target.value)}
                  className="w-full border rounded p-2 h-20"
                  placeholder="Reason for study..."
                />
              </div>
            </div>

            {/* Safety Screening */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Safety Screening</h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={contrast}
                    onChange={e => setContrast(e.target.checked)}
                  />
                  <label className="text-sm">Contrast Required</label>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Allergies</label>
                  <input
                    type="text"
                    value={allergies}
                    onChange={e => setAllergies(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., Iodine"
                  />
                </div>
                {contrast && (
                  <div>
                    <label className="text-sm text-gray-600">Creatinine</label>
                    <input
                      type="number"
                      step="0.1"
                      value={creatinine || ''}
                      onChange={e => setCreatinine(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full border rounded p-2"
                    />
                  </div>
                )}
                <div>
                  <label className="text-sm text-gray-600">Pregnancy Status</label>
                  <select
                    value={pregnant}
                    onChange={e => setPregnant(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">N/A</option>
                    <option value="no">Not Pregnant</option>
                    <option value="yes">Pregnant</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-slate-700 text-white rounded-lg font-semibold hover:bg-slate-800"
            >
              Submit Imaging Order
            </button>
          </div>
        )}

        {activeTab === 'results' && (
          <div className="space-y-4">
            {orders.filter(o => o.status === 'final' || o.status === 'prelim').length === 0 ? (
              <div className="text-center py-8 text-gray-500">No imaging results available</div>
            ) : (
              orders.filter(o => o.status === 'final' || o.status === 'prelim').map(o => (
                <div key={o.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold">{o.patientName}</h3>
                      <p className="text-sm">{o.study}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${getStatusBadge(o.status)}`}>
                      {o.status === 'final' ? 'Final Report' : 'Preliminary'}
                    </span>
                  </div>
                  {o.findings && (
                    <div className="mb-2">
                      <p className="text-sm font-medium text-gray-700">Findings:</p>
                      <p className="text-sm text-gray-600">{o.findings}</p>
                    </div>
                  )}
                  {o.impression && (
                    <div className="border-t pt-2">
                      <p className="text-sm font-medium text-gray-700">Impression:</p>
                      <p className="text-sm">{o.impression}</p>
                    </div>
                  )}
                  {o.radiologist && <p className="text-xs text-gray-500 mt-2">Read by: {o.radiologist}</p>}
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
