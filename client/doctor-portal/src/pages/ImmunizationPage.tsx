import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, listImmunizations, createImmunization } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import {
  Syringe,
  CheckCircle,
  Clock,
  User,
  AlertTriangle,
  Search,
  Calendar,
  Shield,
  XCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

type VaccineType =
  | 'covid-19'
  | 'influenza'
  | 'hepatitis-b'
  | 'hepatitis-a'
  | 'tetanus'
  | 'mmr'
  | 'varicella'
  | 'pneumococcal'
  | 'meningococcal'
  | 'hpv'
  | 'rotavirus'
  | 'dtap'
  | 'polio'
  | 'bcg'
  | 'yellow-fever'
  | 'rabies'
  | 'typhoid'
  | 'cholera';

type AdministrationRoute = 'intramuscular' | 'subcutaneous' | 'intradermal' | 'oral' | 'intranasal';
type AdministrationSite = 'left-deltoid' | 'right-deltoid' | 'left-thigh' | 'right-thigh' | 'oral' | 'nasal';
type VaccinationStatus = 'scheduled' | 'administered' | 'declined' | 'deferred' | 'contraindicated';

interface VaccineAdministration {
  administrationId: string;
  patientId: string;
  patientName: string;
  vaccineType: VaccineType;
  vaccineName: string;
  manufacturer: string;
  lotNumber: string;
  expiryDate: string;
  dose: string;
  route: AdministrationRoute;
  site: AdministrationSite;
  administeredBy: string;
  administeredAt: string;
  status: VaccinationStatus;
  doseNumber?: number;
  totalDoses?: number;
  nextDueDate?: string;
  consentObtained: boolean;
  consentBy?: string;
  adverseReactions?: string;
  notes?: string;
  vfcEligible?: boolean;
  insuranceReported: boolean;
}

interface VaccineScheduleItem {
  vaccineType: VaccineType;
  vaccineName: string;
  recommendedAge: string;
  doseNumber: number;
  totalDoses: number;
  isDue: boolean;
  isOverdue: boolean;
  scheduledDate?: string;
}

const ImmunizationPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [administrations, setAdministrations] = useState<VaccineAdministration[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'records' | 'administer' | 'schedule' | 'history'>('records');
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<VaccinationStatus | 'all'>('all');

  const [newVaccine, setNewVaccine] = useState({
    patientId: '',
    vaccineType: 'covid-19' as VaccineType,
    vaccineName: '',
    manufacturer: '',
    lotNumber: '',
    expiryDate: '',
    dose: '',
    route: 'intramuscular' as AdministrationRoute,
    site: 'left-deltoid' as AdministrationSite,
    doseNumber: 1,
    totalDoses: 1,
    nextDueDate: '',
    consentObtained: false,
    consentBy: '',
    adverseReactions: '',
    notes: '',
    vfcEligible: false,
  });

  const fetchImmunizations = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await listImmunizations();
      if (response.success && response.records?.items) {
        setAdministrations(response.records.items as VaccineAdministration[]);
      }
    } catch (err) {
      console.error('Error fetching immunizations:', err);
      setError('Failed to load immunizations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      const patientData = await getPatients();
      setPatients(patientData);
    };
    loadData();
  }, []);

  useEffect(() => {
    fetchImmunizations();
  }, [fetchImmunizations]);

  const vaccineSchedule: VaccineScheduleItem[] = [
    {
      vaccineType: 'bcg',
      vaccineName: 'BCG (Tuberculosis)',
      recommendedAge: 'At birth',
      doseNumber: 1,
      totalDoses: 1,
      isDue: false,
      isOverdue: false,
    },
    {
      vaccineType: 'hepatitis-b',
      vaccineName: 'Hepatitis B',
      recommendedAge: 'At birth, 6 weeks, 14 weeks',
      doseNumber: 1,
      totalDoses: 3,
      isDue: false,
      isOverdue: false,
    },
    {
      vaccineType: 'polio',
      vaccineName: 'Oral Polio Vaccine (OPV)',
      recommendedAge: '6, 10, 14 weeks',
      doseNumber: 1,
      totalDoses: 3,
      isDue: true,
      isOverdue: false,
    },
    {
      vaccineType: 'dtap',
      vaccineName: 'DTaP (Diphtheria, Tetanus, Pertussis)',
      recommendedAge: '6, 10, 14 weeks',
      doseNumber: 1,
      totalDoses: 3,
      isDue: true,
      isOverdue: false,
    },
    {
      vaccineType: 'pneumococcal',
      vaccineName: 'Pneumococcal Conjugate (PCV)',
      recommendedAge: '6, 14 weeks, 9 months',
      doseNumber: 2,
      totalDoses: 3,
      isDue: false,
      isOverdue: false,
    },
    {
      vaccineType: 'rotavirus',
      vaccineName: 'Rotavirus',
      recommendedAge: '6, 14 weeks',
      doseNumber: 1,
      totalDoses: 2,
      isDue: true,
      isOverdue: true,
    },
    {
      vaccineType: 'mmr',
      vaccineName: 'MMR (Measles, Mumps, Rubella)',
      recommendedAge: '6, 12 months',
      doseNumber: 1,
      totalDoses: 2,
      isDue: false,
      isOverdue: false,
    },
  ];

  const handleAdminister = async () => {
    if (!newVaccine.patientId || !newVaccine.vaccineName || !newVaccine.lotNumber) {
      showWarning('Please fill in all required fields');
      return;
    }

    const patient = patients.find((p) => p.patient_id === newVaccine.patientId);
    if (!patient) return;

    const newAdmin: VaccineAdministration = {
      administrationId: `VAC-${String(administrations.length + 1).padStart(3, '0')}`,
      patientId: patient.patient_id,
      patientName: patient.full_name,
      vaccineType: newVaccine.vaccineType,
      vaccineName: newVaccine.vaccineName,
      manufacturer: newVaccine.manufacturer,
      lotNumber: newVaccine.lotNumber,
      expiryDate: newVaccine.expiryDate,
      dose: newVaccine.dose,
      route: newVaccine.route,
      site: newVaccine.site,
      administeredBy: user?.userId || 'USER-001',
      administeredAt: new Date().toISOString(),
      status: 'administered',
      doseNumber: newVaccine.doseNumber,
      totalDoses: newVaccine.totalDoses,
      nextDueDate: newVaccine.nextDueDate || undefined,
      consentObtained: newVaccine.consentObtained,
      consentBy: newVaccine.consentBy || undefined,
      adverseReactions: newVaccine.adverseReactions || undefined,
      notes: newVaccine.notes || undefined,
      vfcEligible: newVaccine.vfcEligible,
      insuranceReported: false,
    };

    try {
      setIsLoading(true);
      setError(null);
      const response = await createImmunization(newAdmin);
      // @ts-ignore
      if (response.success !== false) {
        setAdministrations([newAdmin, ...administrations]);
        setNewVaccine({
          patientId: '',
          vaccineType: 'covid-19',
          vaccineName: '',
          manufacturer: '',
          lotNumber: '',
          expiryDate: '',
          dose: '',
          route: 'intramuscular',
          site: 'left-deltoid',
          doseNumber: 1,
          totalDoses: 1,
          nextDueDate: '',
          consentObtained: false,
          consentBy: '',
          adverseReactions: '',
          notes: '',
          vfcEligible: false,
        });
        setActiveTab('records');
        showSuccess(`Vaccination ${newAdmin.administrationId} administered successfully`);
      } else {
        // @ts-ignore
        setError(response.error || 'Failed to record vaccination');
      }
    } catch (err) {
      console.error('Error recording vaccination:', err);
      setError('An error occurred while recording the vaccination');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredAdministrations = administrations.filter((a) => {
    const matchesSearch =
      a.administrationId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.vaccineName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.lotNumber.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || a.status === statusFilter;
    const matchesPatient = !selectedPatient || a.patientId === selectedPatient;

    return matchesSearch && matchesStatus && matchesPatient;
  });

  const getStatusBadge = (status: VaccinationStatus) => {
    const badges = {
      scheduled: 'bg-blue-100 text-blue-800',
      administered: 'bg-green-100 text-green-800',
      declined: 'bg-red-100 text-red-800',
      deferred: 'bg-yellow-100 text-yellow-800',
      contraindicated: 'bg-orange-100 text-orange-800',
    };
    return badges[status];
  };

  const getStatusIcon = (status: VaccinationStatus) => {
    switch (status) {
      case 'scheduled':
        return <Clock className="w-4 h-4" />;
      case 'administered':
        return <CheckCircle className="w-4 h-4" />;
      case 'declined':
        return <XCircle className="w-4 h-4" />;
      case 'deferred':
        return <AlertCircle className="w-4 h-4" />;
      case 'contraindicated':
        return <AlertTriangle className="w-4 h-4" />;
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString();
  };

  const formatDateTime = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-purple-600 to-violet-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">Immunization Management</h1>
        <p className="text-purple-100">Vaccine administration, tracking, and registry integration</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('records')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'records' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          Vaccination Records
        </button>
        <button
          onClick={() => setActiveTab('administer')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'administer' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          Administer Vaccine
        </button>
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'schedule' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          Immunization Schedule
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'history' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          Patient History
        </button>
      </div>

      {activeTab === 'records' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label htmlFor="imm-search" className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    id="imm-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by ID, patient, vaccine, or lot number..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="imm-status-filter" className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  id="imm-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as VaccinationStatus | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="administered">Administered</option>
                  <option value="declined">Declined</option>
                  <option value="deferred">Deferred</option>
                  <option value="contraindicated">Contraindicated</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {filteredAdministrations.map((admin) => (
              <div key={admin.administrationId} className="border border-gray-300 rounded-lg shadow-sm bg-white p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{admin.administrationId}</h3>
                      <span className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 ${getStatusBadge(admin.status)}`}>
                        {getStatusIcon(admin.status)}
                        {admin.status.toUpperCase()}
                      </span>
                      {admin.consentObtained && (
                        <span className="text-green-600 flex items-center gap-1 text-sm">
                          <Shield className="w-4 h-4" />
                          Consent
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{formatDateTime(admin.administeredAt)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 bg-purple-50 rounded-lg p-4">
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">Patient</p>
                    <p className="font-semibold text-gray-900">{admin.patientName}</p>
                    <p className="text-sm text-gray-600">{admin.patientId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">Vaccine</p>
                    <p className="font-semibold text-gray-900">{admin.vaccineName}</p>
                    <p className="text-sm text-gray-600">
                      {admin.manufacturer} • {admin.dose}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">Administration</p>
                    <p className="text-sm text-gray-900 capitalize">{admin.route.replace('-', ' ')}</p>
                    <p className="text-sm text-gray-600 capitalize">{admin.site.replace('-', ' ')}</p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4 text-sm mb-3">
                  <div>
                    <p className="text-gray-600 mb-1">Lot Number</p>
                    <p className="font-semibold text-gray-900">{admin.lotNumber}</p>
                  </div>
                  <div>
                    <p className="text-gray-600 mb-1">Expiry Date</p>
                    <p className="font-semibold text-gray-900">{admin.expiryDate}</p>
                  </div>
                  <div>
                    <p className="text-gray-600 mb-1">Dose Series</p>
                    <p className="font-semibold text-gray-900">
                      {admin.doseNumber} of {admin.totalDoses}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600 mb-1">Administered By</p>
                    <p className="font-semibold text-gray-900">{admin.administeredBy}</p>
                  </div>
                </div>

                {admin.nextDueDate && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                    <p className="text-sm text-blue-900">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      Next dose due: <span className="font-semibold">{formatDate(admin.nextDueDate)}</span>
                    </p>
                  </div>
                )}

                {admin.adverseReactions && (
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-700 mb-1">Adverse Reactions</p>
                    <p className="text-sm text-gray-900 bg-yellow-50 border border-yellow-200 rounded p-2">{admin.adverseReactions}</p>
                  </div>
                )}

                {admin.notes && (
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-700 mb-1">Notes</p>
                    <p className="text-sm text-gray-600 italic">{admin.notes}</p>
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs text-gray-600">
                  {admin.vfcEligible && (
                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">VFC Eligible</span>
                  )}
                  {admin.insuranceReported && (
                    <span className="bg-green-100 text-green-800 px-2 py-1 rounded">Insurance Reported</span>
                  )}
                  {admin.consentBy && (
                    <span className="text-gray-600">Consent by: {admin.consentBy}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'administer' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Syringe className="w-5 h-5" />
            Administer Vaccine
          </h2>

          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="imm-patient" className="block text-sm font-semibold text-gray-700 mb-2">
                  Patient <span className="text-red-600">*</span>
                </label>
                <select
                  id="imm-patient"
                  value={newVaccine.patientId}
                  onChange={(e) => setNewVaccine({ ...newVaccine, patientId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">Select patient...</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="imm-vaccine-type" className="block text-sm font-semibold text-gray-700 mb-2">
                  Vaccine Type <span className="text-red-600">*</span>
                </label>
                <select
                  id="imm-vaccine-type"
                  value={newVaccine.vaccineType}
                  onChange={(e) => setNewVaccine({ ...newVaccine, vaccineType: e.target.value as VaccineType })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="covid-19">COVID-19</option>
                  <option value="influenza">Influenza</option>
                  <option value="hepatitis-b">Hepatitis B</option>
                  <option value="hepatitis-a">Hepatitis A</option>
                  <option value="tetanus">Tetanus</option>
                  <option value="mmr">MMR (Measles, Mumps, Rubella)</option>
                  <option value="varicella">Varicella (Chickenpox)</option>
                  <option value="pneumococcal">Pneumococcal</option>
                  <option value="meningococcal">Meningococcal</option>
                  <option value="hpv">HPV</option>
                  <option value="rotavirus">Rotavirus</option>
                  <option value="dtap">DTaP</option>
                  <option value="polio">Polio</option>
                  <option value="bcg">BCG</option>
                  <option value="yellow-fever">Yellow Fever</option>
                  <option value="rabies">Rabies</option>
                  <option value="typhoid">Typhoid</option>
                  <option value="cholera">Cholera</option>
                </select>
              </div>

              <div className="col-span-2">
                <label htmlFor="imm-vaccine-name" className="block text-sm font-semibold text-gray-700 mb-2">
                  Vaccine Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-vaccine-name"
                  type="text"
                  value={newVaccine.vaccineName}
                  onChange={(e) => setNewVaccine({ ...newVaccine, vaccineName: e.target.value })}
                  placeholder="e.g., Pfizer-BioNTech COVID-19 Vaccine"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-manufacturer" className="block text-sm font-semibold text-gray-700 mb-2">
                  Manufacturer <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-manufacturer"
                  type="text"
                  value={newVaccine.manufacturer}
                  onChange={(e) => setNewVaccine({ ...newVaccine, manufacturer: e.target.value })}
                  placeholder="e.g., Pfizer"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-lot-number" className="block text-sm font-semibold text-gray-700 mb-2">
                  Lot Number <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-lot-number"
                  type="text"
                  value={newVaccine.lotNumber}
                  onChange={(e) => setNewVaccine({ ...newVaccine, lotNumber: e.target.value })}
                  placeholder="e.g., FF1234"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-expiry-date" className="block text-sm font-semibold text-gray-700 mb-2">
                  Expiry Date <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-expiry-date"
                  type="date"
                  value={newVaccine.expiryDate}
                  onChange={(e) => setNewVaccine({ ...newVaccine, expiryDate: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-dose" className="block text-sm font-semibold text-gray-700 mb-2">
                  Dose <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-dose"
                  type="text"
                  value={newVaccine.dose}
                  onChange={(e) => setNewVaccine({ ...newVaccine, dose: e.target.value })}
                  placeholder="e.g., 0.5 mL"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-route" className="block text-sm font-semibold text-gray-700 mb-2">
                  Route <span className="text-red-600">*</span>
                </label>
                <select
                  id="imm-route"
                  value={newVaccine.route}
                  onChange={(e) => setNewVaccine({ ...newVaccine, route: e.target.value as AdministrationRoute })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="intramuscular">Intramuscular (IM)</option>
                  <option value="subcutaneous">Subcutaneous (SC)</option>
                  <option value="intradermal">Intradermal (ID)</option>
                  <option value="oral">Oral</option>
                  <option value="intranasal">Intranasal</option>
                </select>
              </div>

              <div>
                <label htmlFor="imm-site" className="block text-sm font-semibold text-gray-700 mb-2">
                  Site <span className="text-red-600">*</span>
                </label>
                <select
                  id="imm-site"
                  value={newVaccine.site}
                  onChange={(e) => setNewVaccine({ ...newVaccine, site: e.target.value as AdministrationSite })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="left-deltoid">Left Deltoid</option>
                  <option value="right-deltoid">Right Deltoid</option>
                  <option value="left-thigh">Left Thigh</option>
                  <option value="right-thigh">Right Thigh</option>
                  <option value="oral">Oral</option>
                  <option value="nasal">Nasal</option>
                </select>
              </div>

              <div>
                <label htmlFor="imm-dose-number" className="block text-sm font-semibold text-gray-700 mb-2">Dose Number</label>
                <input
                  id="imm-dose-number"
                  type="number"
                  min="1"
                  value={newVaccine.doseNumber}
                  onChange={(e) => setNewVaccine({ ...newVaccine, doseNumber: parseInt(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-total-doses" className="block text-sm font-semibold text-gray-700 mb-2">Total Doses in Series</label>
                <input
                  id="imm-total-doses"
                  type="number"
                  min="1"
                  value={newVaccine.totalDoses}
                  onChange={(e) => setNewVaccine({ ...newVaccine, totalDoses: parseInt(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-next-due-date" className="block text-sm font-semibold text-gray-700 mb-2">Next Dose Due Date</label>
                <input
                  id="imm-next-due-date"
                  type="date"
                  value={newVaccine.nextDueDate}
                  onChange={(e) => setNewVaccine({ ...newVaccine, nextDueDate: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="col-span-2 flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <input
                    id="imm-consent-obtained"
                    type="checkbox"
                    checked={newVaccine.consentObtained}
                    onChange={(e) => setNewVaccine({ ...newVaccine, consentObtained: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <label htmlFor="imm-consent-obtained" className="text-sm font-semibold text-gray-700">Consent Obtained</label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="imm-vfc-eligible"
                    type="checkbox"
                    checked={newVaccine.vfcEligible}
                    onChange={(e) => setNewVaccine({ ...newVaccine, vfcEligible: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <label htmlFor="imm-vfc-eligible" className="text-sm font-semibold text-gray-700">VFC Eligible</label>
                </div>
              </div>

              {newVaccine.consentObtained && (
                <div className="col-span-2">
                  <label htmlFor="imm-consent-by" className="block text-sm font-semibold text-gray-700 mb-2">Consent Given By</label>
                  <input
                    id="imm-consent-by"
                    type="text"
                    value={newVaccine.consentBy}
                    onChange={(e) => setNewVaccine({ ...newVaccine, consentBy: e.target.value })}
                    placeholder="e.g., Patient, Parent, Guardian"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              )}

              <div className="col-span-2">
                <label htmlFor="imm-adverse-reactions" className="block text-sm font-semibold text-gray-700 mb-2">Adverse Reactions</label>
                <input
                  id="imm-adverse-reactions"
                  type="text"
                  value={newVaccine.adverseReactions}
                  onChange={(e) => setNewVaccine({ ...newVaccine, adverseReactions: e.target.value })}
                  placeholder="Document any reactions or 'None'"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="imm-notes" className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                <textarea
                  id="imm-notes"
                  value={newVaccine.notes}
                  onChange={(e) => setNewVaccine({ ...newVaccine, notes: e.target.value })}
                  placeholder="Additional notes..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
            <h3 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Vaccine Administration Checklist
            </h3>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• Verify patient identity and eligibility</li>
              <li>• Check vaccine lot number and expiry date</li>
              <li>• Obtain informed consent</li>
              <li>• Screen for contraindications and precautions</li>
              <li>• Prepare vaccine per manufacturer guidelines</li>
              <li>• Administer using proper technique and site</li>
              <li>• Observe for immediate adverse reactions (15-30 min)</li>
              <li>• Document administration and provide vaccination card</li>
            </ul>
          </div>

          <button
            onClick={handleAdminister}
            className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-semibold flex items-center justify-center gap-2"
          >
            <Syringe className="w-5 h-5" />
            Administer Vaccine
          </button>
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            South African Immunization Schedule (EPI-SA)
          </h2>

          <p className="text-gray-600 mb-6">
            Expanded Programme on Immunisation - recommended vaccines for children in South Africa
          </p>

          <div className="overflow-hidden border border-gray-300 rounded-lg">
            <table className="w-full">
              <thead className="bg-purple-50 border-b border-purple-200">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-purple-900">Vaccine</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-purple-900">Recommended Age</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-purple-900">Dose</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-purple-900">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {vaccineSchedule.map((item, idx) => (
                  <tr key={idx} className={item.isOverdue ? 'bg-red-50' : item.isDue ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{item.vaccineName}</p>
                      <p className="text-xs text-gray-600 capitalize">{item.vaccineType.replace('-', ' ')}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{item.recommendedAge}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      Dose {item.doseNumber} of {item.totalDoses}
                    </td>
                    <td className="px-4 py-3">
                      {item.isOverdue ? (
                        <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 w-fit">
                          <AlertTriangle className="w-3 h-3" />
                          OVERDUE
                        </span>
                      ) : item.isDue ? (
                        <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 w-fit">
                          <Clock className="w-3 h-3" />
                          DUE
                        </span>
                      ) : (
                        <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 w-fit">
                          <CheckCircle className="w-3 h-3" />
                          On Schedule
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-bold text-blue-900 mb-2">Additional Vaccines</h3>
            <p className="text-sm text-blue-800 mb-2">Vaccines available outside the EPI-SA schedule:</p>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• <strong>HPV:</strong> Girls 9-14 years (2 doses, 6 months apart)</li>
              <li>• <strong>COVID-19:</strong> As per updated guidelines</li>
              <li>• <strong>Influenza:</strong> Annual for high-risk groups</li>
              <li>• <strong>Hepatitis A:</strong> Travelers and high-risk groups</li>
              <li>• <strong>Yellow Fever:</strong> Required for travel to endemic areas</li>
              <li>• <strong>Rabies:</strong> Post-exposure prophylaxis or pre-exposure for high-risk</li>
            </ul>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <label htmlFor="imm-select-patient" className="block text-sm font-semibold text-gray-700 mb-2">Select Patient</label>
            <select
              id="imm-select-patient"
              value={selectedPatient}
              onChange={(e) => setSelectedPatient(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="">All Patients</option>
              {patients.map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.full_name} ({p.patient_id})
                </option>
              ))}
            </select>
          </div>

          {selectedPatient && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold mb-4">Immunization History</h3>
              <div className="space-y-3">
                {administrations
                  .filter((a) => a.patientId === selectedPatient)
                  .map((admin) => (
                    <div key={admin.administrationId} className="border-l-4 border-purple-500 bg-purple-50 p-4 rounded">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">{admin.vaccineName}</p>
                          <p className="text-sm text-gray-600">
                            Dose {admin.doseNumber} of {admin.totalDoses}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(admin.status)}`}>
                          {admin.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-gray-600">Date</p>
                          <p className="font-semibold">{formatDate(admin.administeredAt)}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Lot Number</p>
                          <p className="font-semibold">{admin.lotNumber}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Site</p>
                          <p className="font-semibold capitalize">{admin.site.replace('-', ' ')}</p>
                        </div>
                      </div>
                      {admin.nextDueDate && (
                        <p className="text-sm text-blue-900 mt-2 bg-blue-100 rounded px-2 py-1 inline-block">
                          Next due: {formatDate(admin.nextDueDate)}
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {!selectedPatient && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
              <User className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">Select a patient to view immunization history</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImmunizationPage;
