import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatientStore, useAuthStore } from '../store';
import { Smartphone, Wifi, QrCode, Search, AlertCircle, CheckCircle } from 'lucide-react';

/**
 * NFC tap simulation states
 */
type TapState = 'idle' | 'waiting' | 'success' | 'error';

/**
 * Props for NFCTapSimulator component
 */
interface NFCTapSimulatorProps {
  onEmergencyAccess?: (data: { patientId: string; emergencyInfo: any }) => void;
}

/**
 * NFC Tap Simulator component
 * Simulates NFC card tap for emergency medical record access
 */
function NFCTapSimulator({ onEmergencyAccess }: NFCTapSimulatorProps = {}) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { setEmergencyAccess } = usePatientStore();
  
  const [tapState, setTapState] = useState<TapState>('idle');
  const [nfcTagId, setNfcTagId] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'nfc' | 'qr' | 'manual'>('nfc');

  /**
   * Simulate NFC tap
   */
  const simulateTap = useCallback(async (tagId: string) => {
    if (!tagId.trim()) {
      setError('Please enter an NFC tag ID');
      return;
    }

    setTapState('waiting');
    setError(null);

    try {
      // Call emergency access API
      const response = await fetch('/api/emergency-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user?.userId || '',
        },
        body: JSON.stringify({
          nfc_tag_id: tagId,
          accessor_id: user?.userId,
          accessor_role: user?.role,
          location: 'Emergency Room 1',
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Emergency access denied');
      }

      // Store emergency info
      const emergencyInfo = {
        patientId: data.emergency_info.patient_id,
        bloodType: data.emergency_info.blood_type,
        allergies: data.emergency_info.allergies,
        currentMedications: data.emergency_info.current_medications,
        chronicConditions: data.emergency_info.chronic_conditions,
        emergencyContacts: data.emergency_info.emergency_contacts,
        organDonor: data.emergency_info.organ_donor,
        dnrStatus: data.emergency_info.dnr_status,
        lastUpdated: data.emergency_info.last_updated,
      };
      
      setEmergencyAccess(emergencyInfo, data.access_id);

      // Call optional callback for parent component
      if (onEmergencyAccess) {
        onEmergencyAccess({ patientId: emergencyInfo.patientId, emergencyInfo });
      }

      setTapState('success');

      // Navigate to patient detail after short delay
      setTimeout(() => {
        navigate(`/patients/${data.emergency_info.patient_id}`);
      }, 1500);
    } catch (err) {
      setTapState('error');
      setError(err instanceof Error ? err.message : 'Failed to access records');
    }
  }, [user, setEmergencyAccess, navigate, onEmergencyAccess]);

  /**
   * Use demo NFC tag
   */
  const useDemoTag = () => {
    setNfcTagId('NFC-DEMO-001');
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-md mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <div
          className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${
            tapState === 'idle'
              ? 'bg-primary-100'
              : tapState === 'waiting'
              ? 'bg-yellow-100 nfc-tap-ready'
              : tapState === 'success'
              ? 'bg-green-100'
              : 'bg-red-100'
          }`}
        >
          {tapState === 'idle' && <Smartphone className="text-primary-600" size={40} />}
          {tapState === 'waiting' && <Wifi className="text-yellow-600 animate-pulse" size={40} />}
          {tapState === 'success' && <CheckCircle className="text-green-600" size={40} />}
          {tapState === 'error' && <AlertCircle className="text-red-600" size={40} />}
        </div>
        <h2 className="text-xl font-bold text-gray-900">
          {tapState === 'idle' && 'Ready to Scan'}
          {tapState === 'waiting' && 'Scanning...'}
          {tapState === 'success' && 'Access Granted!'}
          {tapState === 'error' && 'Access Failed'}
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          {tapState === 'idle' && 'Tap patient NFC card or scan QR code'}
          {tapState === 'waiting' && 'Reading patient data...'}
          {tapState === 'success' && 'Loading patient records...'}
          {tapState === 'error' && error}
        </p>
      </div>

      {/* Mode selector */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setMode('nfc')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            mode === 'nfc'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Smartphone size={16} className="inline mr-2" />
          NFC Tag
        </button>
        <button
          onClick={() => setMode('qr')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            mode === 'qr'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <QrCode size={16} className="inline mr-2" />
          QR Code
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            mode === 'manual'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Search size={16} className="inline mr-2" />
          Manual
        </button>
      </div>

      {/* Input based on mode */}
      {mode === 'nfc' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="nfc-tag" className="block text-sm font-medium text-gray-700 mb-1">
              NFC Tag ID
            </label>
            <div className="flex gap-2">
              <input
                id="nfc-tag"
                type="text"
                value={nfcTagId}
                onChange={(e) => setNfcTagId(e.target.value)}
                placeholder="NFC-XXXX-XXXX"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                disabled={tapState === 'waiting'}
              />
              <button
                onClick={useDemoTag}
                className="px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg"
              >
                Demo
              </button>
            </div>
          </div>
          <button
            onClick={() => simulateTap(nfcTagId)}
            disabled={tapState === 'waiting'}
            className="w-full py-3 bg-emergency-500 text-white font-semibold rounded-lg hover:bg-emergency-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed emergency-pulse"
          >
            {tapState === 'waiting' ? 'Scanning...' : '🚨 Simulate NFC Tap'}
          </button>
        </div>
      )}

      {mode === 'qr' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="qr-data" className="block text-sm font-medium text-gray-700 mb-1">
              QR Code Data (JSON)
            </label>
            <textarea
              id="qr-data"
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder='{"tag_id": "NFC-DEMO-001", ...}'
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 h-24"
              disabled={tapState === 'waiting'}
            />
          </div>
          <button
            onClick={() => {
              try {
                const data = JSON.parse(qrInput);
                simulateTap(data.tag_id || data.nfc_tag_id);
              } catch {
                setError('Invalid QR code data');
                setTapState('error');
              }
            }}
            disabled={tapState === 'waiting'}
            className="w-full py-3 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            Verify QR Code
          </button>
        </div>
      )}

      {mode === 'manual' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            For manual patient lookup, use the{' '}
            <a href="/patients" className="text-primary-600 hover:underline">
              Patient Search
            </a>{' '}
            page.
          </p>
        </div>
      )}

      {/* Reset button */}
      {(tapState === 'success' || tapState === 'error') && (
        <button
          onClick={() => {
            setTapState('idle');
            setError(null);
          }}
          className="w-full mt-4 py-2 text-gray-600 hover:text-gray-900 text-sm"
        >
          Reset
        </button>
      )}
    </div>
  );
}

export default NFCTapSimulator;
