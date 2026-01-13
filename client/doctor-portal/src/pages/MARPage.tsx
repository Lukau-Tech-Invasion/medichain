import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createMar, getPatients } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  Pill,
  Clock,
  Save,
  Check,
  X,
  AlertTriangle,
  Search,
  User,
  Calendar,
  Scan,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Syringe,
  Droplets,
  Tablets,
  ThermometerSun
} from 'lucide-react';

type MedicationStatus = 'scheduled' | 'given' | 'held' | 'refused' | 'not-given';
type MedicationRoute = 'PO' | 'IV' | 'IM' | 'SC' | 'SL' | 'PR' | 'INH' | 'TD' | 'TOP' | 'OPTH' | 'OTIC';

interface ScheduledMedication {
  id: string;
  medicationName: string;
  dose: string;
  route: MedicationRoute;
  frequency: string;
  scheduledTime: string;
  status: MedicationStatus;
  administeredTime?: string;
  administeredBy?: string;
  holdReason?: string;
  notes?: string;
  prn: boolean;
  prnReason?: string;
  highAlert: boolean;
}

interface MedicationOrder {
  id: string;
  medicationName: string;
  dose: string;
  route: MedicationRoute;
  frequency: string;
  startDate: string;
  endDate?: string;
  orderedBy: string;
  prn: boolean;
  highAlert: boolean;
  instructions?: string;
}

export default function MARPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [selectedMed, setSelectedMed] = useState<ScheduledMedication | null>(null);
  const [_scanMode, setScanMode] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');

  // Medication orders for the patient
  const [medicationOrders, setMedicationOrders] = useState<MedicationOrder[]>([]);
  
  // Scheduled medications for today
  const [scheduledMeds, setScheduledMeds] = useState<ScheduledMedication[]>([]);

  // Administration form
  const [adminForm, setAdminForm] = useState({
    status: 'given' as MedicationStatus,
    administeredTime: new Date().toTimeString().slice(0, 5),
    holdReason: '',
    notes: '',
    prnReason: '',
    painLevelBefore: '',
    painLevelAfter: ''
  });

  // Time slots for MAR grid
  const _timeSlots = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '00:00', '02:00', '04:00'];

  // Sample medication database
  const _commonMedications = [
    { name: 'Metoprolol', dose: '25mg', route: 'PO' as MedicationRoute, frequency: 'BID', highAlert: false },
    { name: 'Lisinopril', dose: '10mg', route: 'PO' as MedicationRoute, frequency: 'Daily', highAlert: false },
    { name: 'Heparin', dose: '5000 units', route: 'SC' as MedicationRoute, frequency: 'Q8H', highAlert: true },
    { name: 'Insulin Regular', dose: 'Per sliding scale', route: 'SC' as MedicationRoute, frequency: 'AC', highAlert: true },
    { name: 'Morphine', dose: '2mg', route: 'IV' as MedicationRoute, frequency: 'Q4H PRN', highAlert: true },
    { name: 'Acetaminophen', dose: '650mg', route: 'PO' as MedicationRoute, frequency: 'Q6H PRN', highAlert: false },
    { name: 'Ondansetron', dose: '4mg', route: 'IV' as MedicationRoute, frequency: 'Q6H PRN', highAlert: false },
    { name: 'Furosemide', dose: '40mg', route: 'IV' as MedicationRoute, frequency: 'BID', highAlert: false },
    { name: 'Potassium Chloride', dose: '20mEq', route: 'PO' as MedicationRoute, frequency: 'Daily', highAlert: true },
    { name: 'Vancomycin', dose: '1g', route: 'IV' as MedicationRoute, frequency: 'Q12H', highAlert: true },
    { name: 'Ceftriaxone', dose: '1g', route: 'IV' as MedicationRoute, frequency: 'Daily', highAlert: false },
    { name: 'Pantoprazole', dose: '40mg', route: 'IV' as MedicationRoute, frequency: 'Daily', highAlert: false }
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const patientData = await getPatients();
        setPatients(patientData || []);
        
        const patientId = searchParams.get('patientId');
        if (patientId) {
          const patient = patientData?.find((p: PatientProfile) => p.patient_id === patientId);
          if (patient) {
            setSelectedPatient(patient);
            loadMedicationsForPatient(patientId);
          }
        }
      } catch (err) {
        console.error('Failed to fetch patients', err);
      }
    };
    fetchData();
  }, [searchParams]);

  const loadMedicationsForPatient = (_patientId: string) => {
    // Simulate loading medications for demo
    const sampleOrders: MedicationOrder[] = [
      {
        id: 'MO-001',
        medicationName: 'Metoprolol Tartrate',
        dose: '25mg',
        route: 'PO',
        frequency: 'BID',
        startDate: '2024-01-15',
        orderedBy: 'Dr. Smith',
        prn: false,
        highAlert: false,
        instructions: 'Hold if HR < 60 or SBP < 100'
      },
      {
        id: 'MO-002',
        medicationName: 'Heparin Sodium',
        dose: '5000 units',
        route: 'SC',
        frequency: 'Q8H',
        startDate: '2024-01-15',
        orderedBy: 'Dr. Smith',
        prn: false,
        highAlert: true,
        instructions: 'DVT prophylaxis'
      },
      {
        id: 'MO-003',
        medicationName: 'Morphine Sulfate',
        dose: '2-4mg',
        route: 'IV',
        frequency: 'Q4H PRN',
        startDate: '2024-01-15',
        orderedBy: 'Dr. Johnson',
        prn: true,
        highAlert: true,
        instructions: 'For severe pain (>7/10)'
      },
      {
        id: 'MO-004',
        medicationName: 'Ondansetron',
        dose: '4mg',
        route: 'IV',
        frequency: 'Q6H PRN',
        startDate: '2024-01-15',
        orderedBy: 'Dr. Johnson',
        prn: true,
        highAlert: false,
        instructions: 'For nausea/vomiting'
      }
    ];

    setMedicationOrders(sampleOrders);

    // Generate scheduled medications for the day
    const scheduled: ScheduledMedication[] = [];
    sampleOrders.forEach(order => {
      if (!order.prn) {
        const times = getScheduledTimes(order.frequency);
        times.forEach(time => {
          scheduled.push({
            id: `${order.id}-${time}`,
            medicationName: order.medicationName,
            dose: order.dose,
            route: order.route,
            frequency: order.frequency,
            scheduledTime: time,
            status: 'scheduled',
            prn: false,
            highAlert: order.highAlert
          });
        });
      }
    });

    setScheduledMeds(scheduled);
  };

  const getScheduledTimes = (frequency: string): string[] => {
    switch (frequency) {
      case 'Daily': return ['08:00'];
      case 'BID': return ['08:00', '20:00'];
      case 'TID': return ['08:00', '14:00', '20:00'];
      case 'QID': return ['08:00', '12:00', '18:00', '22:00'];
      case 'Q6H': return ['06:00', '12:00', '18:00', '00:00'];
      case 'Q8H': return ['06:00', '14:00', '22:00'];
      case 'Q12H': return ['08:00', '20:00'];
      default: return ['08:00'];
    }
  };

  const getStatusColor = (status: MedicationStatus) => {
    switch (status) {
      case 'given': return 'bg-green-500 text-white';
      case 'held': return 'bg-yellow-500 text-white';
      case 'refused': return 'bg-orange-500 text-white';
      case 'not-given': return 'bg-red-500 text-white';
      default: return 'bg-gray-200 text-gray-600';
    }
  };

  const getStatusIcon = (status: MedicationStatus) => {
    switch (status) {
      case 'given': return <Check className="h-4 w-4" />;
      case 'held': return <Clock className="h-4 w-4" />;
      case 'refused': return <X className="h-4 w-4" />;
      case 'not-given': return <AlertTriangle className="h-4 w-4" />;
      default: return null;
    }
  };

  const getRouteIcon = (route: MedicationRoute) => {
    switch (route) {
      case 'IV': return <Droplets className="h-4 w-4" />;
      case 'IM':
      case 'SC': return <Syringe className="h-4 w-4" />;
      case 'PO':
      case 'SL': return <Tablets className="h-4 w-4" />;
      default: return <Pill className="h-4 w-4" />;
    }
  };

  const openAdminModal = (med: ScheduledMedication) => {
    setSelectedMed(med);
    setAdminForm({
      status: 'given',
      administeredTime: new Date().toTimeString().slice(0, 5),
      holdReason: '',
      notes: '',
      prnReason: med.prn ? '' : '',
      painLevelBefore: '',
      painLevelAfter: ''
    });
    setShowAdminModal(true);
  };

  const handleAdminister = () => {
    if (!selectedMed) return;

    setScheduledMeds(prev => prev.map(med => 
      med.id === selectedMed.id 
        ? {
            ...med,
            status: adminForm.status,
            administeredTime: adminForm.administeredTime,
            administeredBy: user?.userId,
            holdReason: adminForm.holdReason,
            notes: adminForm.notes,
            prnReason: adminForm.prnReason
          }
        : med
    ));

    setShowAdminModal(false);
    setSelectedMed(null);
    setSuccess(`${selectedMed.medicationName} documented successfully`);
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleBarcodeSccan = () => {
    // Simulate barcode scan verification
    if (barcodeInput) {
      // In real implementation, verify barcode matches patient and medication
      const verified = barcodeInput.includes('MED') || barcodeInput.includes('PAT');
      if (verified) {
        setSuccess('Barcode verified successfully');
        setBarcodeInput('');
        setScanMode(false);
      } else {
        setError('Barcode verification failed - please verify manually');
      }
      setTimeout(() => { setSuccess(''); setError(''); }, 3000);
    }
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
    setCurrentDate(newDate);
  };

  const filteredPatients = patients.filter(p => 
    p.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.patient_id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSave = async () => {
    if (!selectedPatient) return;

    setIsSubmitting(true);
    setError('');

    try {
      const marData = {
        mar_id: `MAR-${Date.now()}`,
        patient_id: selectedPatient.patient_id,
        date: currentDate.toISOString().split('T')[0],
        medications: scheduledMeds.map(med => ({
          ...med,
          documented_by: user?.userId
        })),
        documented_by: user?.userId || 'unknown',
        documented_at: Math.floor(Date.now() / 1000)
      };

      await createMar(marData);
      setSuccess('MAR saved successfully!');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save MAR. Please try again.');
      console.error('Failed to save MAR', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <Pill className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Medication Administration Record</h1>
                <p className="text-purple-100">Document and track medication administrations</p>
              </div>
            </div>
            {selectedPatient && (
              <div className="text-right text-white">
                <p className="font-medium">{selectedPatient.full_name}</p>
                <p className="text-sm opacity-75">{selectedPatient.patient_id}</p>
              </div>
            )}
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center">
            <Check className="h-5 w-5 mr-2" />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Patient Selection Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-bold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2 text-purple-500" />
                Select Patient
              </h2>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search patients..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {filteredPatients.map(patient => (
                  <button
                    key={patient.patient_id}
                    onClick={() => {
                      setSelectedPatient(patient);
                      loadMedicationsForPatient(patient.patient_id);
                    }}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedPatient?.patient_id === patient.patient_id
                        ? 'bg-purple-100 border-2 border-purple-500'
                        : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{patient.full_name}</p>
                    <p className="text-sm text-gray-500">{patient.patient_id}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Barcode Scanner */}
            <div className="bg-white rounded-lg shadow p-4 mt-4">
              <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                <Scan className="h-5 w-5 mr-2 text-purple-500" />
                Barcode Scan
              </h3>
              <div className="space-y-3">
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="Scan or enter barcode..."
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleBarcodeSccan()}
                />
                <button
                  onClick={handleBarcodeSccan}
                  className="w-full bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 flex items-center justify-center"
                >
                  <Scan className="h-4 w-4 mr-2" />
                  Verify Barcode
                </button>
              </div>
            </div>
          </div>

          {/* MAR Grid */}
          <div className="lg:col-span-3">
            {selectedPatient ? (
              <div className="bg-white rounded-lg shadow">
                {/* Date Navigation */}
                <div className="p-4 border-b flex items-center justify-between">
                  <button
                    onClick={() => navigateDate('prev')}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="flex items-center space-x-3">
                    <Calendar className="h-5 w-5 text-purple-500" />
                    <span className="font-bold text-lg">
                      {currentDate.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </span>
                  </div>
                  <button
                    onClick={() => navigateDate('next')}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>

                {/* Medication Orders */}
                <div className="p-4">
                  <h3 className="font-bold text-gray-900 mb-4">Active Medication Orders</h3>
                  <div className="space-y-3">
                    {medicationOrders.map(order => (
                      <div key={order.id} className={`p-4 rounded-lg border-l-4 ${
                        order.highAlert ? 'border-l-red-500 bg-red-50' : 'border-l-purple-500 bg-gray-50'
                      }`}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            {getRouteIcon(order.route)}
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-gray-900">{order.medicationName}</span>
                                {order.highAlert && (
                                  <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded">HIGH ALERT</span>
                                )}
                                {order.prn && (
                                  <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded">PRN</span>
                                )}
                              </div>
                              <p className="text-sm text-gray-600">
                                {order.dose} {order.route} {order.frequency}
                              </p>
                              {order.instructions && (
                                <p className="text-xs text-gray-500 mt-1">{order.instructions}</p>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-500">Ordered by {order.orderedBy}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scheduled Administrations */}
                <div className="p-4 border-t">
                  <h3 className="font-bold text-gray-900 mb-4">Scheduled Administrations</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="p-3 text-left font-medium text-gray-700">Medication</th>
                          <th className="p-3 text-left font-medium text-gray-700">Dose/Route</th>
                          <th className="p-3 text-left font-medium text-gray-700">Scheduled</th>
                          <th className="p-3 text-left font-medium text-gray-700">Status</th>
                          <th className="p-3 text-left font-medium text-gray-700">Given</th>
                          <th className="p-3 text-left font-medium text-gray-700">By</th>
                          <th className="p-3 text-center font-medium text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduledMeds.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)).map(med => (
                          <tr key={med.id} className={`border-b hover:bg-gray-50 ${
                            med.highAlert ? 'bg-red-50' : ''
                          }`}>
                            <td className="p-3">
                              <div className="flex items-center space-x-2">
                                {med.highAlert && <AlertTriangle className="h-4 w-4 text-red-500" />}
                                <span className="font-medium">{med.medicationName}</span>
                              </div>
                            </td>
                            <td className="p-3">
                              <span className="flex items-center space-x-2">
                                {getRouteIcon(med.route)}
                                <span>{med.dose} {med.route}</span>
                              </span>
                            </td>
                            <td className="p-3 font-mono">{med.scheduledTime}</td>
                            <td className="p-3">
                              <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(med.status)}`}>
                                {getStatusIcon(med.status)}
                                <span className="ml-1">{med.status.toUpperCase()}</span>
                              </span>
                            </td>
                            <td className="p-3 font-mono">{med.administeredTime || '-'}</td>
                            <td className="p-3 text-sm text-gray-600">{med.administeredBy || '-'}</td>
                            <td className="p-3 text-center">
                              {med.status === 'scheduled' ? (
                                <button
                                  onClick={() => openAdminModal(med)}
                                  className="bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700 text-sm"
                                >
                                  Document
                                </button>
                              ) : (
                                <button
                                  onClick={() => openAdminModal(med)}
                                  className="text-purple-600 hover:text-purple-700 text-sm underline"
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* PRN Medications */}
                <div className="p-4 border-t bg-blue-50">
                  <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                    <ThermometerSun className="h-5 w-5 mr-2 text-blue-500" />
                    PRN Medications Available
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {medicationOrders.filter(o => o.prn).map(order => (
                      <button
                        key={order.id}
                        onClick={() => {
                          const prnMed: ScheduledMedication = {
                            id: `PRN-${Date.now()}`,
                            medicationName: order.medicationName,
                            dose: order.dose,
                            route: order.route,
                            frequency: order.frequency,
                            scheduledTime: 'PRN',
                            status: 'scheduled',
                            prn: true,
                            highAlert: order.highAlert
                          };
                          openAdminModal(prnMed);
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${
                          order.highAlert 
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300'
                        }`}
                      >
                        {order.medicationName} - {order.dose} {order.route}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Save Button */}
                <div className="p-4 border-t bg-gray-50 flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={isSubmitting}
                    className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save MAR
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <Pill className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-bold text-gray-700 mb-2">Select a Patient</h2>
                <p className="text-gray-500">Choose a patient from the list to view and document their medications.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Administration Modal */}
      {showAdminModal && selectedMed && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
            <div className={`p-4 rounded-t-lg ${selectedMed.highAlert ? 'bg-red-600' : 'bg-purple-600'}`}>
              <h3 className="text-lg font-bold text-white flex items-center">
                {selectedMed.highAlert && <AlertTriangle className="h-5 w-5 mr-2" />}
                Document Administration
              </h3>
            </div>
            <div className="p-6">
              <div className="mb-6 p-4 bg-gray-100 rounded-lg">
                <p className="font-bold text-gray-900">{selectedMed.medicationName}</p>
                <p className="text-gray-600">{selectedMed.dose} via {selectedMed.route}</p>
                <p className="text-sm text-gray-500">Scheduled: {selectedMed.scheduledTime}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['given', 'held', 'refused', 'not-given'] as MedicationStatus[]).map(status => (
                      <button
                        key={status}
                        onClick={() => setAdminForm({ ...adminForm, status })}
                        className={`p-2 rounded-lg text-sm font-medium capitalize ${
                          adminForm.status === status
                            ? getStatusColor(status)
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {status.replace('-', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                {adminForm.status === 'given' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Time Administered</label>
                    <input
                      type="time"
                      value={adminForm.administeredTime}
                      onChange={(e) => setAdminForm({ ...adminForm, administeredTime: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                )}

                {adminForm.status === 'held' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Hold Reason</label>
                    <select
                      value={adminForm.holdReason}
                      onChange={(e) => setAdminForm({ ...adminForm, holdReason: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded-lg"
                    >
                      <option value="">Select reason</option>
                      <option value="NPO">NPO Status</option>
                      <option value="Low BP">Low Blood Pressure</option>
                      <option value="Low HR">Low Heart Rate</option>
                      <option value="Procedure">Pending Procedure</option>
                      <option value="Lab Values">Abnormal Lab Values</option>
                      <option value="MD Order">Physician Order</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                )}

                {selectedMed.prn && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PRN Reason</label>
                    <input
                      type="text"
                      value={adminForm.prnReason}
                      onChange={(e) => setAdminForm({ ...adminForm, prnReason: e.target.value })}
                      placeholder="e.g., Pain 7/10, Nausea"
                      className="w-full p-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={adminForm.notes}
                    onChange={(e) => setAdminForm({ ...adminForm, notes: e.target.value })}
                    rows={2}
                    className="w-full p-2 border border-gray-300 rounded-lg"
                    placeholder="Additional notes..."
                  />
                </div>
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-b-lg flex justify-end space-x-3">
              <button
                onClick={() => setShowAdminModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleAdminister}
                className={`px-4 py-2 text-white rounded-lg ${
                  selectedMed.highAlert ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
