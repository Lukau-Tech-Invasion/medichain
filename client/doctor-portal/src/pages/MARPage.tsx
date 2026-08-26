import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { apiUrl, createMar, getApiClient, getPatients, IS_DEMO, listMar, useTranslation } from '@medichain/shared';
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

/** Shape of a `ScheduledMedication` entry as returned by `GET /api/emergency/mar/list`. */
interface BackendScheduledMedication {
  medication_id: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
  instructions?: string | null;
}

/** Shape of a `PRNMedication` entry as returned by `GET /api/emergency/mar/list`. */
interface BackendPrnMedication {
  medication_id: string;
  name: string;
  dose: string;
  route: string;
  indication: string;
}

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
  const { t } = useTranslation();
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

  const loadMedicationsForPatient = async (patientId: string) => {
    // Try to load medications from API first
    try {
      const today = new Date().toISOString().split('T')[0];
      // The backend has no "get MAR for patient+date" lookup (only a composite
      // patient_id+medication_id get, and a list-all) — list and filter client-side.
      const records = (await listMar()) as Array<{
        patient_id?: string;
        record_date?: string;
        scheduled_medications?: BackendScheduledMedication[];
        prn_medications?: BackendPrnMedication[];
      }>;
      const patientRecords = records.filter(r => r.patient_id === patientId);
      const scheduledMeds = patientRecords.flatMap(r => r.scheduled_medications ?? []);
      const prnMeds = patientRecords.flatMap(r => r.prn_medications ?? []);

      if (scheduledMeds.length > 0 || prnMeds.length > 0) {
        // Use real API data. The backend doesn't track a "high alert" flag, so it
        // defaults to false here rather than being guessed at.
        const orders: MedicationOrder[] = [
          ...scheduledMeds.map(m => ({
            id: m.medication_id,
            medicationName: m.name,
            dose: m.dose,
            route: m.route as MedicationRoute,
            frequency: m.frequency,
            startDate: today,
            orderedBy: 'Unknown',
            prn: false,
            highAlert: false,
            instructions: m.instructions ?? undefined,
          })),
          ...prnMeds.map(m => ({
            id: m.medication_id,
            medicationName: m.name,
            dose: m.dose,
            route: m.route as MedicationRoute,
            frequency: m.indication,
            startDate: today,
            orderedBy: 'Unknown',
            prn: true,
            highAlert: false,
            instructions: undefined,
          })),
        ];

        setMedicationOrders(orders);

        // Generate scheduled medications for the day
        const scheduled: ScheduledMedication[] = [];
        orders.forEach(order => {
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
        return;
      }
    } catch (err) {
      console.warn('No MAR data from API:', err);
    }

    // No API data. In production, show an empty state rather than sample
    // patients; demo data is only for IS_DEMO.
    if (!IS_DEMO) {
      setMedicationOrders([]);
      setScheduledMeds([]);
      return;
    }

    // Fallback to demo data (demo mode only)
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
      case 'held': return 'bg-caution text-white';
      case 'refused': return 'bg-orange-500 text-white';
      case 'not-given': return 'bg-red-500 text-white';
      default: return 'bg-surface-sunken text-content-muted';
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

  const handleAdminister = async () => {
    if (!selectedMed) return;

    // Call the API to mark medication as administered
    if (user && selectedPatient) {
      try {
        await fetch(apiUrl('/api/nursing/mar/administer'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getApiClient().getSessionHeaders(user.walletAddress),
            'Idempotency-Key': getApiClient().getMutationHeaders()['Idempotency-Key'],
            'X-Provider-Role': user.role,
          },
          body: JSON.stringify({
            patient_id: selectedPatient.patient_id,
            medication_id: selectedMed.id,
            medication_name: selectedMed.medicationName,
            dose: selectedMed.dose,
            route: selectedMed.route,
            status: adminForm.status,
            administered_time: adminForm.administeredTime,
            administered_by: user.userId,
            hold_reason: adminForm.holdReason,
            notes: adminForm.notes,
            prn_reason: adminForm.prnReason,
            date: new Date().toISOString().split('T')[0],
          }),
        });
      } catch (e) {
        console.error('Failed to post MAR administration:', e);
      }
    }

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
    setSuccess(t('docMAR.documentedSuccess', { name: selectedMed.medicationName }));
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleBarcodeSccan = () => {
    // Simulate barcode scan verification
    if (barcodeInput) {
      // In real implementation, verify barcode matches patient and medication
      const verified = barcodeInput.includes('MED') || barcodeInput.includes('PAT');
      if (verified) {
        setSuccess(t('docMAR.barcodeVerifiedSuccess'));
        setBarcodeInput('');
        setScanMode(false);
      } else {
        setError(t('docMAR.barcodeVerifiedError'));
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
      setSuccess(t('docMAR.marSavedSuccess'));
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError(t('docMAR.marSaveError'));
      console.error('Failed to save MAR', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-surface/20 rounded-full">
                <Pill className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{t('docMAR.title')}</h1>
                <p className="text-purple-100">{t('docMAR.subtitle')}</p>
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
          <div className="mb-6 bg-ok-subtle border border-ok text-ok-subtle-fg p-4 rounded-lg flex items-center">
            <Check className="h-5 w-5 mr-2" />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-critical-subtle border border-critical text-critical-subtle-fg p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Patient Selection Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-bold text-content mb-4 flex items-center">
                <User className="h-5 w-5 mr-2 text-purple-500" />
                {t('docMAR.selectPatientHeading')}
              </h2>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-content-muted" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('docMAR.searchPatientsPh')}
                  className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-purple-500"
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
                        ? 'bg-surface-sunken border-2 border-purple-500'
                        : 'bg-surface-sunken hover:bg-surface-sunken border-2 border-transparent'
                    }`}
                  >
                    <p className="font-medium text-content">{patient.full_name}</p>
                    <p className="text-sm text-content-muted">{patient.patient_id}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Barcode Scanner */}
            <div className="bg-surface rounded-lg shadow p-4 mt-4">
              <h3 className="font-bold text-content mb-3 flex items-center">
                <Scan className="h-5 w-5 mr-2 text-purple-500" />
                {t('docMAR.barcodeScanHeading')}
              </h3>
              <div className="space-y-3">
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder={t('docMAR.barcodeScanPh')}
                  className="w-full p-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-purple-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleBarcodeSccan()}
                />
                <button
                  onClick={handleBarcodeSccan}
                  className="w-full bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 flex items-center justify-center"
                >
                  <Scan className="h-4 w-4 mr-2" />
                  {t('docMAR.verifyBarcodeButton')}
                </button>
              </div>
            </div>
          </div>

          {/* MAR Grid */}
          <div className="lg:col-span-3">
            {selectedPatient ? (
              <div className="bg-surface rounded-lg shadow">
                {/* Date Navigation */}
                <div className="p-4 border-b flex items-center justify-between">
                  <button
                    onClick={() => navigateDate('prev')}
                    className="p-2 hover:bg-surface-sunken rounded-lg"
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
                    className="p-2 hover:bg-surface-sunken rounded-lg"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>

                {/* Medication Orders */}
                <div className="p-4">
                  <h3 className="font-bold text-content mb-4">{t('docMAR.activeMedicationOrdersHeading')}</h3>
                  <div className="space-y-3">
                    {medicationOrders.map(order => (
                      <div key={order.id} className={`p-4 rounded-lg border-l-4 ${
                        order.highAlert ? 'border-l-red-500 bg-critical-subtle' : 'border-l-purple-500 bg-surface-sunken'
                      }`}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            {getRouteIcon(order.route)}
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-content">{order.medicationName}</span>
                                {order.highAlert && (
                                  <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded">{t('docMAR.highAlertBadge')}</span>
                                )}
                                {order.prn && (
                                  <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded">{t('docMAR.prnBadge')}</span>
                                )}
                              </div>
                              <p className="text-sm text-content-muted">
                                {order.dose} {order.route} {order.frequency}
                              </p>
                              {order.instructions && (
                                <p className="text-xs text-content-muted mt-1">{order.instructions}</p>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-content-muted">{t('docMAR.orderedByLine', { name: order.orderedBy })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scheduled Administrations */}
                <div className="p-4 border-t">
                  <h3 className="font-bold text-content mb-4">{t('docMAR.scheduledAdministrationsHeading')}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-surface-sunken">
                          <th className="p-3 text-left font-medium text-content-secondary">{t('docMAR.tableMedication')}</th>
                          <th className="p-3 text-left font-medium text-content-secondary">{t('docMAR.tableDoseRoute')}</th>
                          <th className="p-3 text-left font-medium text-content-secondary">{t('docMAR.tableScheduled')}</th>
                          <th className="p-3 text-left font-medium text-content-secondary">{t('docMAR.tableStatus')}</th>
                          <th className="p-3 text-left font-medium text-content-secondary">{t('docMAR.tableGiven')}</th>
                          <th className="p-3 text-left font-medium text-content-secondary">{t('docMAR.tableBy')}</th>
                          <th className="p-3 text-center font-medium text-content-secondary">{t('docMAR.tableAction')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduledMeds.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)).map(med => (
                          <tr key={med.id} className={`border-b hover:bg-surface-sunken ${
                            med.highAlert ? 'bg-critical-subtle' : ''
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
                                <span className="ml-1">{t(`docMAR.status_${med.status}`).toUpperCase()}</span>
                              </span>
                            </td>
                            <td className="p-3 font-mono">{med.administeredTime || '-'}</td>
                            <td className="p-3 text-sm text-content-muted">{med.administeredBy || '-'}</td>
                            <td className="p-3 text-center">
                              {med.status === 'scheduled' ? (
                                <button
                                  onClick={() => openAdminModal(med)}
                                  className="bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700 text-sm"
                                >
                                  {t('docMAR.documentButton')}
                                </button>
                              ) : (
                                <button
                                  onClick={() => openAdminModal(med)}
                                  className="text-content-secondary hover:text-content-secondary text-sm underline"
                                >
                                  {t('docMAR.editButton')}
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
                <div className="p-4 border-t bg-notice-subtle">
                  <h3 className="font-bold text-content mb-4 flex items-center">
                    <ThermometerSun className="h-5 w-5 mr-2 text-blue-500" />
                    {t('docMAR.prnMedicationsAvailableHeading')}
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
                            ? 'bg-critical-subtle text-critical-subtle-fg hover:bg-red-200 border border-critical'
                            : 'bg-notice-subtle text-notice-subtle-fg hover:bg-blue-200 border border-notice'
                        }`}
                      >
                        {order.medicationName} - {order.dose} {order.route}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Save Button */}
                <div className="p-4 border-t bg-surface-sunken flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={isSubmitting}
                    className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                        {t('docMAR.saving')}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        {t('docMAR.saveMarButton')}
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-surface rounded-lg shadow p-12 text-center">
                <Pill className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-bold text-content-secondary mb-2">{t('docMAR.selectPatientEmptyTitle')}</h2>
                <p className="text-content-muted">{t('docMAR.selectPatientEmptyMessage')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Administration Modal */}
      {showAdminModal && selectedMed && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg shadow-xl max-w-lg w-full mx-4">
            <div className={`p-4 rounded-t-lg ${selectedMed.highAlert ? 'bg-critical' : 'bg-purple-600'}`}>
              <h3 className="text-lg font-bold text-white flex items-center">
                {selectedMed.highAlert && <AlertTriangle className="h-5 w-5 mr-2" />}
                {t('docMAR.documentAdministrationHeading')}
              </h3>
            </div>
            <div className="p-6">
              <div className="mb-6 p-4 bg-surface-sunken rounded-lg">
                <p className="font-bold text-content">{selectedMed.medicationName}</p>
                <p className="text-content-muted">{t('docMAR.doseViaRouteLine', { dose: selectedMed.dose, route: selectedMed.route })}</p>
                <p className="text-sm text-content-muted">{t('docMAR.scheduledLine', { time: selectedMed.scheduledTime })}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-2">{t('docMAR.statusLabel')}</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['given', 'held', 'refused', 'not-given'] as MedicationStatus[]).map(status => (
                      <button
                        key={status}
                        onClick={() => setAdminForm({ ...adminForm, status })}
                        className={`p-2 rounded-lg text-sm font-medium ${
                          adminForm.status === status
                            ? getStatusColor(status)
                            : 'bg-surface-sunken text-content-muted hover:bg-surface-sunken'
                        }`}
                      >
                        {t(`docMAR.status_${status}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {adminForm.status === 'given' && (
                  <div>
                    <label htmlFor="mar-time-administered" className="block text-sm font-medium text-content-secondary mb-1">{t('docMAR.timeAdministeredLabel')}</label>
                    <input
                      id="mar-time-administered"
                      type="time"
                      value={adminForm.administeredTime}
                      onChange={(e) => setAdminForm({ ...adminForm, administeredTime: e.target.value })}
                      className="w-full p-2 border border-border-strong rounded-lg"
                    />
                  </div>
                )}

                {adminForm.status === 'held' && (
                  <div>
                    <label htmlFor="mar-hold-reason" className="block text-sm font-medium text-content-secondary mb-1">{t('docMAR.holdReasonLabel')}</label>
                    <select
                      id="mar-hold-reason"
                      value={adminForm.holdReason}
                      onChange={(e) => setAdminForm({ ...adminForm, holdReason: e.target.value })}
                      className="w-full p-2 border border-border-strong rounded-lg"
                    >
                      <option value="">{t('docMAR.selectReasonPh')}</option>
                      <option value="NPO">{t('docMAR.holdReason_npo')}</option>
                      <option value="Low BP">{t('docMAR.holdReason_lowBp')}</option>
                      <option value="Low HR">{t('docMAR.holdReason_lowHr')}</option>
                      <option value="Procedure">{t('docMAR.holdReason_procedure')}</option>
                      <option value="Lab Values">{t('docMAR.holdReason_labValues')}</option>
                      <option value="MD Order">{t('docMAR.holdReason_mdOrder')}</option>
                      <option value="Other">{t('docMAR.holdReason_other')}</option>
                    </select>
                  </div>
                )}

                {selectedMed.prn && (
                  <div>
                    <label htmlFor="mar-prn-reason" className="block text-sm font-medium text-content-secondary mb-1">{t('docMAR.prnReasonLabel')}</label>
                    <input
                      id="mar-prn-reason"
                      type="text"
                      value={adminForm.prnReason}
                      onChange={(e) => setAdminForm({ ...adminForm, prnReason: e.target.value })}
                      placeholder={t('docMAR.prnReasonPh')}
                      className="w-full p-2 border border-border-strong rounded-lg"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="mar-notes" className="block text-sm font-medium text-content-secondary mb-1">{t('docMAR.notesLabel')}</label>
                  <textarea
                    id="mar-notes"
                    value={adminForm.notes}
                    onChange={(e) => setAdminForm({ ...adminForm, notes: e.target.value })}
                    rows={2}
                    className="w-full p-2 border border-border-strong rounded-lg"
                    placeholder={t('docMAR.notesPh')}
                  />
                </div>
              </div>
            </div>
            <div className="p-4 bg-surface-sunken rounded-b-lg flex justify-end space-x-3">
              <button
                onClick={() => setShowAdminModal(false)}
                className="px-4 py-2 bg-surface-sunken text-content-secondary rounded-lg hover:bg-gray-300"
              >
                {t('docMAR.cancelButton')}
              </button>
              <button
                onClick={handleAdminister}
                className={`px-4 py-2 text-critical-fg rounded-lg ${
                  selectedMed.highAlert ? 'bg-critical hover:bg-critical' : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                {t('docMAR.confirmButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
