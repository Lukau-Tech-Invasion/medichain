import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createMci } from '@medichain/shared';
import {
  AlertTriangle,
  Users,
  Clock,
  Save,
  Plus,
  Trash2,
  MapPin,
  Tag,
  Activity,
  UserPlus,
  RefreshCw,
  FileText,
  Building2,
  Phone,
  Radio,
  Truck
} from 'lucide-react';

type TriageCategory = 'immediate' | 'delayed' | 'minor' | 'expectant' | 'deceased';

interface MCIPatient {
  id: string;
  tagNumber: string;
  category: TriageCategory;
  age: string;
  gender: string;
  chiefComplaint: string;
  injuries: string[];
  vitals: {
    respiratoryRate: number;
    pulse: number;
    capRefill: number;
    mentalStatus: string;
  };
  location: string;
  destination: string;
  triageTime: string;
  transportTime?: string;
  notes: string;
}

interface IncidentInfo {
  incidentName: string;
  incidentType: string;
  location: string;
  startTime: string;
  commandPost: string;
  incidentCommander: string;
  contactNumber: string;
  estimatedCasualties: number;
  resourcesRequested: string[];
}

export default function MCIPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'triage' | 'summary' | 'resources'>('triage');

  // Incident Information
  const [incident, setIncident] = useState<IncidentInfo>({
    incidentName: '',
    incidentType: '',
    location: '',
    startTime: new Date().toISOString().slice(0, 16),
    commandPost: '',
    incidentCommander: '',
    contactNumber: '',
    estimatedCasualties: 0,
    resourcesRequested: []
  });

  // MCI Patients
  const [patients, setPatients] = useState<MCIPatient[]>([]);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [_editingPatient, _setEditingPatient] = useState<MCIPatient | null>(null);
  const [tagCounter, setTagCounter] = useState(1);

  // New Patient Form
  const [newPatient, setNewPatient] = useState<Partial<MCIPatient>>({
    category: 'immediate',
    age: '',
    gender: 'unknown',
    chiefComplaint: '',
    injuries: [],
    vitals: {
      respiratoryRate: 16,
      pulse: 80,
      capRefill: 2,
      mentalStatus: 'alert'
    },
    location: '',
    destination: '',
    notes: ''
  });

  const triageCategories: { value: TriageCategory; label: string; color: string; bgColor: string; description: string }[] = [
    { value: 'immediate', label: 'IMMEDIATE', color: 'text-red-700', bgColor: 'bg-red-500', description: 'Red Tag - Life threatening, immediate intervention needed' },
    { value: 'delayed', label: 'DELAYED', color: 'text-yellow-700', bgColor: 'bg-yellow-500', description: 'Yellow Tag - Serious but can wait 1-2 hours' },
    { value: 'minor', label: 'MINOR', color: 'text-green-700', bgColor: 'bg-green-500', description: 'Green Tag - Walking wounded, minor injuries' },
    { value: 'expectant', label: 'EXPECTANT', color: 'text-gray-700', bgColor: 'bg-gray-500', description: 'Gray/Blue Tag - Survival unlikely, comfort care only' },
    { value: 'deceased', label: 'DECEASED', color: 'text-black', bgColor: 'bg-black', description: 'Black Tag - Dead or non-survivable injuries' }
  ];

  const incidentTypes = [
    'Motor Vehicle Accident', 'Mass Shooting', 'Explosion', 'Building Collapse',
    'Chemical Spill', 'Fire', 'Natural Disaster', 'Train Derailment',
    'Plane Crash', 'Terrorist Attack', 'Crowd Crush', 'Other'
  ];

  const resourceOptions = [
    'Additional Ambulances', 'Fire Department', 'Hazmat Team', 'Search & Rescue',
    'Helicopter/Air Ambulance', 'Law Enforcement', 'Red Cross', 'Medical Examiner',
    'Crisis Counseling Team', 'Blood Bank', 'Additional Medical Staff'
  ];

  const commonInjuries = [
    'Laceration', 'Fracture', 'Burn', 'Crush Injury', 'Head Injury',
    'Chest Trauma', 'Abdominal Trauma', 'Spinal Injury', 'Amputation',
    'Smoke Inhalation', 'Chemical Exposure', 'Internal Bleeding'
  ];

  // START Triage Algorithm
  const calculateSTARTCategory = (vitals: MCIPatient['vitals']): TriageCategory => {
    // Can they walk? → Minor (Green)
    // (We assume non-ambulatory if triaging)
    
    // Are they breathing?
    if (vitals.respiratoryRate === 0) {
      // Position airway - still not breathing → Deceased (Black)
      return 'deceased';
    }
    
    // RR > 30 → Immediate (Red)
    if (vitals.respiratoryRate > 30) {
      return 'immediate';
    }
    
    // Cap refill > 2 seconds → Immediate (Red)
    if (vitals.capRefill > 2) {
      return 'immediate';
    }
    
    // No radial pulse → Immediate (Red)
    if (vitals.pulse === 0 || vitals.pulse > 120) {
      return 'immediate';
    }
    
    // Mental status - not following commands → Immediate (Red)
    if (vitals.mentalStatus === 'unresponsive' || vitals.mentalStatus === 'confused') {
      return 'immediate';
    }
    
    // All criteria met → Delayed (Yellow)
    return 'delayed';
  };

  const addPatient = () => {
    const tagNum = `MCI-${tagCounter.toString().padStart(4, '0')}`;
    const category = calculateSTARTCategory(newPatient.vitals!);
    
    const patient: MCIPatient = {
      id: `P-${Date.now()}`,
      tagNumber: tagNum,
      category,
      age: newPatient.age || 'Unknown',
      gender: newPatient.gender || 'unknown',
      chiefComplaint: newPatient.chiefComplaint || '',
      injuries: newPatient.injuries || [],
      vitals: newPatient.vitals!,
      location: newPatient.location || '',
      destination: newPatient.destination || '',
      triageTime: new Date().toISOString(),
      notes: newPatient.notes || ''
    };

    setPatients(prev => [...prev, patient]);
    setTagCounter(prev => prev + 1);
    setShowAddPatient(false);
    setNewPatient({
      category: 'immediate',
      age: '',
      gender: 'unknown',
      chiefComplaint: '',
      injuries: [],
      vitals: { respiratoryRate: 16, pulse: 80, capRefill: 2, mentalStatus: 'alert' },
      location: '',
      destination: '',
      notes: ''
    });
  };

  const updatePatientCategory = (patientId: string, category: TriageCategory) => {
    setPatients(prev => prev.map(p => 
      p.id === patientId ? { ...p, category } : p
    ));
  };

  const markTransported = (patientId: string, destination: string) => {
    setPatients(prev => prev.map(p => 
      p.id === patientId ? { ...p, destination, transportTime: new Date().toISOString() } : p
    ));
  };

  const removePatient = (patientId: string) => {
    setPatients(prev => prev.filter(p => p.id !== patientId));
  };

  const getCategoryCounts = () => {
    return triageCategories.reduce((acc, cat) => {
      acc[cat.value] = patients.filter(p => p.category === cat.value).length;
      return acc;
    }, {} as Record<TriageCategory, number>);
  };

  const counts = getCategoryCounts();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incident.incidentName) {
      setError('Please provide an incident name');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const mciData = {
        mci_id: `MCI-${Date.now()}`,
        incident: {
          ...incident,
          total_patients: patients.length,
          category_counts: counts
        },
        patients: patients.map(p => ({
          ...p,
          documented_by: user?.userId
        })),
        documented_by: user?.userId || 'unknown',
        documented_at: Math.floor(Date.now() / 1000)
      };

      await createMci(mciData);
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save MCI data. Please try again.');
      console.error('Failed to save MCI data', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header - Alert Banner */}
        <div className="bg-gradient-to-r from-red-700 to-orange-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full animate-pulse">
                <AlertTriangle className="h-10 w-10 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">MASS CASUALTY INCIDENT</h1>
                <p className="text-orange-100">START Triage Protocol Active</p>
              </div>
            </div>
            <div className="text-right text-white">
              <p className="text-sm opacity-75">Total Patients</p>
              <p className="text-4xl font-bold">{patients.length}</p>
            </div>
          </div>
        </div>

        {/* Category Summary Bar */}
        <div className="grid grid-cols-5 gap-2 mb-6">
          {triageCategories.map(cat => (
            <div key={cat.value} className={`${cat.bgColor} rounded-lg p-4 text-center`}>
              <p className="text-white text-4xl font-bold">{counts[cat.value] || 0}</p>
              <p className="text-white/90 text-sm font-medium">{cat.label}</p>
            </div>
          ))}
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center">
            <Activity className="h-5 w-5 mr-2" />
            MCI data saved successfully! Redirecting...
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-gray-800 rounded-t-lg">
          <div className="flex space-x-1 p-1">
            {[
              { id: 'triage', label: 'Triage Patients', icon: Users },
              { id: 'summary', label: 'Incident Info', icon: FileText },
              { id: 'resources', label: 'Resources', icon: Truck }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-lg font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-white text-gray-900'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="bg-white rounded-b-lg shadow-lg">
            {/* Triage Tab */}
            {activeTab === 'triage' && (
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Patient Triage List</h2>
                  <button
                    type="button"
                    onClick={() => setShowAddPatient(true)}
                    className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  >
                    <UserPlus className="h-5 w-5" />
                    <span>Add Patient</span>
                  </button>
                </div>

                {/* Add Patient Form */}
                {showAddPatient && (
                  <div className="mb-6 p-6 bg-gray-50 rounded-lg border-2 border-blue-300">
                    <h3 className="text-lg font-bold mb-4 flex items-center">
                      <Tag className="h-5 w-5 mr-2 text-blue-500" />
                      New Patient - Tag #{tagCounter.toString().padStart(4, '0')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Quick Vitals for START */}
                      <div className="md:col-span-3 bg-yellow-50 p-4 rounded-lg">
                        <p className="font-medium text-yellow-800 mb-3">START Triage Vitals</p>
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Respiratory Rate</label>
                            <input
                              type="number"
                              value={newPatient.vitals?.respiratoryRate}
                              onChange={(e) => setNewPatient({
                                ...newPatient,
                                vitals: { ...newPatient.vitals!, respiratoryRate: parseInt(e.target.value) }
                              })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Radial Pulse</label>
                            <input
                              type="number"
                              value={newPatient.vitals?.pulse}
                              onChange={(e) => setNewPatient({
                                ...newPatient,
                                vitals: { ...newPatient.vitals!, pulse: parseInt(e.target.value) }
                              })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Cap Refill (sec)</label>
                            <input
                              type="number"
                              value={newPatient.vitals?.capRefill}
                              onChange={(e) => setNewPatient({
                                ...newPatient,
                                vitals: { ...newPatient.vitals!, capRefill: parseInt(e.target.value) }
                              })}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Mental Status</label>
                            <select
                              value={newPatient.vitals?.mentalStatus}
                              onChange={(e) => setNewPatient({
                                ...newPatient,
                                vitals: { ...newPatient.vitals!, mentalStatus: e.target.value }
                              })}
                              className="w-full p-2 border rounded"
                            >
                              <option value="alert">Alert & Following Commands</option>
                              <option value="confused">Confused</option>
                              <option value="unresponsive">Unresponsive</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                        <input
                          type="text"
                          value={newPatient.age}
                          onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
                          placeholder="e.g., Adult, ~30, Pediatric"
                          className="w-full p-2 border rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                        <select
                          value={newPatient.gender}
                          onChange={(e) => setNewPatient({ ...newPatient, gender: e.target.value })}
                          className="w-full p-2 border rounded"
                        >
                          <option value="unknown">Unknown</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Location Found</label>
                        <input
                          type="text"
                          value={newPatient.location}
                          onChange={(e) => setNewPatient({ ...newPatient, location: e.target.value })}
                          placeholder="e.g., Zone A, Vehicle 3"
                          className="w-full p-2 border rounded"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Chief Complaint / Injuries</label>
                        <input
                          type="text"
                          value={newPatient.chiefComplaint}
                          onChange={(e) => setNewPatient({ ...newPatient, chiefComplaint: e.target.value })}
                          placeholder="Main injury or complaint"
                          className="w-full p-2 border rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Injuries</label>
                        <div className="flex flex-wrap gap-1">
                          {commonInjuries.slice(0, 6).map(injury => (
                            <button
                              key={injury}
                              type="button"
                              onClick={() => {
                                const injuries = newPatient.injuries || [];
                                if (injuries.includes(injury)) {
                                  setNewPatient({ ...newPatient, injuries: injuries.filter(i => i !== injury) });
                                } else {
                                  setNewPatient({ ...newPatient, injuries: [...injuries, injury] });
                                }
                              }}
                              className={`text-xs px-2 py-1 rounded ${
                                newPatient.injuries?.includes(injury)
                                  ? 'bg-red-500 text-white'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {injury}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end space-x-3 mt-4">
                      <button
                        type="button"
                        onClick={() => setShowAddPatient(false)}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={addPatient}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add & Tag Patient
                      </button>
                    </div>
                  </div>
                )}

                {/* Patient List by Category */}
                {triageCategories.map(cat => {
                  const categoryPatients = patients.filter(p => p.category === cat.value);
                  if (categoryPatients.length === 0) return null;
                  
                  return (
                    <div key={cat.value} className="mb-6">
                      <div className={`${cat.bgColor} text-white px-4 py-2 rounded-t-lg flex items-center justify-between`}>
                        <span className="font-bold">{cat.label} ({categoryPatients.length})</span>
                        <span className="text-sm opacity-75">{cat.description}</span>
                      </div>
                      <div className="bg-gray-50 rounded-b-lg border border-t-0">
                        {categoryPatients.map(patient => (
                          <div key={patient.id} className="p-4 border-b last:border-b-0 flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <div className={`${cat.bgColor} text-white px-3 py-1 rounded font-mono font-bold`}>
                                {patient.tagNumber}
                              </div>
                              <div>
                                <p className="font-medium">
                                  {patient.age} {patient.gender} - {patient.chiefComplaint || 'Unknown complaint'}
                                </p>
                                <p className="text-sm text-gray-500">
                                  RR: {patient.vitals.respiratoryRate} | Pulse: {patient.vitals.pulse} | 
                                  Cap Refill: {patient.vitals.capRefill}s | {patient.vitals.mentalStatus}
                                </p>
                                {patient.location && (
                                  <p className="text-xs text-gray-400 flex items-center mt-1">
                                    <MapPin className="h-3 w-3 mr-1" /> {patient.location}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {/* Re-triage buttons */}
                              <div className="flex space-x-1">
                                {triageCategories.filter(c => c.value !== patient.category).map(c => (
                                  <button
                                    key={c.value}
                                    type="button"
                                    onClick={() => updatePatientCategory(patient.id, c.value)}
                                    className={`w-6 h-6 rounded ${c.bgColor} hover:opacity-80`}
                                    title={`Change to ${c.label}`}
                                  />
                                ))}
                              </div>
                              {!patient.transportTime ? (
                                <button
                                  type="button"
                                  onClick={() => markTransported(patient.id, 'Hospital')}
                                  className="text-blue-600 hover:text-blue-700 p-2"
                                  title="Mark as transported"
                                >
                                  <Truck className="h-5 w-5" />
                                </button>
                              ) : (
                                <span className="text-xs text-green-600 flex items-center">
                                  <Truck className="h-4 w-4 mr-1" /> Transported
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => removePatient(patient.id)}
                                className="text-red-600 hover:text-red-700 p-2"
                              >
                                <Trash2 className="h-5 w-5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {patients.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No patients triaged yet. Click "Add Patient" to begin.</p>
                  </div>
                )}
              </div>
            )}

            {/* Incident Info Tab */}
            {activeTab === 'summary' && (
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Incident Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Incident Name</label>
                    <input
                      type="text"
                      value={incident.incidentName}
                      onChange={(e) => setIncident({ ...incident, incidentName: e.target.value })}
                      placeholder="e.g., Highway 101 MVA"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Incident Type</label>
                    <select
                      value={incident.incidentType}
                      onChange={(e) => setIncident({ ...incident, incidentType: e.target.value })}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="">Select type</option>
                      {incidentTypes.map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="flex items-center text-sm font-medium text-gray-700 mb-1">
                      <MapPin className="h-4 w-4 mr-1" /> Location
                    </label>
                    <input
                      type="text"
                      value={incident.location}
                      onChange={(e) => setIncident({ ...incident, location: e.target.value })}
                      placeholder="Address or GPS coordinates"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      <Clock className="h-4 w-4 inline mr-1" /> Incident Start Time
                    </label>
                    <input
                      type="datetime-local"
                      value={incident.startTime}
                      onChange={(e) => setIncident({ ...incident, startTime: e.target.value })}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Estimated Total Casualties
                    </label>
                    <input
                      type="number"
                      value={incident.estimatedCasualties}
                      onChange={(e) => setIncident({ ...incident, estimatedCasualties: parseInt(e.target.value) })}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      <Building2 className="h-4 w-4 inline mr-1" /> Command Post Location
                    </label>
                    <input
                      type="text"
                      value={incident.commandPost}
                      onChange={(e) => setIncident({ ...incident, commandPost: e.target.value })}
                      placeholder="Location of command post"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      <Radio className="h-4 w-4 inline mr-1" /> Incident Commander
                    </label>
                    <input
                      type="text"
                      value={incident.incidentCommander}
                      onChange={(e) => setIncident({ ...incident, incidentCommander: e.target.value })}
                      placeholder="Name of IC"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      <Phone className="h-4 w-4 inline mr-1" /> Contact Number
                    </label>
                    <input
                      type="tel"
                      value={incident.contactNumber}
                      onChange={(e) => setIncident({ ...incident, contactNumber: e.target.value })}
                      placeholder="Command post phone"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Resources Tab */}
            {activeTab === 'resources' && (
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Resources Requested</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {resourceOptions.map(resource => (
                    <label key={resource} className="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                      <input
                        type="checkbox"
                        checked={incident.resourcesRequested.includes(resource)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setIncident({ ...incident, resourcesRequested: [...incident.resourcesRequested, resource] });
                          } else {
                            setIncident({ ...incident, resourcesRequested: incident.resourcesRequested.filter(r => r !== resource) });
                          }
                        }}
                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 h-5 w-5"
                      />
                      <span className="font-medium text-gray-700">{resource}</span>
                    </label>
                  ))}
                </div>
                
                {incident.resourcesRequested.length > 0 && (
                  <div className="mt-6 p-4 bg-orange-50 rounded-lg">
                    <h3 className="font-medium text-orange-800 mb-2">Resources Requested:</h3>
                    <div className="flex flex-wrap gap-2">
                      {incident.resourcesRequested.map(resource => (
                        <span key={resource} className="bg-orange-200 text-orange-800 px-3 py-1 rounded-full text-sm">
                          {resource}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div className="mt-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || patients.length === 0}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save MCI Record
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
