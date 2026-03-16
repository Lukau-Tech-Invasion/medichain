import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { getPatients, listMar, administerMedication } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { Pill, Clock, User, CheckCircle, XCircle, AlertTriangle, Calendar, Search, FileText, Activity, RefreshCw } from 'lucide-react';
import { useToastActions } from '../components/Toast';

/**
 * MedicationAdminPage
 * 
 * Full electronic Medication Administration Record (eMAR)
 * - Scheduled medication tracking with time slots
 * - PRN medication documentation
 * - Five Rights verification (Patient, Drug, Dose, Route, Time)
 * - Barcode scanning simulation
 * - Reason for not given tracking
 * - Administration audit trail
 */

interface ScheduledMedication {
  medId: string;
  patientId: string;
  patientName: string;
  medicationName: string;
  dose: string;
  route: 'PO' | 'IV' | 'IM' | 'SC' | 'SL' | 'PR' | 'Topical' | 'Inhaled' | 'Ophthalmic' | 'Otic';
  frequency: string;
  scheduledTimes: string[];
  startDate: string;
  endDate?: string;
  indication: string;
  prescriber: string;
  priority: 'routine' | 'stat' | 'prn';
  allergies?: string[];
  interactions?: string[];
}

interface MedicationAdmin {
  adminId: string;
  medId: string;
  patientId: string;
  patientName: string;
  medicationName: string;
  dose: string;
  route: string;
  scheduledTime: string;
  actualTime: string;
  administeredBy: string;
  status: 'given' | 'not-given' | 'held' | 'refused' | 'missed';
  reasonNotGiven?: string;
  site?: string;
  witnessedBy?: string;
  patientResponse?: string;
  barcodeScanned: boolean;
  fiveRightsVerified: boolean;
}

const MedicationAdminPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [medications, setMedications] = useState<ScheduledMedication[]>([]);
  const [administrations, setAdministrations] = useState<MedicationAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'mar' | 'administerMed' | 'history'>('mar');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');

  // Administer medication form state
  const [selectedMed, setSelectedMed] = useState<ScheduledMedication | null>(null);
  const [selectedTime, setSelectedTime] = useState('');
  const [actualTime, setActualTime] = useState('');
  const [status, setStatus] = useState<'given' | 'not-given' | 'held' | 'refused' | 'missed'>('given');
  const [reasonNotGiven, setReasonNotGiven] = useState('');
  const [administrationSite, setAdministrationSite] = useState('');
  const [witnessedBy, setWitnessedBy] = useState('');
  const [patientResponse, setPatientResponse] = useState('');
  const [barcodeScanned, setBarcodeScanned] = useState(false);
  const [fiveRightsVerified, setFiveRightsVerified] = useState(false);

  // Fetch all data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch patients
      const loadedPatients = await getPatients();
      setPatients(Array.isArray(loadedPatients) ? loadedPatients : []);

      // Fetch MAR (Medication Administration Records)
      const marData = await listMar();
      // Ensure marData is an array
      const marArray = Array.isArray(marData) ? marData : [];
      // Map API response to ScheduledMedication interface
      const mappedMeds: ScheduledMedication[] = (marArray as Array<{
        med_id?: string; medId?: string;
        patient_id?: string; patientId?: string;
        patient_name?: string; patientName?: string;
        medication_name?: string; medicationName?: string;
        dose?: string;
        route?: string;
        frequency?: string;
        scheduled_times?: string[]; scheduledTimes?: string[];
        start_date?: string; startDate?: string;
        end_date?: string; endDate?: string;
        indication?: string;
        prescriber?: string;
        priority?: string;
        allergies?: string[];
        interactions?: string[];
      }>).map(m => ({
        medId: m.med_id || m.medId || '',
        patientId: m.patient_id || m.patientId || '',
        patientName: m.patient_name || m.patientName || '',
        medicationName: m.medication_name || m.medicationName || '',
        dose: m.dose || '',
        route: (m.route as ScheduledMedication['route']) || 'PO',
        frequency: m.frequency || '',
        scheduledTimes: m.scheduled_times || m.scheduledTimes || [],
        startDate: m.start_date || m.startDate || '',
        endDate: m.end_date || m.endDate,
        indication: m.indication || '',
        prescriber: m.prescriber || '',
        priority: (m.priority as ScheduledMedication['priority']) || 'routine',
        allergies: m.allergies,
        interactions: m.interactions,
      }));
      setMedications(mappedMeds);

      // Administration history is included in MAR data
      setAdministrations([]);
    } catch (err) {
      console.error('Failed to load medication data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load medication data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAdministerMed = (med: ScheduledMedication, time: string) => {
    setSelectedMed(med);
    setSelectedTime(time);
    setActualTime(new Date().toTimeString().slice(0, 5));
    setStatus('given');
    setReasonNotGiven('');
    setAdministrationSite('');
    setWitnessedBy('');
    setPatientResponse('');
    setBarcodeScanned(false);
    setFiveRightsVerified(false);
    setActiveTab('administerMed');
  };

  const handleSubmitAdministration = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedMed || !actualTime) {
      showWarning('Please fill in required fields');
      return;
    }

    if (status === 'given' && !fiveRightsVerified) {
      showWarning('Five Rights must be verified before administering medication');
      return;
    }

    if ((status === 'not-given' || status === 'held' || status === 'refused') && !reasonNotGiven) {
      showWarning('Please provide a reason for not administering the medication');
      return;
    }

    try {
      // Call the real API to record administration
      await administerMedication({
        patient_id: selectedMed.patientId,
        medication_id: selectedMed.medId,
        medication_name: selectedMed.medicationName,
        dose: selectedMed.dose,
        route: selectedMed.route,
        scheduled_time: selectedTime || 'PRN',
        actual_time: actualTime,
        administered_by: user?.userId || 'Unknown',
        status,
        reason_not_given: reasonNotGiven || undefined,
        site: administrationSite || undefined,
        witnessed_by: witnessedBy || undefined,
        patient_response: patientResponse || undefined,
        barcode_scanned: barcodeScanned,
        five_rights_verified: fiveRightsVerified,
      });

      // Create local record for immediate UI update (optimistic update)
      const newAdmin: MedicationAdmin = {
        adminId: `ADM-${String(administrations.length + 1).padStart(3, '0')}`,
        medId: selectedMed.medId,
        patientId: selectedMed.patientId,
        patientName: selectedMed.patientName,
        medicationName: `${selectedMed.medicationName} ${selectedMed.dose}`,
        dose: selectedMed.dose,
        route: selectedMed.route,
        scheduledTime: selectedTime || 'PRN',
        actualTime,
        administeredBy: user?.userId || 'Unknown',
        status,
        reasonNotGiven: reasonNotGiven || undefined,
        site: administrationSite || undefined,
        witnessedBy: witnessedBy || undefined,
        patientResponse: patientResponse || undefined,
        barcodeScanned,
        fiveRightsVerified
      };

      setAdministrations([...administrations, newAdmin]);
      showSuccess('Medication administration recorded successfully');
      setActiveTab('mar');
      setSelectedMed(null);
    } catch (err) {
      console.error('Failed to record medication administration:', err);
      showError('Failed to record medication administration. Please try again.');
    }
  };

  const getMedicationStatus = (med: ScheduledMedication, time: string): 'given' | 'pending' | 'overdue' | 'held' | 'refused' => {
    const admin = administrations.find(
      a => a.medId === med.medId && a.scheduledTime === time && 
      new Date(a.actualTime).toDateString() === new Date(selectedDate).toDateString()
    );

    if (admin) {
      if (admin.status === 'given') return 'given';
      if (admin.status === 'held') return 'held';
      if (admin.status === 'refused') return 'refused';
    }

    const now = new Date();
    const scheduled = new Date(`${selectedDate}T${time}`);
    const thirtyMinutesLater = new Date(scheduled.getTime() + 30 * 60000);

    if (now > thirtyMinutesLater) return 'overdue';
    return 'pending';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'given':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'held':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case 'refused':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'overdue':
        return <AlertTriangle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const filteredPatientMeds = medications.filter(med => {
    if (selectedPatientId && med.patientId !== selectedPatientId) return false;
    if (searchTerm && !med.medicationName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const filteredHistory = administrations.filter(admin => {
    if (selectedPatientId && admin.patientId !== selectedPatientId) return false;
    if (searchTerm && !admin.medicationName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Pill className="h-8 w-8" />
            <div>
              <h1 className="text-3xl font-bold">Medication Administration Record (eMAR)</h1>
              <p className="text-indigo-100">Electronic medication tracking and documentation</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-indigo-100">Nurse</p>
            <p className="font-semibold">{user?.username || 'Unknown'}</p>
          </div>
        </div>
      </div>

      {/* Patient and Date Selection */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="medadmin-patient" className="block text-sm font-medium text-gray-700 mb-1">
              <User className="inline h-4 w-4 mr-1" />
              Patient
            </label>
            <select
              id="medadmin-patient"
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">All Patients</option>
              {patients.map((patient) => (
                <option key={patient.patient_id} value={patient.patient_id}>
                  {patient.full_name} ({patient.patient_id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="medadmin-date" className="block text-sm font-medium text-gray-700 mb-1">
              <Calendar className="inline h-4 w-4 mr-1" />
              Date
            </label>
            <input
              id="medadmin-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label htmlFor="medadmin-search" className="block text-sm font-medium text-gray-700 mb-1">
              <Search className="inline h-4 w-4 mr-1" />
              Search Medication
            </label>
            <input
              id="medadmin-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Medication name..."
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('mar')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'mar'
              ? 'text-indigo-600 border-b-2 border-indigo-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Activity className="inline h-4 w-4 mr-2" />
          MAR Grid
        </button>
        {selectedMed && (
          <button
            onClick={() => setActiveTab('administerMed')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'administerMed'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Pill className="inline h-4 w-4 mr-2" />
            Administer
          </button>
        )}
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'history'
              ? 'text-indigo-600 border-b-2 border-indigo-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="inline h-4 w-4 mr-2" />
          History
        </button>
      </div>

      {/* MAR Grid Tab */}
      {activeTab === 'mar' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Medication</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dose/Route</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Frequency</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheduled Times</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Indication</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Alerts</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPatientMeds.map((med) => (
                  <tr key={med.medId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{med.patientName}</div>
                      <div className="text-xs text-gray-500">{med.patientId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{med.medicationName}</div>
                      <div className="text-xs text-gray-500">Prescribed by {med.prescriber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{med.dose}</div>
                      <div className="text-xs text-gray-500">{med.route}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        med.priority === 'stat' ? 'bg-red-100 text-red-800' :
                        med.priority === 'prn' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {med.frequency}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {med.priority === 'prn' ? (
                        <button
                          onClick={() => handleAdministerMed(med, 'PRN')}
                          className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded text-sm hover:bg-yellow-200"
                        >
                          PRN - Give Now
                        </button>
                      ) : (
                        <div className="flex space-x-2">
                          {med.scheduledTimes.map((time) => {
                            const status = getMedicationStatus(med, time);
                            return (
                              <button
                                key={time}
                                onClick={() => handleAdministerMed(med, time)}
                                className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium ${
                                  status === 'given' ? 'bg-green-100 text-green-800' :
                                  status === 'held' ? 'bg-yellow-100 text-yellow-800' :
                                  status === 'refused' ? 'bg-red-100 text-red-800' :
                                  status === 'overdue' ? 'bg-red-100 text-red-800 animate-pulse' :
                                  'bg-gray-100 text-gray-800 hover:bg-gray-200'
                                }`}
                              >
                                {getStatusIcon(status)}
                                <span>{time}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{med.indication}</td>
                    <td className="px-4 py-3">
                      {med.allergies && med.allergies.length > 0 && (
                        <div className="text-xs text-red-600 flex items-center mb-1">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Allergies: {med.allergies.join(', ')}
                        </div>
                      )}
                      {med.interactions && med.interactions.length > 0 && (
                        <div className="text-xs text-orange-600 flex items-center">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Interactions: {med.interactions.join(', ')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Administer Medication Tab */}
      {activeTab === 'administerMed' && selectedMed && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Administer Medication</h2>
          
          {/* Medication Details */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700">Patient:</span>
                <p className="text-gray-900">{selectedMed.patientName}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Medication:</span>
                <p className="text-gray-900">{selectedMed.medicationName}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Dose:</span>
                <p className="text-gray-900">{selectedMed.dose}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Route:</span>
                <p className="text-gray-900">{selectedMed.route}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Scheduled Time:</span>
                <p className="text-gray-900">{selectedTime}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Indication:</span>
                <p className="text-gray-900">{selectedMed.indication}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Prescriber:</span>
                <p className="text-gray-900">{selectedMed.prescriber}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Frequency:</span>
                <p className="text-gray-900">{selectedMed.frequency}</p>
              </div>
            </div>
          </div>

          {/* Five Rights Verification */}
          <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4 mb-6">
            <h3 className="font-bold text-green-900 mb-3">Five Rights Verification</h3>
            <div className="space-y-2">
              <label className="flex items-center text-sm">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">Right Patient:</span>
                <span className="ml-2 text-gray-700">{selectedMed.patientName} ({selectedMed.patientId})</span>
              </label>
              <label className="flex items-center text-sm">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">Right Drug:</span>
                <span className="ml-2 text-gray-700">{selectedMed.medicationName}</span>
              </label>
              <label className="flex items-center text-sm">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">Right Dose:</span>
                <span className="ml-2 text-gray-700">{selectedMed.dose}</span>
              </label>
              <label className="flex items-center text-sm">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">Right Route:</span>
                <span className="ml-2 text-gray-700">{selectedMed.route}</span>
              </label>
              <label className="flex items-center text-sm">
                <input type="checkbox" className="mr-2" disabled checked />
                <span className="font-medium">Right Time:</span>
                <span className="ml-2 text-gray-700">{selectedTime}</span>
              </label>
              <div className="mt-4 pt-4 border-t">
                <label htmlFor="medadmin-five-rights" className="flex items-center">
                  <input
                    id="medadmin-five-rights"
                    type="checkbox"
                    checked={fiveRightsVerified}
                    onChange={(e) => setFiveRightsVerified(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="font-bold text-green-900">I verify all Five Rights are correct</span>
                </label>
              </div>
            </div>
          </div>

          {/* Administration Form */}
          <form onSubmit={handleSubmitAdministration}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="medadmin-status" className="block text-sm font-medium text-gray-700 mb-1">
                  Administration Status <span className="text-red-500">*</span>
                </label>
                <select
                  id="medadmin-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="given">Given</option>
                  <option value="not-given">Not Given</option>
                  <option value="held">Held</option>
                  <option value="refused">Refused by Patient</option>
                </select>
              </div>

              <div>
                <label htmlFor="medadmin-actual-time" className="block text-sm font-medium text-gray-700 mb-1">
                  Actual Time <span className="text-red-500">*</span>
                </label>
                <input
                  id="medadmin-actual-time"
                  type="time"
                  value={actualTime}
                  onChange={(e) => setActualTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {(status === 'not-given' || status === 'held' || status === 'refused') && (
                <div className="md:col-span-2">
                  <label htmlFor="medadmin-reason-not-given" className="block text-sm font-medium text-gray-700 mb-1">
                    Reason Not Given <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="medadmin-reason-not-given"
                    value={reasonNotGiven}
                    onChange={(e) => setReasonNotGiven(e.target.value)}
                    rows={3}
                    placeholder="Document reason medication was not administered..."
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
              )}

              {status === 'given' && (
                <>
                  <div>
                    <label htmlFor="medadmin-site" className="block text-sm font-medium text-gray-700 mb-1">
                      Administration Site
                      {(selectedMed.route === 'IM' || selectedMed.route === 'SC' || selectedMed.route === 'IV') && 
                        <span className="text-red-500"> *</span>
                      }
                    </label>
                    <input
                      id="medadmin-site"
                      type="text"
                      value={administrationSite}
                      onChange={(e) => setAdministrationSite(e.target.value)}
                      placeholder="e.g., Left deltoid, Right forearm IV"
                      className="w-full px-3 py-2 border rounded-md"
                      required={selectedMed.route === 'IM' || selectedMed.route === 'SC' || selectedMed.route === 'IV'}
                    />
                  </div>

                  <div>
                    <label htmlFor="medadmin-witnessed-by" className="block text-sm font-medium text-gray-700 mb-1">Witnessed By</label>
                    <input
                      id="medadmin-witnessed-by"
                      type="text"
                      value={witnessedBy}
                      onChange={(e) => setWitnessedBy(e.target.value)}
                      placeholder="Required for controlled substances"
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label htmlFor="medadmin-patient-response" className="block text-sm font-medium text-gray-700 mb-1">Patient Response</label>
                    <textarea
                      id="medadmin-patient-response"
                      value={patientResponse}
                      onChange={(e) => setPatientResponse(e.target.value)}
                      rows={3}
                      placeholder="Document patient's response to medication..."
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                </>
              )}

              <div className="md:col-span-2">
                <label htmlFor="medadmin-barcode-scanned" className="flex items-center">
                  <input
                    id="medadmin-barcode-scanned"
                    type="checkbox"
                    checked={barcodeScanned}
                    onChange={(e) => setBarcodeScanned(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">Barcode Scanned (Patient + Medication)</span>
                </label>
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('mar');
                  setSelectedMed(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Record Administration
              </button>
            </div>
          </form>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date/Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Medication</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dose/Route</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Administered By</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredHistory.map((admin) => (
                  <tr key={admin.adminId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{selectedDate}</div>
                      <div className="text-xs text-gray-500">{admin.actualTime}</div>
                      {admin.scheduledTime !== 'PRN' && (
                        <div className="text-xs text-gray-400">Scheduled: {admin.scheduledTime}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{admin.patientName}</div>
                      <div className="text-xs text-gray-500">{admin.patientId}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{admin.medicationName}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{admin.dose}</div>
                      <div className="text-xs text-gray-500">{admin.route}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(admin.status)}
                        <span className={`text-sm font-medium ${
                          admin.status === 'given' ? 'text-green-700' :
                          admin.status === 'held' ? 'text-yellow-700' :
                          'text-red-700'
                        }`}>
                          {admin.status}
                        </span>
                      </div>
                      {admin.reasonNotGiven && (
                        <div className="text-xs text-gray-600 mt-1">{admin.reasonNotGiven}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{admin.administeredBy}</td>
                    <td className="px-4 py-3 text-xs">
                      {admin.site && <div className="text-gray-600">Site: {admin.site}</div>}
                      {admin.witnessedBy && <div className="text-gray-600">Witness: {admin.witnessedBy}</div>}
                      {admin.patientResponse && <div className="text-gray-600">Response: {admin.patientResponse}</div>}
                      <div className="flex items-center mt-1 space-x-2">
                        {admin.barcodeScanned && (
                          <span className="text-green-600 flex items-center">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Scanned
                          </span>
                        )}
                        {admin.fiveRightsVerified && (
                          <span className="text-green-600 flex items-center">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            5 Rights
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MedicationAdminPage;
