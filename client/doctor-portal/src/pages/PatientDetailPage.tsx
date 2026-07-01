import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiUrl, getApiErrorMessage, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store';
import { 
  ArrowLeft, 
  User, 
  Heart, 
  AlertTriangle, 
  Pill, 
  FileText, 
  Phone,
  Edit,
  Download,
  Clock
} from 'lucide-react';

interface PatientDetails {
  patientId: string;
  fullName: string;
  dateOfBirth: string;
  nationalHealthId: string;
  bloodType: string;
  allergies: string[];
  currentMedications: string[];
  chronicConditions: string[];
  emergencyContacts: Array<{
    name: string;
    phone: string;
    relationship: string;
  }>;
  organDonor: boolean;
  dnrStatus: boolean;
  lastUpdated: string;
  registeredBy: string;
}

function PatientDetailPage() {
  const { t } = useTranslation();
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [patient, setPatient] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'records' | 'access'>('overview');

  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!user || !patientId) return;
    
    const fetchPatient = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(apiUrl(`/api/patients/${patientId}`), {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            setPatient(null);
          } else {
            const errorData = await response.json().catch(() => ({}));
            setError(getApiErrorMessage(errorData, t('docPatientDetail.errorStatus', { status: response.status })));
          }
          setLoading(false);
          return;
        }

        const data = await response.json();
        
        // Map API response to PatientDetails interface
        setPatient({
          patientId: data.patient_id,
          fullName: data.full_name,
          dateOfBirth: data.date_of_birth,
          nationalHealthId: data.national_id || data.patient_id,
          bloodType: data.emergency_info?.blood_type || t('docPatientDetail.unknown'),
          allergies: data.emergency_info?.allergies?.map((a: { name: string }) => a.name) || [],
          currentMedications: data.emergency_info?.current_medications || [],
          chronicConditions: data.emergency_info?.chronic_conditions || [],
          emergencyContacts: data.emergency_info?.emergency_contacts || [],
          organDonor: data.emergency_info?.organ_donor || false,
          dnrStatus: data.emergency_info?.dnr_status || false,
          lastUpdated: data.last_updated || new Date().toISOString(),
          registeredBy: data.primary_doctor?.provider_id || t('docPatientDetail.unknown'),
        });
      } catch (err) {
        console.error('Failed to fetch patient:', err);
        setError(t('docPatientDetail.failConnect'));
      }
      setLoading(false);
    };

    fetchPatient();
  }, [patientId, user]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-600 border-t-transparent"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <AlertTriangle className="mx-auto mb-4 text-red-400" size={64} />
          <h2 className="text-xl font-semibold text-gray-700">{t('docPatientDetail.errorLoading')}</h2>
          <p className="text-gray-500 mt-2">{error}</p>
          <Link to="/patients" className="mt-4 inline-block text-primary-600 hover:underline">
            {t('docPatientDetail.backToSearch')}
          </Link>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <User className="mx-auto mb-4 text-gray-300" size={64} />
          <h2 className="text-xl font-semibold text-gray-700">{t('docPatientDetail.notFound')}</h2>
          <p className="text-gray-500 mt-2">{t('docPatientDetail.notExist', { id: patientId ?? '' })}</p>
          <Link to="/patients" className="mt-4 inline-block text-primary-600 hover:underline">
            {t('docPatientDetail.backToSearch')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Back Button */}
      <Link to="/patients" className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={20} />
        {t('docPatientDetail.backToPatients')}
      </Link>

      {/* Patient Header */}
      <div className="bg-white rounded-xl shadow p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold text-primary-600">
                {patient.fullName.split(' ').map(n => n[0]).join('')}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{patient.fullName}</h1>
              <p className="text-gray-500">{patient.nationalHealthId}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                  {t('docPatientDetail.dob', { date: patient.dateOfBirth })}
                </span>
                <span className="text-sm bg-emergency-100 text-emergency-700 px-2 py-1 rounded font-medium">
                  {t('docPatientDetail.blood', { type: patient.bloodType })}
                </span>
                {patient.dnrStatus && (
                  <span className="text-sm bg-red-100 text-red-700 px-2 py-1 rounded font-medium">
                    {t('docPatientDetail.dnr')}
                  </span>
                )}
                {patient.organDonor && (
                  <span className="text-sm bg-green-100 text-green-700 px-2 py-1 rounded">
                    {t('docPatientDetail.organDonor')}
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-2">
              <Download size={18} />
              {t('docPatientDetail.export')}
            </button>
            <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2">
              <Edit size={18} />
              {t('docPatientDetail.edit')}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {(['overview', 'records', 'access'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md transition-colors ${
              activeTab === tab
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'access' ? t('docPatientDetail.tabAccess') : tab === 'records' ? t('docPatientDetail.tabRecords') : t('docPatientDetail.tabOverview')}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Allergies */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="text-emergency-600" size={20} />
              <h3 className="font-semibold text-gray-900">{t('docPatientDetail.allergies')}</h3>
            </div>
            {patient.allergies.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.allergies.map((allergy, i) => (
                  <span key={i} className="bg-emergency-100 text-emergency-700 px-3 py-1 rounded-full text-sm">
                    {allergy}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">{t('docPatientDetail.noAllergies')}</p>
            )}
          </div>

          {/* Medications */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Pill className="text-primary-600" size={20} />
              <h3 className="font-semibold text-gray-900">{t('docPatientDetail.currentMeds')}</h3>
            </div>
            {patient.currentMedications.length > 0 ? (
              <ul className="space-y-2">
                {patient.currentMedications.map((med, i) => (
                  <li key={i} className="text-gray-700 flex items-start gap-2">
                    <span className="w-2 h-2 bg-primary-400 rounded-full mt-2"></span>
                    {med}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500">{t('docPatientDetail.noMeds')}</p>
            )}
          </div>

          {/* Chronic Conditions */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Heart className="text-red-500" size={20} />
              <h3 className="font-semibold text-gray-900">{t('docPatientDetail.chronicConditions')}</h3>
            </div>
            {patient.chronicConditions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.chronicConditions.map((condition, i) => (
                  <span key={i} className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-sm">
                    {condition}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">{t('docPatientDetail.noConditions')}</p>
            )}
          </div>

          {/* Emergency Contacts */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Phone className="text-success-600" size={20} />
              <h3 className="font-semibold text-gray-900">{t('docPatientDetail.emergencyContacts')}</h3>
            </div>
            {patient.emergencyContacts.map((contact, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{contact.name}</p>
                  <p className="text-sm text-gray-500">{contact.relationship}</p>
                </div>
                <a href={`tel:${contact.phone}`} className="text-primary-600 hover:underline">
                  {contact.phone}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'records' && (
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="text-gray-400" size={20} />
            <h3 className="font-semibold text-gray-900">{t('docPatientDetail.medicalRecords')}</h3>
          </div>
          <p className="text-gray-500 text-center py-8">
            {t('docPatientDetail.recordsLine1')}<br />
            {t('docPatientDetail.recordsLine2')}
          </p>
        </div>
      )}

      {activeTab === 'access' && (
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="text-gray-400" size={20} />
            <h3 className="font-semibold text-gray-900">{t('docPatientDetail.accessHistory')}</h3>
          </div>
          <p className="text-gray-500 text-center py-8">
            {t('docPatientDetail.accessLine1')}<br />
            {t('docPatientDetail.accessLine2')}
          </p>
        </div>
      )}
    </div>
  );
}

export default PatientDetailPage;
