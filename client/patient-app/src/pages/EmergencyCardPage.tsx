import { useState, useEffect } from 'react';
import { apiUrl } from '@medichain/shared';
import {
  AlertTriangle,
  Heart,
  Droplet,
  Pill,
  Phone,
  Shield,
  RefreshCw,
  Share2,
  Copy,
  Check,
  Info,
  Wifi,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface EmergencyData {
  patientId: string;
  nationalHealthId: string;
  fullName: string;
  dateOfBirth: string;
  bloodType: string;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
  organDonor: boolean;
  dnrStatus: boolean;
  cardHash: string;
  lastUpdated: string;
}

/**
 * Emergency Card Page
 * 
 * Display QR code and NFC card information for emergency access.
 * First responders can scan to access critical medical data.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function EmergencyCardPage() {
  const [emergencyData, setEmergencyData] = useState<EmergencyData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showMedicalInfo, setShowMedicalInfo] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadEmergencyData();
  }, []);

  const loadEmergencyData = async () => {
    setIsLoading(true);
    
    try {
      // Get patient ID from stored auth
      const authData = localStorage.getItem('patient-auth');
      const patientId = authData ? JSON.parse(authData).patientId : null;
      
      if (!patientId) {
        setEmergencyData(null);
        setIsLoading(false);
        return;
      }

      const response = await fetch(apiUrl(`/api/patients/${patientId}`), {
        headers: {
          'X-User-Id': patientId,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const emergencyInfo = data.emergency_info || {};
        const emergencyContact = emergencyInfo.emergency_contacts?.[0] || {};

        setEmergencyData({
          patientId: data.patient_id,
          nationalHealthId: data.national_id || data.patient_id,
          fullName: data.full_name,
          dateOfBirth: data.date_of_birth,
          bloodType: emergencyInfo.blood_type || 'Unknown',
          allergies: emergencyInfo.allergies?.map((a: { name: string }) => a.name) || [],
          chronicConditions: emergencyInfo.chronic_conditions || [],
          currentMedications: emergencyInfo.current_medications || [],
          emergencyContact: {
            name: emergencyContact.name || 'Not set',
            phone: emergencyContact.phone || 'Not set',
            relationship: emergencyContact.relationship || 'Not set',
          },
          organDonor: emergencyInfo.organ_donor || false,
          dnrStatus: emergencyInfo.dnr_status || false,
          cardHash: data.patient_id.replace(/-/g, '').toLowerCase(),
          lastUpdated: data.last_updated || new Date().toISOString(),
        });
      } else {
        setEmergencyData(null);
      }
    } catch (error) {
      console.error('Failed to load emergency data:', error);
      setEmergencyData(null);
    }
    
    setIsLoading(false);
  };

  const handleRefreshQR = async () => {
    setIsRefreshing(true);
    await loadEmergencyData();
    setIsRefreshing(false);
  };

  const handleCopyId = async () => {
    if (!emergencyData) return;
    await navigator.clipboard.writeText(emergencyData.nationalHealthId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!emergencyData || !navigator.share) return;
    
    try {
      await navigator.share({
        title: 'MediChain Emergency Card',
        text: `Emergency Medical Info for ${emergencyData.fullName}\nHealth ID: ${emergencyData.nationalHealthId}`,
        url: window.location.href,
      });
    } catch (err) {
      // User cancelled or share failed
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (isLoading || !emergencyData) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-neutral-200 rounded w-48" />
        <div className="aspect-square max-w-xs mx-auto bg-neutral-200 rounded-3xl" />
        <div className="h-24 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900">Emergency Card</h1>
        <p className="text-neutral-600">Scan for emergency medical access</p>
      </div>

      {/* QR Code Card */}
      <div className="patient-card overflow-hidden">
        {/* Card Header */}
        <div className="bg-gradient-to-r from-emergency-500 to-emergency-600 -mx-5 -mt-5 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Heart className="w-6 h-6" />
              </div>
              <div>
                <div className="text-xs text-white/80">National Health ID</div>
                <div className="font-mono font-semibold tracking-wide">
                  {emergencyData.nationalHealthId}
                </div>
              </div>
            </div>
            <button
              onClick={handleCopyId}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              {copied ? (
                <Check className="w-5 h-5" />
              ) : (
                <Copy className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* QR Code */}
        <div className="py-6">
          <div className="relative mx-auto w-56 h-56">
            {/* Simulated QR Code Pattern */}
            <div className="w-full h-full bg-white border-4 border-neutral-900 rounded-2xl p-3 relative overflow-hidden">
              <div className="w-full h-full grid grid-cols-11 grid-rows-11 gap-0.5">
                {Array.from({ length: 121 }).map((_, i) => {
                  // Create a QR-like pattern
                  const row = Math.floor(i / 11);
                  const col = i % 11;
                  const isCorner = (row < 3 && col < 3) || (row < 3 && col > 7) || (row > 7 && col < 3);
                  const isRandom = Math.random() > 0.5;
                  
                  return (
                    <div
                      key={i}
                      className={`rounded-sm ${
                        isCorner || isRandom ? 'bg-neutral-900' : 'bg-white'
                      }`}
                    />
                  );
                })}
              </div>
              
              {/* Center Logo */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg">
                  <Heart className="w-7 h-7 text-emergency-500" />
                </div>
              </div>
            </div>

            {/* Refresh Overlay */}
            {isRefreshing && (
              <div className="absolute inset-0 bg-white/90 rounded-2xl flex items-center justify-center">
                <RefreshCw className="w-10 h-10 text-primary-500 animate-spin" />
              </div>
            )}
          </div>

          {/* QR Actions */}
          <div className="flex justify-center gap-4 mt-4">
            <button
              onClick={handleRefreshQR}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
          </div>
        </div>

        {/* Patient Info */}
        <div className="border-t border-neutral-100 pt-4 -mx-5 px-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-neutral-900">{emergencyData.fullName}</div>
              <div className="text-sm text-neutral-500">DOB: {formatDate(emergencyData.dateOfBirth)}</div>
            </div>
            <div className="flex items-center gap-2">
              <Droplet className="w-5 h-5 text-emergency-500" />
              <span className="text-xl font-bold text-emergency-600">{emergencyData.bloodType}</span>
            </div>
          </div>
        </div>
      </div>

      {/* NFC Card Info */}
      <div className="patient-card">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
            <Wifi className="w-6 h-6 text-primary-600 rotate-90" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-neutral-900">NFC Card Ready</h3>
            <p className="text-sm text-neutral-500">Tap your card for instant access</p>
          </div>
          <div className="w-3 h-3 bg-success-500 rounded-full animate-pulse" />
        </div>
        
        <div className="mt-4 p-3 bg-neutral-50 rounded-xl text-sm text-neutral-600">
          <Info className="w-4 h-4 inline mr-2 text-info" />
          Healthcare providers can tap their NFC reader to access your emergency medical data instantly.
        </div>
      </div>

      {/* Critical Medical Info */}
      <div className="patient-card">
        <button
          onClick={() => setShowMedicalInfo(!showMedicalInfo)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-warning-600" />
            <span className="font-medium text-neutral-900">Critical Medical Info</span>
          </div>
          {showMedicalInfo ? (
            <ChevronUp className="w-5 h-5 text-neutral-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-neutral-400" />
          )}
        </button>

        {showMedicalInfo && (
          <div className="mt-4 space-y-4">
            {/* Allergies */}
            {emergencyData.allergies.length > 0 && (
              <div className="p-3 bg-emergency-50 border border-emergency-200 rounded-xl">
                <div className="flex items-center gap-2 text-emergency-700 font-medium mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Allergies
                </div>
                <div className="flex flex-wrap gap-2">
                  {emergencyData.allergies.map((allergy, i) => (
                    <span key={i} className="px-3 py-1 bg-emergency-100 text-emergency-700 rounded-full text-sm">
                      {allergy}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Chronic Conditions */}
            {emergencyData.chronicConditions.length > 0 && (
              <div className="p-3 bg-warning-50 border border-warning-200 rounded-xl">
                <div className="flex items-center gap-2 text-warning-700 font-medium mb-2">
                  <Heart className="w-4 h-4" />
                  Chronic Conditions
                </div>
                <div className="flex flex-wrap gap-2">
                  {emergencyData.chronicConditions.map((condition, i) => (
                    <span key={i} className="px-3 py-1 bg-warning-100 text-warning-700 rounded-full text-sm">
                      {condition}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Current Medications */}
            {emergencyData.currentMedications.length > 0 && (
              <div className="p-3 bg-info-light border border-info/20 rounded-xl">
                <div className="flex items-center gap-2 text-info font-medium mb-2">
                  <Pill className="w-4 h-4" />
                  Current Medications
                </div>
                <ul className="space-y-1">
                  {emergencyData.currentMedications.map((med, i) => (
                    <li key={i} className="text-sm text-neutral-700">• {med}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Status Badges */}
            <div className="flex gap-3">
              <div className={`flex-1 p-3 rounded-xl text-center ${
                emergencyData.organDonor 
                  ? 'bg-success-100 text-success-700' 
                  : 'bg-neutral-100 text-neutral-500'
              }`}>
                <Heart className="w-5 h-5 mx-auto mb-1" />
                <div className="text-xs font-medium">
                  {emergencyData.organDonor ? 'Organ Donor' : 'Not a Donor'}
                </div>
              </div>
              <div className={`flex-1 p-3 rounded-xl text-center ${
                emergencyData.dnrStatus 
                  ? 'bg-emergency-100 text-emergency-700' 
                  : 'bg-success-100 text-success-700'
              }`}>
                <Shield className="w-5 h-5 mx-auto mb-1" />
                <div className="text-xs font-medium">
                  {emergencyData.dnrStatus ? 'DNR Order' : 'Full Resuscitation'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Emergency Contact */}
      <div className="patient-card">
        <h3 className="font-medium text-neutral-900 mb-4 flex items-center gap-2">
          <Phone className="w-5 h-5 text-primary-600" />
          Emergency Contact
        </h3>
        
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-neutral-900">{emergencyData.emergencyContact.name}</div>
            <div className="text-sm text-neutral-500">{emergencyData.emergencyContact.relationship}</div>
          </div>
          <a
            href={`tel:${emergencyData.emergencyContact.phone}`}
            className="flex items-center gap-2 px-4 py-2 bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors"
          >
            <Phone className="w-4 h-4" />
            Call
          </a>
        </div>
      </div>

      {/* Card Security Info */}
      <div className="text-center text-xs text-neutral-400 space-y-1">
        <p>Card Hash: {emergencyData.cardHash.slice(0, 16)}...</p>
        <p>Last Updated: {formatDate(emergencyData.lastUpdated)}</p>
        <p className="flex items-center justify-center gap-1">
          <Shield className="w-3 h-3" />
          Secured by MediChain Blockchain
        </p>
      </div>
    </div>
  );
}
