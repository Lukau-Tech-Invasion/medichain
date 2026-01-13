import React, { useState, useEffect } from 'react';
import {
  AlertOctagon,
  Search,
  Eye,
  Clock,
  User,
  MapPin,
  Calendar,
  FileText,
  AlertTriangle,
  CheckCircle,
  Users,
  Shield,
  Printer
} from 'lucide-react';

/**
 * IncidentReportPage
 * 
 * Page for incident reporting and documentation.
 * Implements incident report form, incident list, and follow-up tracking.
 */

type IncidentType = 'fall' | 'medication-error' | 'equipment-failure' | 'security' | 'behavioral' | 'exposure' | 'other';
type IncidentSeverity = 'near-miss' | 'minor' | 'moderate' | 'major' | 'sentinel';
type IncidentStatus = 'open' | 'under-investigation' | 'pending-review' | 'closed' | 'escalated';

interface Incident {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  dateTime: Date;
  location: string;
  department: string;
  description: string;
  patientInvolved: boolean;
  patientId?: string;
  patientName?: string;
  staffInvolved: string[];
  witnesses: string[];
  immediateActions: string;
  reportedBy: string;
  reportedAt: Date;
  assignedTo?: string;
  followUpActions: { action: string; dueDate: Date; completed: boolean }[];
  rootCause?: string;
  preventiveMeasures?: string;
}

const IncidentReportPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'list' | 'new' | 'dashboard'>('list');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<IncidentType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'all'>('all');
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [formStep, setFormStep] = useState(1);

  const [formData, setFormData] = useState({
    type: 'fall' as IncidentType,
    severity: 'minor' as IncidentSeverity,
    dateTime: '',
    location: '',
    department: '',
    description: '',
    patientInvolved: false,
    patientId: '',
    staffInvolved: '',
    witnesses: '',
    immediateActions: ''
  });

  useEffect(() => {
    setIncidents([
      {
        id: 'INC-2024-00089',
        type: 'fall',
        severity: 'moderate',
        status: 'under-investigation',
        dateTime: new Date('2024-01-15T08:30:00'),
        location: 'Room 412, Bed A',
        department: 'Medical-Surgical Unit',
        description: 'Patient found on floor beside bed. States attempted to get up to use bathroom without calling for assistance. No witnessed fall.',
        patientInvolved: true,
        patientId: 'PAT-12345',
        patientName: 'Ahmed Al-Rashid',
        staffInvolved: ['Nurse Maria Santos', 'CNA James Wilson'],
        witnesses: [],
        immediateActions: 'Patient assessed for injuries. VS stable. Neuro checks initiated. MD notified. X-ray ordered for right hip.',
        reportedBy: 'Maria Santos, RN',
        reportedAt: new Date('2024-01-15T08:45:00'),
        assignedTo: 'Dr. Sarah Ahmed',
        followUpActions: [
          { action: 'Complete post-fall protocol', dueDate: new Date('2024-01-15'), completed: true },
          { action: 'Fall risk reassessment', dueDate: new Date('2024-01-16'), completed: false },
          { action: 'Family notification', dueDate: new Date('2024-01-15'), completed: true }
        ]
      },
      {
        id: 'INC-2024-00088',
        type: 'medication-error',
        severity: 'near-miss',
        status: 'closed',
        dateTime: new Date('2024-01-14T14:15:00'),
        location: 'Pharmacy',
        department: 'Pharmacy',
        description: 'Wrong dose prepared for patient. 500mg instead of 250mg. Caught during double-check before dispensing.',
        patientInvolved: true,
        patientId: 'PAT-67890',
        patientName: 'Fatima Hassan',
        staffInvolved: ['Pharmacist John Lee', 'Pharmacy Tech Susan Kim'],
        witnesses: ['Pharmacist John Lee'],
        immediateActions: 'Medication discarded. Correct dose prepared and verified. Event documented.',
        reportedBy: 'John Lee, PharmD',
        reportedAt: new Date('2024-01-14T14:30:00'),
        rootCause: 'Similar packaging between different strengths of same medication',
        preventiveMeasures: 'Tall-man lettering implemented. Storage locations separated.',
        followUpActions: [
          { action: 'Review with pharmacy staff', dueDate: new Date('2024-01-15'), completed: true },
          { action: 'Update storage protocol', dueDate: new Date('2024-01-16'), completed: true }
        ]
      },
      {
        id: 'INC-2024-00087',
        type: 'equipment-failure',
        severity: 'minor',
        status: 'pending-review',
        dateTime: new Date('2024-01-14T10:00:00'),
        location: 'ICU Bay 3',
        department: 'Intensive Care Unit',
        description: 'Cardiac monitor displaying erratic readings. Backup monitor used. Patient not affected.',
        patientInvolved: true,
        patientId: 'PAT-11223',
        patientName: 'Omar Khalil',
        staffInvolved: ['Nurse David Chen'],
        witnesses: ['Nurse David Chen', 'RT Mark Johnson'],
        immediateActions: 'Backup monitor connected. Biomedical engineering notified. Faulty monitor removed from service.',
        reportedBy: 'David Chen, RN',
        reportedAt: new Date('2024-01-14T10:15:00'),
        assignedTo: 'Biomedical Engineering',
        followUpActions: [
          { action: 'Equipment inspection', dueDate: new Date('2024-01-15'), completed: true },
          { action: 'Repair or replace decision', dueDate: new Date('2024-01-17'), completed: false }
        ]
      }
    ]);
  }, []);

  const getTypeBadge = (type: IncidentType) => {
    const config: Record<IncidentType, { bg: string; icon: React.ReactNode }> = {
      'fall': { bg: 'bg-orange-100 text-orange-700', icon: <User className="w-3 h-3" /> },
      'medication-error': { bg: 'bg-red-100 text-red-700', icon: <AlertTriangle className="w-3 h-3" /> },
      'equipment-failure': { bg: 'bg-blue-100 text-blue-700', icon: <AlertOctagon className="w-3 h-3" /> },
      'security': { bg: 'bg-purple-100 text-purple-700', icon: <Shield className="w-3 h-3" /> },
      'behavioral': { bg: 'bg-yellow-100 text-yellow-700', icon: <Users className="w-3 h-3" /> },
      'exposure': { bg: 'bg-pink-100 text-pink-700', icon: <AlertTriangle className="w-3 h-3" /> },
      'other': { bg: 'bg-gray-100 text-gray-700', icon: <FileText className="w-3 h-3" /> }
    };
    const { bg, icon } = config[type];
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${bg}`}>
        {icon}
        {type.replace('-', ' ')}
      </span>
    );
  };

  const getSeverityBadge = (severity: IncidentSeverity) => {
    const styles: Record<IncidentSeverity, string> = {
      'near-miss': 'bg-green-100 text-green-700',
      'minor': 'bg-yellow-100 text-yellow-700',
      'moderate': 'bg-orange-100 text-orange-700',
      'major': 'bg-red-100 text-red-700',
      'sentinel': 'bg-red-600 text-white'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${styles[severity]}`}>
        {severity.replace('-', ' ')}
      </span>
    );
  };

  const getStatusBadge = (status: IncidentStatus) => {
    const config: Record<IncidentStatus, { bg: string; icon: React.ReactNode }> = {
      'open': { bg: 'bg-blue-100 text-blue-700', icon: <Clock className="w-3 h-3" /> },
      'under-investigation': { bg: 'bg-yellow-100 text-yellow-700', icon: <Search className="w-3 h-3" /> },
      'pending-review': { bg: 'bg-purple-100 text-purple-700', icon: <Eye className="w-3 h-3" /> },
      'closed': { bg: 'bg-green-100 text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
      'escalated': { bg: 'bg-red-100 text-red-700', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const { bg, icon } = config[status];
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${bg}`}>
        {icon}
        {status.replace('-', ' ')}
      </span>
    );
  };

  const filteredIncidents = incidents.filter(inc => {
    const matchesSearch = inc.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          inc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (inc.patientName?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = typeFilter === 'all' || inc.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || inc.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });

  const stats = {
    open: incidents.filter(i => i.status === 'open').length,
    investigating: incidents.filter(i => i.status === 'under-investigation').length,
    thisWeek: incidents.filter(i => i.dateTime > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length,
    sentinel: incidents.filter(i => i.severity === 'sentinel').length
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-700 to-red-600 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <AlertOctagon className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Incident Reporting</h1>
        </div>
        <p className="text-rose-200">Document and track safety incidents</p>
      </div>

      {/* Stats Bar */}
      <div className="bg-white border-b px-6 py-4">
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.open}</p>
            <p className="text-xs text-gray-500">Open</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-yellow-600">{stats.investigating}</p>
            <p className="text-xs text-gray-500">Investigating</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-600">{stats.thisWeek}</p>
            <p className="text-xs text-gray-500">This Week</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{stats.sentinel}</p>
            <p className="text-xs text-gray-500">Sentinel</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {(['list', 'new', 'dashboard'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium capitalize ${
                activeTab === tab ? 'text-rose-700 border-b-2 border-rose-700' : 'text-gray-500'
              }`}
            >
              {tab === 'new' ? 'Report Incident' : tab === 'list' ? 'All Incidents' : 'Dashboard'}
            </button>
          ))}
        </div>
      </div>

      {/* List Tab */}
      {activeTab === 'list' && (
        <div className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search incidents..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="px-4 py-2 border rounded-lg"
            >
              <option value="all">All Types</option>
              <option value="fall">Fall</option>
              <option value="medication-error">Medication Error</option>
              <option value="equipment-failure">Equipment Failure</option>
              <option value="security">Security</option>
              <option value="behavioral">Behavioral</option>
              <option value="exposure">Exposure</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-4 py-2 border rounded-lg"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="under-investigation">Under Investigation</option>
              <option value="pending-review">Pending Review</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div className="space-y-4">
            {filteredIncidents.map(incident => (
              <div key={incident.id} className="bg-white rounded-lg shadow border p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{incident.id}</span>
                      {getTypeBadge(incident.type)}
                      {getSeverityBadge(incident.severity)}
                      {getStatusBadge(incident.status)}
                    </div>
                    <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {incident.dateTime.toLocaleString()}
                      <MapPin className="w-4 h-4 ml-2" />
                      {incident.location}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedIncident(incident)} className="p-2 hover:bg-gray-100 rounded-lg">
                      <Eye className="w-5 h-5 text-gray-600" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded-lg">
                      <Printer className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </div>

                <p className="text-gray-700 mb-4 line-clamp-2">{incident.description}</p>

                {incident.patientInvolved && (
                  <div className="bg-blue-50 rounded-lg p-3 mb-4 flex items-center gap-2">
                    <User className="w-4 h-4 text-blue-600" />
                    <span className="text-sm text-blue-700">Patient: {incident.patientName} ({incident.patientId})</span>
                  </div>
                )}

                {incident.followUpActions.length > 0 && (
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Follow-up Actions:</p>
                    <div className="flex gap-2 flex-wrap">
                      {incident.followUpActions.map((action, idx) => (
                        <span
                          key={idx}
                          className={`px-2 py-1 rounded text-xs ${
                            action.completed ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {action.completed ? <CheckCircle className="w-3 h-3 inline mr-1" /> : <Clock className="w-3 h-3 inline mr-1" />}
                          {action.action}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Incident Tab */}
      {activeTab === 'new' && (
        <div className="p-6">
          <div className="bg-white rounded-lg shadow p-6 max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Report New Incident</h2>
              <div className="flex items-center gap-2">
                {[1, 2, 3].map(step => (
                  <div
                    key={step}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      formStep === step ? 'bg-rose-600 text-white' : formStep > step ? 'bg-green-500 text-white' : 'bg-gray-200'
                    }`}
                  >
                    {formStep > step ? <CheckCircle className="w-4 h-4" /> : step}
                  </div>
                ))}
              </div>
            </div>

            {formStep === 1 && (
              <div className="space-y-4">
                <h3 className="font-medium text-gray-900">Incident Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Incident Type *</label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as IncidentType })}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="fall">Patient Fall</option>
                      <option value="medication-error">Medication Error</option>
                      <option value="equipment-failure">Equipment Failure</option>
                      <option value="security">Security Incident</option>
                      <option value="behavioral">Behavioral Incident</option>
                      <option value="exposure">Exposure/Needlestick</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Severity *</label>
                    <select
                      value={formData.severity}
                      onChange={(e) => setFormData({ ...formData, severity: e.target.value as IncidentSeverity })}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="near-miss">Near Miss</option>
                      <option value="minor">Minor</option>
                      <option value="moderate">Moderate</option>
                      <option value="major">Major</option>
                      <option value="sentinel">Sentinel Event</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Date & Time *</label>
                    <input type="datetime-local" className="w-full border rounded-lg px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Department *</label>
                    <select className="w-full border rounded-lg px-3 py-2">
                      <option>Emergency Department</option>
                      <option>Medical-Surgical Unit</option>
                      <option>ICU</option>
                      <option>Pharmacy</option>
                      <option>Radiology</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Exact Location *</label>
                  <input type="text" className="w-full border rounded-lg px-3 py-2" placeholder="e.g., Room 412, Bed A" />
                </div>
              </div>
            )}

            {formStep === 2 && (
              <div className="space-y-4">
                <h3 className="font-medium text-gray-900">Description & People Involved</h3>
                <div>
                  <label className="block text-sm font-medium mb-1">Description of Incident *</label>
                  <textarea className="w-full border rounded-lg px-3 py-2 h-32" placeholder="Describe what happened..." />
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    checked={formData.patientInvolved}
                    onChange={(e) => setFormData({ ...formData, patientInvolved: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <span className="font-medium">Patient Involved</span>
                </div>
                {formData.patientInvolved && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Patient ID</label>
                    <input type="text" className="w-full border rounded-lg px-3 py-2" placeholder="Search patient..." />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Staff Involved</label>
                  <input type="text" className="w-full border rounded-lg px-3 py-2" placeholder="Names of staff involved" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Witnesses</label>
                  <input type="text" className="w-full border rounded-lg px-3 py-2" placeholder="Names of witnesses" />
                </div>
              </div>
            )}

            {formStep === 3 && (
              <div className="space-y-4">
                <h3 className="font-medium text-gray-900">Immediate Actions & Review</h3>
                <div>
                  <label className="block text-sm font-medium mb-1">Immediate Actions Taken *</label>
                  <textarea className="w-full border rounded-lg px-3 py-2 h-32" placeholder="What actions were taken immediately?" />
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                      <p className="font-medium">Reporting Declaration</p>
                      <p>I certify that this report is accurate to the best of my knowledge.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between mt-6 pt-6 border-t">
              <button
                onClick={() => setFormStep(Math.max(1, formStep - 1))}
                className={`px-4 py-2 border rounded-lg ${formStep === 1 ? 'invisible' : ''}`}
              >
                Back
              </button>
              {formStep < 3 ? (
                <button onClick={() => setFormStep(formStep + 1)} className="px-6 py-2 bg-rose-600 text-white rounded-lg font-medium">
                  Continue
                </button>
              ) : (
                <button className="px-6 py-2 bg-rose-600 text-white rounded-lg font-medium">
                  Submit Report
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-semibold mb-4">Incidents by Type (Last 30 Days)</h3>
              <div className="space-y-3">
                {['fall', 'medication-error', 'equipment-failure', 'security'].map(type => (
                  <div key={type} className="flex items-center gap-3">
                    <div className="w-24 text-sm capitalize">{type.replace('-', ' ')}</div>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.random() * 80 + 20}%` }} />
                    </div>
                    <div className="w-8 text-sm text-right">{Math.floor(Math.random() * 10 + 1)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-semibold mb-4">Severity Distribution</h3>
              <div className="flex justify-around">
                {['near-miss', 'minor', 'moderate', 'major'].map(sev => (
                  <div key={sev} className="text-center">
                    <div className="text-2xl font-bold text-gray-700">{Math.floor(Math.random() * 10 + 1)}</div>
                    <div className="text-xs text-gray-500 capitalize">{sev.replace('-', ' ')}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">{selectedIncident.id}</h2>
              <button onClick={() => setSelectedIncident(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-2 flex-wrap">
                {getTypeBadge(selectedIncident.type)}
                {getSeverityBadge(selectedIncident.severity)}
                {getStatusBadge(selectedIncident.status)}
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Description</h4>
                <p className="text-gray-700">{selectedIncident.description}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Immediate Actions</h4>
                <p className="text-gray-700">{selectedIncident.immediateActions}</p>
              </div>
              {selectedIncident.rootCause && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium mb-2">Root Cause</h4>
                  <p className="text-gray-700">{selectedIncident.rootCause}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IncidentReportPage;
