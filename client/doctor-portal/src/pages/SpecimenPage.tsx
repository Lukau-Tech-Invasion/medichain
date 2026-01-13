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
  Droplet
} from 'lucide-react';

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
  const [activeTab, setActiveTab] = useState<'specimens' | 'add' | 'tracking'>('specimens');
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [selectedSpecimen, setSelectedSpecimen] = useState<Specimen | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<CollectionStatus | 'all'>('all');

  useEffect(() => {
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

    setSpecimens([
      {
        id: 'SPEC-001',
        patientId: 'PAT-001',
        patientName: 'Abdullah Al-Mansouri',
        mrn: '123456',
        specimenType: 'blood',
        testOrdered: 'Complete Blood Count, BMP',
        status: 'collected',
        priority: 'stat',
        orderedBy: 'Dr. Khalid Rahman',
        orderedAt: hoursAgo(2),
        collectedBy: 'Nurse Aisha',
        collectedAt: hoursAgo(1.5),
        notes: 'Difficult venous access, collected from left AC'
      },
      {
        id: 'SPEC-002',
        patientId: 'PAT-002',
        patientName: 'Fatima Hassan',
        mrn: '234567',
        specimenType: 'urine',
        testOrdered: 'Urinalysis, Urine Culture',
        status: 'pending',
        priority: 'urgent',
        orderedBy: 'Dr. Sarah Ahmed',
        orderedAt: hoursAgo(1),
        notes: 'Clean catch specimen required'
      },
      {
        id: 'SPEC-003',
        patientId: 'PAT-003',
        patientName: 'Omar Khalil',
        mrn: '345678',
        specimenType: 'blood',
        testOrdered: 'Troponin, Pro-BNP',
        status: 'processing',
        priority: 'stat',
        orderedBy: 'Dr. Yusuf Nasser',
        orderedAt: hoursAgo(3),
        collectedBy: 'Nurse Mohammed',
        collectedAt: hoursAgo(2.5),
        receivedAt: hoursAgo(2)
      },
      {
        id: 'SPEC-004',
        patientId: 'PAT-004',
        patientName: 'Mariam Abdullah',
        mrn: '456789',
        specimenType: 'swab',
        testOrdered: 'Throat Culture, Rapid Strep',
        status: 'completed',
        priority: 'routine',
        orderedBy: 'Dr. Layla Hassan',
        orderedAt: hoursAgo(24),
        collectedBy: 'Nurse Fatima',
        collectedAt: hoursAgo(23),
        receivedAt: hoursAgo(22)
      }
    ]);
  }, []);

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
    const s = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {status.replace('-', ' ')}
      </span>
    );
  };

  const getPriorityBadge = (priority: Priority) => {
    const colors: Record<Priority, string> = {
      'routine': 'bg-gray-100 text-gray-600',
      'urgent': 'bg-orange-100 text-orange-700',
      'stat': 'bg-red-100 text-red-700'
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${colors[priority]}`}>
        {priority}
      </span>
    );
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
          <h1 className="text-2xl font-bold">Specimen Collection</h1>
        </div>
        <p className="text-teal-100">Track and manage laboratory specimens</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{specimens.length}</p>
          <p className="text-xs text-gray-500">Total</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
          <p className="text-xs text-gray-500">Pending</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{statCount}</p>
          <p className="text-xs text-gray-500">STAT Orders</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {(['specimens', 'add', 'tracking'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium capitalize ${
                activeTab === tab ? 'text-teal-700 border-b-2 border-teal-700' : 'text-gray-500'
              }`}
            >
              {tab === 'specimens' ? 'All Specimens' : tab === 'add' ? 'Collect Specimen' : 'Tracking'}
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
                placeholder="Search specimen or patient..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as CollectionStatus | 'all')}
              className="border rounded-lg px-3 py-2"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="collected">Collected</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
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
                      <p className="text-sm text-gray-500">MRN: {specimen.mrn} • {specimen.id}</p>
                    </div>
                  </div>
                  {getStatusBadge(specimen.status)}
                </div>

                <div className="bg-gray-50 rounded p-2 mb-2">
                  <p className="text-sm"><strong>Test:</strong> {specimen.testOrdered}</p>
                  <p className="text-sm"><strong>Type:</strong> {specimen.specimenType}</p>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    <span>Ordered by: {specimen.orderedBy}</span>
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
            <h2 className="text-lg font-semibold mb-4">Collect Specimen</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Patient *</label>
                <select className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select patient...</option>
                  {specimens.map(s => (
                    <option key={s.patientId} value={s.patientId}>{s.patientName} - {s.mrn}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Specimen Type *</label>
                  <select className="w-full border rounded-lg px-3 py-2">
                    <option value="blood">Blood</option>
                    <option value="urine">Urine</option>
                    <option value="stool">Stool</option>
                    <option value="swab">Swab</option>
                    <option value="tissue">Tissue</option>
                    <option value="csf">CSF</option>
                    <option value="sputum">Sputum</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Priority *</label>
                  <select className="w-full border rounded-lg px-3 py-2">
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="stat">STAT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Tests Ordered *</label>
                <input type="text" className="w-full border rounded-lg px-3 py-2" placeholder="CBC, BMP, etc." />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Collection Site</label>
                <input type="text" className="w-full border rounded-lg px-3 py-2" placeholder="e.g., Left AC, midstream" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea className="w-full border rounded-lg px-3 py-2" rows={2} placeholder="Collection notes..." />
              </div>

              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                <p className="text-sm text-teal-700 font-medium mb-2">Collection Checklist:</p>
                <div className="space-y-1">
                  {['Verify patient ID', 'Check specimen requirements', 'Label specimen at bedside', 'Document collection time'].map((item, idx) => (
                    <label key={idx} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="w-4 h-4" />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button className="w-full py-3 bg-teal-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" /> Record Collection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tracking Tab */}
      {activeTab === 'tracking' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Specimen Tracking</h2>
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

      {/* Specimen Detail Modal */}
      {selectedSpecimen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getSpecimenIcon(selectedSpecimen.specimenType)}
                <div>
                  <h2 className="text-xl font-semibold">{selectedSpecimen.id}</h2>
                  <p className="text-sm text-gray-500">{selectedSpecimen.specimenType} specimen</p>
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
                <h3 className="font-medium mb-2">Patient Information</h3>
                <p><strong>Name:</strong> {selectedSpecimen.patientName}</p>
                <p><strong>MRN:</strong> {selectedSpecimen.mrn}</p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">Test Details</h3>
                <p><strong>Tests Ordered:</strong> {selectedSpecimen.testOrdered}</p>
                <p><strong>Ordered by:</strong> {selectedSpecimen.orderedBy}</p>
                <p><strong>Ordered at:</strong> {selectedSpecimen.orderedAt.toLocaleString()}</p>
              </div>

              {selectedSpecimen.collectedBy && (
                <div className="bg-blue-50 rounded-lg p-4">
                  <h3 className="font-medium mb-2">Collection Details</h3>
                  <p><strong>Collected by:</strong> {selectedSpecimen.collectedBy}</p>
                  <p><strong>Collected at:</strong> {selectedSpecimen.collectedAt?.toLocaleString()}</p>
                  {selectedSpecimen.notes && <p><strong>Notes:</strong> {selectedSpecimen.notes}</p>}
                </div>
              )}

              {selectedSpecimen.status === 'pending' && (
                <button className="w-full py-3 bg-teal-600 text-white rounded-lg font-medium">
                  Mark as Collected
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
