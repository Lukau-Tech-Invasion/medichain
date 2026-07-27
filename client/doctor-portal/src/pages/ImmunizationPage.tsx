import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, listImmunizations, createImmunization, useTranslation } from '@medichain/shared';
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
  const { t } = useTranslation();
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
      setError(t('docImmunization.errorLoad'));
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
      vaccineName: t('docImmunization.schedule_bcg_name'),
      recommendedAge: t('docImmunization.schedule_bcg_age'),
      doseNumber: 1,
      totalDoses: 1,
      isDue: false,
      isOverdue: false,
    },
    {
      vaccineType: 'hepatitis-b',
      vaccineName: t('docImmunization.schedule_hepatitis-b_name'),
      recommendedAge: t('docImmunization.schedule_hepatitis-b_age'),
      doseNumber: 1,
      totalDoses: 3,
      isDue: false,
      isOverdue: false,
    },
    {
      vaccineType: 'polio',
      vaccineName: t('docImmunization.schedule_polio_name'),
      recommendedAge: t('docImmunization.schedule_polio_age'),
      doseNumber: 1,
      totalDoses: 3,
      isDue: true,
      isOverdue: false,
    },
    {
      vaccineType: 'dtap',
      vaccineName: t('docImmunization.schedule_dtap_name'),
      recommendedAge: t('docImmunization.schedule_dtap_age'),
      doseNumber: 1,
      totalDoses: 3,
      isDue: true,
      isOverdue: false,
    },
    {
      vaccineType: 'pneumococcal',
      vaccineName: t('docImmunization.schedule_pneumococcal_name'),
      recommendedAge: t('docImmunization.schedule_pneumococcal_age'),
      doseNumber: 2,
      totalDoses: 3,
      isDue: false,
      isOverdue: false,
    },
    {
      vaccineType: 'rotavirus',
      vaccineName: t('docImmunization.schedule_rotavirus_name'),
      recommendedAge: t('docImmunization.schedule_rotavirus_age'),
      doseNumber: 1,
      totalDoses: 2,
      isDue: true,
      isOverdue: true,
    },
    {
      vaccineType: 'mmr',
      vaccineName: t('docImmunization.schedule_mmr_name'),
      recommendedAge: t('docImmunization.schedule_mmr_age'),
      doseNumber: 1,
      totalDoses: 2,
      isDue: false,
      isOverdue: false,
    },
  ];

  const handleAdminister = async () => {
    if (!newVaccine.patientId || !newVaccine.vaccineName || !newVaccine.lotNumber) {
      showWarning(t('docImmunization.warningRequiredFields'));
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
      const response = await createImmunization(newAdmin) as { success?: boolean; error?: string };
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
        showSuccess(t('docImmunization.administeredSuccess', { id: newAdmin.administrationId }));
      } else {
        setError(response.error || t('docImmunization.errorRecord'));
      }
    } catch (err) {
      console.error('Error recording vaccination:', err);
      setError(t('docImmunization.errorRecordGeneric'));
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
        <h1 className="text-3xl font-bold mb-2">{t('docImmunization.title')}</h1>
        <p className="text-purple-100">{t('docImmunization.subtitle')}</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('records')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'records' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          {t('docImmunization.tabRecords')}
        </button>
        <button
          onClick={() => setActiveTab('administer')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'administer' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          {t('docImmunization.tabAdminister')}
        </button>
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'schedule' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          {t('docImmunization.tabSchedule')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'history' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          {t('docImmunization.tabHistory')}
        </button>
      </div>

      {activeTab === 'records' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label htmlFor="imm-search" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.searchLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    id="imm-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docImmunization.searchPh')}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="imm-status-filter" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.statusLabel')}</label>
                <select
                  id="imm-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as VaccinationStatus | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docImmunization.allStatuses')}</option>
                  <option value="scheduled">{t('docImmunization.status_scheduled')}</option>
                  <option value="administered">{t('docImmunization.status_administered')}</option>
                  <option value="declined">{t('docImmunization.status_declined')}</option>
                  <option value="deferred">{t('docImmunization.status_deferred')}</option>
                  <option value="contraindicated">{t('docImmunization.status_contraindicated')}</option>
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
                        {t(`docImmunization.status_${admin.status}`).toUpperCase()}
                      </span>
                      {admin.consentObtained && (
                        <span className="text-green-600 flex items-center gap-1 text-sm">
                          <Shield className="w-4 h-4" />
                          {t('docImmunization.consentBadge')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{formatDateTime(admin.administeredAt)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 bg-purple-50 rounded-lg p-4">
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">{t('docImmunization.patientLabel')}</p>
                    <p className="font-semibold text-gray-900">{admin.patientName}</p>
                    <p className="text-sm text-gray-600">{admin.patientId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">{t('docImmunization.vaccineLabel')}</p>
                    <p className="font-semibold text-gray-900">{admin.vaccineName}</p>
                    <p className="text-sm text-gray-600">
                      {admin.manufacturer} • {admin.dose}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">{t('docImmunization.administrationLabel')}</p>
                    <p className="text-sm text-gray-900">{t(`docImmunization.route_${admin.route}`)}</p>
                    <p className="text-sm text-gray-600">{t(`docImmunization.site_${admin.site}`)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4 text-sm mb-3">
                  <div>
                    <p className="text-gray-600 mb-1">{t('docImmunization.lotNumberLabel')}</p>
                    <p className="font-semibold text-gray-900">{admin.lotNumber}</p>
                  </div>
                  <div>
                    <p className="text-gray-600 mb-1">{t('docImmunization.expiryDateLabel')}</p>
                    <p className="font-semibold text-gray-900">{admin.expiryDate}</p>
                  </div>
                  <div>
                    <p className="text-gray-600 mb-1">{t('docImmunization.doseSeriesLabel')}</p>
                    <p className="font-semibold text-gray-900">
                      {t('docImmunization.doseOfTotal', { dose: admin.doseNumber ?? '', total: admin.totalDoses ?? '' })}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600 mb-1">{t('docImmunization.administeredByLabel')}</p>
                    <p className="font-semibold text-gray-900">{admin.administeredBy}</p>
                  </div>
                </div>

                {admin.nextDueDate && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                    <p className="text-sm text-blue-900">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      {t('docImmunization.nextDoseDueLine', { date: formatDate(admin.nextDueDate) })}
                    </p>
                  </div>
                )}

                {admin.adverseReactions && (
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-700 mb-1">{t('docImmunization.adverseReactionsLabel')}</p>
                    <p className="text-sm text-gray-900 bg-yellow-50 border border-yellow-200 rounded p-2">{admin.adverseReactions}</p>
                  </div>
                )}

                {admin.notes && (
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-700 mb-1">{t('docImmunization.notesLabel')}</p>
                    <p className="text-sm text-gray-600 italic">{admin.notes}</p>
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs text-gray-600">
                  {admin.vfcEligible && (
                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">{t('docImmunization.vfcEligibleBadge')}</span>
                  )}
                  {admin.insuranceReported && (
                    <span className="bg-green-100 text-green-800 px-2 py-1 rounded">{t('docImmunization.insuranceReportedBadge')}</span>
                  )}
                  {admin.consentBy && (
                    <span className="text-gray-600">{t('docImmunization.consentByLine', { name: admin.consentBy })}</span>
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
            {t('docImmunization.administerVaccineHeading')}
          </h2>

          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="imm-patient" className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('docImmunization.patientRequired')} <span className="text-red-600">*</span>
                </label>
                <select
                  id="imm-patient"
                  value={newVaccine.patientId}
                  onChange={(e) => setNewVaccine({ ...newVaccine, patientId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">{t('docImmunization.selectPatientPh')}</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="imm-vaccine-type" className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('docImmunization.vaccineTypeRequired')} <span className="text-red-600">*</span>
                </label>
                <select
                  id="imm-vaccine-type"
                  value={newVaccine.vaccineType}
                  onChange={(e) => setNewVaccine({ ...newVaccine, vaccineType: e.target.value as VaccineType })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="covid-19">{t('docImmunization.vaccineType_covid-19')}</option>
                  <option value="influenza">{t('docImmunization.vaccineType_influenza')}</option>
                  <option value="hepatitis-b">{t('docImmunization.vaccineType_hepatitis-b')}</option>
                  <option value="hepatitis-a">{t('docImmunization.vaccineType_hepatitis-a')}</option>
                  <option value="tetanus">{t('docImmunization.vaccineType_tetanus')}</option>
                  <option value="mmr">{t('docImmunization.vaccineType_mmr')}</option>
                  <option value="varicella">{t('docImmunization.vaccineType_varicella')}</option>
                  <option value="pneumococcal">{t('docImmunization.vaccineType_pneumococcal')}</option>
                  <option value="meningococcal">{t('docImmunization.vaccineType_meningococcal')}</option>
                  <option value="hpv">{t('docImmunization.vaccineType_hpv')}</option>
                  <option value="rotavirus">{t('docImmunization.vaccineType_rotavirus')}</option>
                  <option value="dtap">{t('docImmunization.vaccineType_dtap')}</option>
                  <option value="polio">{t('docImmunization.vaccineType_polio')}</option>
                  <option value="bcg">{t('docImmunization.vaccineType_bcg')}</option>
                  <option value="yellow-fever">{t('docImmunization.vaccineType_yellow-fever')}</option>
                  <option value="rabies">{t('docImmunization.vaccineType_rabies')}</option>
                  <option value="typhoid">{t('docImmunization.vaccineType_typhoid')}</option>
                  <option value="cholera">{t('docImmunization.vaccineType_cholera')}</option>
                </select>
              </div>

              <div className="col-span-2">
                <label htmlFor="imm-vaccine-name" className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('docImmunization.vaccineNameRequired')} <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-vaccine-name"
                  type="text"
                  value={newVaccine.vaccineName}
                  onChange={(e) => setNewVaccine({ ...newVaccine, vaccineName: e.target.value })}
                  placeholder={t('docImmunization.vaccineNamePh')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-manufacturer" className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('docImmunization.manufacturerRequired')} <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-manufacturer"
                  type="text"
                  value={newVaccine.manufacturer}
                  onChange={(e) => setNewVaccine({ ...newVaccine, manufacturer: e.target.value })}
                  placeholder={t('docImmunization.manufacturerPh')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-lot-number" className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('docImmunization.lotNumberRequired')} <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-lot-number"
                  type="text"
                  value={newVaccine.lotNumber}
                  onChange={(e) => setNewVaccine({ ...newVaccine, lotNumber: e.target.value })}
                  placeholder={t('docImmunization.lotNumberPh')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-expiry-date" className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('docImmunization.expiryDateRequired')} <span className="text-red-600">*</span>
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
                  {t('docImmunization.doseRequired')} <span className="text-red-600">*</span>
                </label>
                <input
                  id="imm-dose"
                  type="text"
                  value={newVaccine.dose}
                  onChange={(e) => setNewVaccine({ ...newVaccine, dose: e.target.value })}
                  placeholder={t('docImmunization.dosePh')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="imm-route" className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('docImmunization.routeRequired')} <span className="text-red-600">*</span>
                </label>
                <select
                  id="imm-route"
                  value={newVaccine.route}
                  onChange={(e) => setNewVaccine({ ...newVaccine, route: e.target.value as AdministrationRoute })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="intramuscular">{t('docImmunization.route_intramuscular')}</option>
                  <option value="subcutaneous">{t('docImmunization.route_subcutaneous')}</option>
                  <option value="intradermal">{t('docImmunization.route_intradermal')}</option>
                  <option value="oral">{t('docImmunization.route_oral')}</option>
                  <option value="intranasal">{t('docImmunization.route_intranasal')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="imm-site" className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('docImmunization.siteRequired')} <span className="text-red-600">*</span>
                </label>
                <select
                  id="imm-site"
                  value={newVaccine.site}
                  onChange={(e) => setNewVaccine({ ...newVaccine, site: e.target.value as AdministrationSite })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="left-deltoid">{t('docImmunization.site_left-deltoid')}</option>
                  <option value="right-deltoid">{t('docImmunization.site_right-deltoid')}</option>
                  <option value="left-thigh">{t('docImmunization.site_left-thigh')}</option>
                  <option value="right-thigh">{t('docImmunization.site_right-thigh')}</option>
                  <option value="oral">{t('docImmunization.site_oral')}</option>
                  <option value="nasal">{t('docImmunization.site_nasal')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="imm-dose-number" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.doseNumberLabel')}</label>
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
                <label htmlFor="imm-total-doses" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.totalDosesLabel')}</label>
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
                <label htmlFor="imm-next-due-date" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.nextDueDateLabel')}</label>
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
                  <label htmlFor="imm-consent-obtained" className="text-sm font-semibold text-gray-700">{t('docImmunization.consentObtainedCheckbox')}</label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="imm-vfc-eligible"
                    type="checkbox"
                    checked={newVaccine.vfcEligible}
                    onChange={(e) => setNewVaccine({ ...newVaccine, vfcEligible: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <label htmlFor="imm-vfc-eligible" className="text-sm font-semibold text-gray-700">{t('docImmunization.vfcEligibleCheckbox')}</label>
                </div>
              </div>

              {newVaccine.consentObtained && (
                <div className="col-span-2">
                  <label htmlFor="imm-consent-by" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.consentGivenByLabel')}</label>
                  <input
                    id="imm-consent-by"
                    type="text"
                    value={newVaccine.consentBy}
                    onChange={(e) => setNewVaccine({ ...newVaccine, consentBy: e.target.value })}
                    placeholder={t('docImmunization.consentGivenByPh')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              )}

              <div className="col-span-2">
                <label htmlFor="imm-adverse-reactions" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.adverseReactionsLabel')}</label>
                <input
                  id="imm-adverse-reactions"
                  type="text"
                  value={newVaccine.adverseReactions}
                  onChange={(e) => setNewVaccine({ ...newVaccine, adverseReactions: e.target.value })}
                  placeholder={t('docImmunization.adverseReactionsPh')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="imm-notes" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.notesLabel')}</label>
                <textarea
                  id="imm-notes"
                  value={newVaccine.notes}
                  onChange={(e) => setNewVaccine({ ...newVaccine, notes: e.target.value })}
                  placeholder={t('docImmunization.notesPh')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
            <h3 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              {t('docImmunization.checklistHeading')}
            </h3>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• {t('docImmunization.checklist_1')}</li>
              <li>• {t('docImmunization.checklist_2')}</li>
              <li>• {t('docImmunization.checklist_3')}</li>
              <li>• {t('docImmunization.checklist_4')}</li>
              <li>• {t('docImmunization.checklist_5')}</li>
              <li>• {t('docImmunization.checklist_6')}</li>
              <li>• {t('docImmunization.checklist_7')}</li>
              <li>• {t('docImmunization.checklist_8')}</li>
            </ul>
          </div>

          <button
            onClick={handleAdminister}
            className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-semibold flex items-center justify-center gap-2"
          >
            <Syringe className="w-5 h-5" />
            {t('docImmunization.administerButton')}
          </button>
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            {t('docImmunization.epiScheduleHeading')}
          </h2>

          <p className="text-gray-600 mb-6">
            {t('docImmunization.epiScheduleSubtitle')}
          </p>

          <div className="overflow-hidden border border-gray-300 rounded-lg">
            <table className="w-full">
              <thead className="bg-purple-50 border-b border-purple-200">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-purple-900">{t('docImmunization.tableVaccine')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-purple-900">{t('docImmunization.tableRecommendedAge')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-purple-900">{t('docImmunization.tableDose')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-purple-900">{t('docImmunization.tableStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {vaccineSchedule.map((item, idx) => (
                  <tr key={idx} className={item.isOverdue ? 'bg-red-50' : item.isDue ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{item.vaccineName}</p>
                      <p className="text-xs text-gray-600">{t(`docImmunization.vaccineType_${item.vaccineType}`)}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{item.recommendedAge}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {t('docImmunization.doseOfTotal', { dose: item.doseNumber, total: item.totalDoses })}
                    </td>
                    <td className="px-4 py-3">
                      {item.isOverdue ? (
                        <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 w-fit">
                          <AlertTriangle className="w-3 h-3" />
                          {t('docImmunization.overdueBadge')}
                        </span>
                      ) : item.isDue ? (
                        <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 w-fit">
                          <Clock className="w-3 h-3" />
                          {t('docImmunization.dueBadge')}
                        </span>
                      ) : (
                        <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 w-fit">
                          <CheckCircle className="w-3 h-3" />
                          {t('docImmunization.onScheduleBadge')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-bold text-blue-900 mb-2">{t('docImmunization.additionalVaccinesHeading')}</h3>
            <p className="text-sm text-blue-800 mb-2">{t('docImmunization.additionalVaccinesSubtitle')}</p>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• <strong>{t('docImmunization.additional_hpv_name')}</strong> {t('docImmunization.additional_hpv_desc')}</li>
              <li>• <strong>{t('docImmunization.additional_covid_name')}</strong> {t('docImmunization.additional_covid_desc')}</li>
              <li>• <strong>{t('docImmunization.additional_flu_name')}</strong> {t('docImmunization.additional_flu_desc')}</li>
              <li>• <strong>{t('docImmunization.additional_hepA_name')}</strong> {t('docImmunization.additional_hepA_desc')}</li>
              <li>• <strong>{t('docImmunization.additional_yellowFever_name')}</strong> {t('docImmunization.additional_yellowFever_desc')}</li>
              <li>• <strong>{t('docImmunization.additional_rabies_name')}</strong> {t('docImmunization.additional_rabies_desc')}</li>
            </ul>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <label htmlFor="imm-select-patient" className="block text-sm font-semibold text-gray-700 mb-2">{t('docImmunization.selectPatientLabel')}</label>
            <select
              id="imm-select-patient"
              value={selectedPatient}
              onChange={(e) => setSelectedPatient(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="">{t('docImmunization.allPatients')}</option>
              {patients.map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.full_name} ({p.patient_id})
                </option>
              ))}
            </select>
          </div>

          {selectedPatient && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold mb-4">{t('docImmunization.immunizationHistoryHeading')}</h3>
              <div className="space-y-3">
                {administrations
                  .filter((a) => a.patientId === selectedPatient)
                  .map((admin) => (
                    <div key={admin.administrationId} className="border-l-4 border-purple-500 bg-purple-50 p-4 rounded">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">{admin.vaccineName}</p>
                          <p className="text-sm text-gray-600">
                            {t('docImmunization.doseOfTotal', { dose: admin.doseNumber ?? '', total: admin.totalDoses ?? '' })}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(admin.status)}`}>
                          {t(`docImmunization.status_${admin.status}`).toUpperCase()}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-gray-600">{t('docImmunization.dateLabel')}</p>
                          <p className="font-semibold">{formatDate(admin.administeredAt)}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">{t('docImmunization.lotNumberLabel')}</p>
                          <p className="font-semibold">{admin.lotNumber}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">{t('docImmunization.historySiteLabel')}</p>
                          <p className="font-semibold">{t(`docImmunization.site_${admin.site}`)}</p>
                        </div>
                      </div>
                      {admin.nextDueDate && (
                        <p className="text-sm text-blue-900 mt-2 bg-blue-100 rounded px-2 py-1 inline-block">
                          {t('docImmunization.nextDueLine', { date: formatDate(admin.nextDueDate) })}
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
              <p className="text-gray-600">{t('docImmunization.selectPatientForHistory')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImmunizationPage;
