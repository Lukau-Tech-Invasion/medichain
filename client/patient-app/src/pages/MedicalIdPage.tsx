import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  AlertTriangle,
  Heart,
  Droplet,
  Pill,
  Phone,
  Shield,
  User,
  Calendar,
  MapPin,
  Stethoscope,
  FileText,
  Download,
  Share2,
  Lock,
  CheckCircle,
  XCircle,
} from 'lucide-react';

interface MedicalIdData {
  patient_id: string;
  name: string;
  date_of_birth: string;
  blood_type: string;
  allergies: Array<{
    name: string;
    severity: string;
    reaction?: string;
  }>;
  medications: string[];
  conditions: string[];
  emergency_contacts: Array<{
    name: string;
    phone: string;
    relationship: string;
    can_make_medical_decisions: boolean;
  }>;
  organ_donor: boolean;
  dnr_status: boolean;
  languages: string[];
  insurance?: {
    provider: string;
    policy_number: string;
  };
  primary_doctor?: {
    name: string;
    phone: string;
    facility?: string;
  };
  preferences: {
    show_when_locked: boolean;
    enable_location_sharing: boolean;
    auto_notify_family: boolean;
  };
}

/**
 * Medical ID Page
 * 
 * Apple Health-style Medical ID that can be shown on lock screen.
 * Critical information for first responders.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function MedicalIdPage() {
  const navigate = useNavigate();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [data, setData] = useState<MedicalIdData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLockScreenPreview, setShowLockScreenPreview] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadMedicalId();
    }
  }, [patient]);

  const loadMedicalId = async () => {
    if (!patient) return;
    
    setIsLoading(true);
    
    try {
      const userId = patient.healthId;
      const response = await fetch(apiUrl(`/api/medical-id/${userId}`), {
        headers: {
          'X-User-Id': patient.walletAddress,
          'X-Health-Id': patient.healthId,
        },
      });
      
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        console.error('Failed to load Medical ID');
        setData(null);
      }
    } catch (error) {
      console.error('Error loading Medical ID:', error);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'severe': return 'bg-red-100 text-red-800 border-red-200';
      case 'moderate': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'mild': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleShare = async () => {
    if (!data || !navigator.share) return;
    
    const text = `
MEDICAL ID - ${data.name}
Blood Type: ${data.blood_type}
Allergies: ${data.allergies.map(a => `${a.name} (${a.severity})`).join(', ')}
Conditions: ${data.conditions.join(', ')}
Emergency Contact: ${data.emergency_contacts[0]?.name} - ${data.emergency_contacts[0]?.phone}
    `.trim();

    try {
      await navigator.share({
        title: `Medical ID - ${data.name}`,
        text,
      });
    } catch {
      // User cancelled
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-10 bg-neutral-200 rounded w-48 mx-auto" />
        <div className="h-64 bg-neutral-200 rounded-3xl" />
        <div className="h-32 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <p>Unable to load Medical ID</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header with settings */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900">Medical ID</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLockScreenPreview(!showLockScreenPreview)}
            className="p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
            title="Lock screen preview"
          >
            <Lock className="w-5 h-5" />
          </button>
          <button
            onClick={handleShare}
            className="p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
            title="Share"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Lock Screen Setting */}
      <div className={`p-4 rounded-xl border-2 ${data.preferences.show_when_locked ? 'bg-green-50 border-green-200' : 'bg-neutral-50 border-neutral-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Lock className={data.preferences.show_when_locked ? 'text-green-600' : 'text-neutral-400'} />
            <div>
              <p className="font-medium">Show When Locked</p>
              <p className="text-sm text-neutral-600">Emergency access from lock screen</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={data.preferences.show_when_locked}
              onChange={() => {}}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
          </label>
        </div>
      </div>

      {/* Main Medical ID Card */}
      <div className="bg-white rounded-3xl shadow-lg overflow-hidden">
        {/* Red Emergency Header */}
        <div className="bg-gradient-to-r from-red-500 to-red-600 text-white p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
              <User className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">{data.name}</h2>
              <div className="flex items-center gap-2 text-red-100">
                <Calendar className="w-4 h-4" />
                <span>{new Date(data.date_of_birth).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Blood Type & Organ Donor */}
        <div className="grid grid-cols-2 divide-x divide-neutral-100">
          <div className="p-4 text-center">
            <Droplet className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-3xl font-bold text-neutral-900">{data.blood_type}</p>
            <p className="text-sm text-neutral-600">Blood Type</p>
          </div>
          <div className="p-4 text-center">
            <Heart className={`w-8 h-8 mx-auto mb-2 ${data.organ_donor ? 'text-green-500' : 'text-neutral-300'}`} />
            <p className="text-lg font-bold text-neutral-900">
              {data.organ_donor ? 'Yes' : 'No'}
            </p>
            <p className="text-sm text-neutral-600">Organ Donor</p>
          </div>
        </div>

        {/* DNR Status */}
        {data.dnr_status && (
          <div className="bg-amber-50 border-t border-b border-amber-200 p-4 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <div>
              <p className="font-bold text-amber-800">DNR - Do Not Resuscitate</p>
              <p className="text-sm text-amber-700">Advanced directive on file</p>
            </div>
          </div>
        )}

        {/* Allergies */}
        <div className="p-4 border-t border-neutral-100">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h3 className="font-bold text-neutral-900">Allergies & Reactions</h3>
          </div>
          {data.allergies.length > 0 ? (
            <div className="space-y-2">
              {data.allergies.map((allergy, i) => (
                <div key={i} className={`p-3 rounded-lg border ${getSeverityColor(allergy.severity)}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{allergy.name}</span>
                    <span className="text-xs font-bold uppercase">{allergy.severity}</span>
                  </div>
                  {allergy.reaction && (
                    <p className="text-sm mt-1 opacity-80">{allergy.reaction}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-neutral-500 italic">No known allergies</p>
          )}
        </div>

        {/* Medical Conditions */}
        <div className="p-4 border-t border-neutral-100">
          <div className="flex items-center gap-2 mb-3">
            <Stethoscope className="w-5 h-5 text-blue-500" />
            <h3 className="font-bold text-neutral-900">Medical Conditions</h3>
          </div>
          {data.conditions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {data.conditions.map((condition, i) => (
                <span key={i} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">
                  {condition}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-neutral-500 italic">None listed</p>
          )}
        </div>

        {/* Medications */}
        <div className="p-4 border-t border-neutral-100">
          <div className="flex items-center gap-2 mb-3">
            <Pill className="w-5 h-5 text-purple-500" />
            <h3 className="font-bold text-neutral-900">Current Medications</h3>
          </div>
          {data.medications.length > 0 ? (
            <ul className="space-y-2">
              {data.medications.map((med, i) => (
                <li key={i} className="flex items-center gap-2 text-neutral-700">
                  <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                  {med}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-neutral-500 italic">None listed</p>
          )}
        </div>

        {/* Emergency Contacts */}
        <div className="p-4 border-t border-neutral-100 bg-neutral-50">
          <div className="flex items-center gap-2 mb-3">
            <Phone className="w-5 h-5 text-green-500" />
            <h3 className="font-bold text-neutral-900">Emergency Contacts</h3>
          </div>
          {data.emergency_contacts.map((contact, i) => (
            <div key={i} className="bg-white p-3 rounded-lg border border-neutral-200 mb-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-neutral-900">{contact.name}</p>
                  <p className="text-sm text-neutral-600">{contact.relationship}</p>
                </div>
                <a
                  href={`tel:${encodeURIComponent(contact.phone.replace(/[^0-9+\-()\s]/g, ''))}`}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
                >
                  <Phone className="w-4 h-4" />
                  Call
                </a>
              </div>
              <p className="text-sm text-neutral-600 mt-2">{contact.phone}</p>
              {contact.can_make_medical_decisions && (
                <div className="flex items-center gap-1 mt-2 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  Can make medical decisions
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Primary Doctor */}
        {data.primary_doctor && (
          <div className="p-4 border-t border-neutral-100">
            <div className="flex items-center gap-2 mb-3">
              <Stethoscope className="w-5 h-5 text-blue-500" />
              <h3 className="font-bold text-neutral-900">Primary Care Provider</h3>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="font-medium text-neutral-900">{data.primary_doctor.name}</p>
              {data.primary_doctor.facility && (
                <p className="text-sm text-neutral-600 flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  {data.primary_doctor.facility}
                </p>
              )}
              <a
                href={`tel:${encodeURIComponent(data.primary_doctor.phone.replace(/[^0-9+\-()\s]/g, ''))}`}
                className="text-blue-600 text-sm mt-1 inline-block"
              >
                {data.primary_doctor.phone}
              </a>
            </div>
          </div>
        )}

        {/* Insurance */}
        {data.insurance && (
          <div className="p-4 border-t border-neutral-100">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 text-indigo-500" />
              <h3 className="font-bold text-neutral-900">Insurance</h3>
            </div>
            <div className="bg-indigo-50 p-3 rounded-lg">
              <p className="font-medium text-neutral-900">{data.insurance.provider}</p>
              <p className="text-sm text-neutral-600">Policy: {data.insurance.policy_number}</p>
            </div>
          </div>
        )}

        {/* Languages */}
        <div className="p-4 border-t border-neutral-100">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-neutral-500" />
            <h3 className="font-bold text-neutral-900">Languages</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.languages.map((lang, i) => (
              <span key={i} className="px-3 py-1 bg-neutral-100 text-neutral-700 rounded-full text-sm">
                {lang}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Emergency Numbers */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <h3 className="font-bold text-red-800 mb-3">🚨 Emergency Services</h3>
        <div className="grid grid-cols-2 gap-3">
          <a href="tel:10177" className="bg-white p-3 rounded-lg text-center shadow-sm">
            <p className="text-2xl font-bold text-red-600">10177</p>
            <p className="text-sm text-neutral-600">Ambulance (SA)</p>
          </a>
          <a href="tel:10111" className="bg-white p-3 rounded-lg text-center shadow-sm">
            <p className="text-2xl font-bold text-red-600">10111</p>
            <p className="text-sm text-neutral-600">Police (SA)</p>
          </a>
        </div>
      </div>
    </div>
  );
}

export default MedicalIdPage;
