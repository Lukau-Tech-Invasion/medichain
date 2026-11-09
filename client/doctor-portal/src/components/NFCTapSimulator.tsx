import { useState, useCallback, useEffect, useRef } from 'react';
import type { EmergencyInfo } from '../store/patientStore';
import { Link, useNavigate } from 'react-router-dom';
import { usePatientStore, useAuthStore } from '../store';
import { Smartphone, Wifi, QrCode, Search, AlertCircle, CheckCircle, Camera, Nfc } from 'lucide-react';
import {
  ApiClientError,
  QrScanner,
  enterWorkContext,
  grantBoundEmergencyAccess,
  listUsableDevices,
  nfcErrorMessage,
  nfcSupported,
  parseEmergencyCode,
  readNfcCardOnce,
} from '@medichain/shared';
import type { EmergencySubject, OfflineEmergencySummary, UsableDevice } from '@medichain/shared';
import { OfflineQrSummary } from './OfflineQrSummary';

/**
 * Emergency access states
 */
type TapState = 'idle' | 'waiting' | 'success' | 'error';

/**
 * Props for NFCTapSimulator component
 */
interface NFCTapSimulatorProps {
  onEmergencyAccess?: (data: { patientId: string; emergencyInfo: EmergencyInfo }) => void;
}

/**
 * NFC Tap Simulator component
 * Simulates NFC card tap for emergency medical record access
 */
function NFCTapSimulator({ onEmergencyAccess }: NFCTapSimulatorProps = {}) {
  const navigate = useNavigate();
  const { setEmergencyAccess } = usePatientStore();
  const isParamedic = useAuthStore((state) => state.user?.role === 'Paramedic');
  
  const [tapState, setTapState] = useState<TapState>('idle');
  const [nfcTagId, setNfcTagId] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [deviceId, setDeviceId] = useState('');
  // The approved device used to be a free-text UUID box. Nothing in either
  // client could list devices, so the only way to fill it was to have issued
  // the enrolment call yourself and kept the response -- which meant emergency
  // access was, in practice, unusable. `/api/devices/available` returns only
  // devices that pass the same check the grant will apply.
  const [usableDevices, setUsableDevices] = useState<UsableDevice[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'nfc' | 'qr' | 'manual'>('nfc');
  const [cameraOpen, setCameraOpen] = useState(false);
  // The summary printed in a scanned Medical ID QR, shown only when the server
  // cannot open access: no connection, or a code made before access by QR.
  const [offlineView, setOfflineView] = useState<{ summary: OfflineEmergencySummary; reason: string } | null>(null);

  useEffect(() => {
    listUsableDevices()
      .then((body) => {
        const list = body.devices ?? [];
        setUsableDevices(list);
        if (list.length === 1) setDeviceId(list[0].id);
      })
      .catch(() => {
        // A failed lookup is not "no devices". The field stays usable so a
        // clinician who knows the id is not blocked by our read failing.
        setUsableDevices([]);
      })
      .finally(() => setDevicesLoaded(true));
  }, []);

  /**
   * Open emergency access for the card or Medical ID QR the responder holds.
   * `offline` is the scanned QR's own summary, shown if the server is unreachable.
   */
  const requestAccess = useCallback(async (subject: EmergencySubject, offline?: OfflineEmergencySummary) => {
    if (!deviceId.trim()) {
      setTapState('error');
      setError('Select the approved hospital device you are using before emergency access');
      return;
    }

    setTapState('waiting');
    setError(null);
    setOfflineView(null);
    const byQr = subject.patient_id !== undefined;

    try {
      // Always mint a fresh work context. This prevents personal-health or
      // stale professional tokens from being reused for emergency access.
      const workContext = await enterWorkContext();
      const data = await grantBoundEmergencyAccess({
        ...subject,
        device_id: deviceId.trim(),
        work_context_id: workContext.context.id,
        reason_code: byQr ? 'emergency_qr_access' : 'emergency_nfc_access',
        reason_text: byQr ? 'Medical ID QR emergency summary access' : 'NFC emergency summary access',
      });

      // Store emergency info
      const emergencyInfo = {
        patientId: data.emergency_info.patient_id,
        bloodType: data.emergency_info.blood_type,
        allergies: data.emergency_info.allergies.map((allergy) => allergy.name),
        currentMedications: data.emergency_info.current_medications,
        chronicConditions: data.emergency_info.chronic_conditions,
        emergencyContacts: data.emergency_info.emergency_contacts,
        organDonor: data.emergency_info.organ_donor,
        dnrStatus: data.emergency_info.dnr_status,
        lastUpdated: data.emergency_info.last_updated,
      };
      
      setEmergencyAccess(emergencyInfo, data.grant_id, data.expires_at);

      // Call optional callback for parent component
      if (onEmergencyAccess) {
        onEmergencyAccess({ patientId: emergencyInfo.patientId, emergencyInfo });
      }

      setTapState('success');

      // Navigate to patient detail after short delay
      setTimeout(() => {
        if (!isParamedic) navigate(`/patients/${data.emergency_info.patient_id}`);
      }, 1500);
    } catch (err) {
      setTapState('error');
      setError(err instanceof Error ? err.message : 'Failed to access records');
      if (offline && err instanceof ApiClientError && err.isNetworkError()) {
        setOfflineView({
          summary: offline,
          reason: 'No connection to MediChain. This is what the patient carries on their code: it is not checked by the server, and this look is not recorded in their access history.',
        });
      }
    }
  }, [deviceId, setEmergencyAccess, navigate, onEmergencyAccess, isParamedic]);

  const simulateTap = (tagId: string) => {
    if (tapState === 'waiting') return;
    if (!tagId.trim()) {
      setTapState('error');
      setError('Please enter an NFC tag ID');
      return;
    }
    void requestAccess({ nfc_tag_id: tagId.trim() });
  };

  /** A code read by the camera, or pasted by hand. */
  const handleScannedCode = (raw: string) => {
    setCameraOpen(false);
    setOfflineView(null);
    const code = parseEmergencyCode(raw);
    if (code.kind === 'invalid') {
      setTapState('error');
      setError(code.reason);
      return;
    }
    if (code.kind === 'card') {
      void requestAccess({ nfc_tag_id: code.tagId });
      return;
    }
    if (!code.proof) {
      setTapState('error');
      setError('This Medical ID QR code was made before scanning could open access. Ask the patient to download a current one from the patient app.');
      setOfflineView({
        summary: code.offline,
        reason: "Shown from the code itself: it is not checked by the server, and this look is not recorded in the patient's access history.",
      });
      return;
    }
    void requestAccess({ patient_id: code.patientId, qr_proof: code.proof }, code.offline);
  };

  // Reading a real card: Chrome on Android only (Web NFC). Elsewhere the card
  // number is typed, or the patient's QR code is scanned.
  const canReadCards = nfcSupported();
  const [listening, setListening] = useState(false);
  const nfcAbort = useRef<AbortController | null>(null);
  useEffect(() => () => nfcAbort.current?.abort(), []);

  const stopListening = () => {
    nfcAbort.current?.abort();
    nfcAbort.current = null;
    setListening(false);
  };

  const readCard = async () => {
    stopListening();
    const controller = new AbortController();
    nfcAbort.current = controller;
    setListening(true);
    setError(null);
    setTapState('idle');
    try {
      const text = await readNfcCardOnce(controller.signal);
      stopListening();
      handleScannedCode(text);
    } catch (err) {
      if (controller.signal.aborted) return;
      stopListening();
      setTapState('error');
      setError(nfcErrorMessage(err));
    }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void simulateTap(nfcTagId); }} noValidate>
    <div className="bg-surface rounded-xl shadow-lg p-6 max-w-md mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <div
          className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${
            tapState === 'idle'
              ? 'bg-brand-subtle'
              : tapState === 'waiting'
              ? 'bg-caution-subtle nfc-tap-ready'
              : tapState === 'success'
              ? 'bg-ok-subtle'
              : 'bg-critical-subtle'
          }`}
        >
          {tapState === 'idle' && <Smartphone className="text-brand" size={40} />}
          {tapState === 'waiting' && <Wifi className="text-caution-subtle-fg" size={40} />}
          {tapState === 'success' && <CheckCircle className="text-ok-subtle-fg" size={40} />}
          {tapState === 'error' && <AlertCircle className="text-critical-subtle-fg" size={40} />}
        </div>
        <h2 className="text-xl font-bold text-content">
          {tapState === 'idle' && 'Ready to Scan'}
          {tapState === 'waiting' && 'Opening...'}
          {tapState === 'success' && 'Access Granted!'}
          {tapState === 'error' && 'Access Failed'}
        </h2>
        <p className="text-content-muted text-sm mt-1">
          {tapState === 'idle' && (listening ? 'Hold the card to the back of this phone' : 'Read the patient\'s card or scan their QR code')}
          {tapState === 'waiting' && 'Reading patient data...'}
          {tapState === 'success' && (isParamedic ? 'Emergency summary is ready below.' : 'Loading patient records...')}
          {tapState === 'error' && error}
        </p>
      </div>

      {/* Mode selector */}
      <div className="mb-4">
        <label htmlFor="approved-device" className="block text-sm font-medium text-content-secondary mb-1">
          Approved hospital device ID
        </label>
        {usableDevices.length > 0 ? (
          <select
            id="approved-device"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand min-h-[44px]"
            disabled={tapState === 'waiting'}
          >
            <option value="">Select the device you are using</option>
            {usableDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.device_name} ({device.device_type})
              </option>
            ))}
          </select>
        ) : (
          <input
            id="approved-device"
            type="text"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            placeholder="Registered device UUID"
            className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand"
            disabled={tapState === 'waiting'}
          />
        )}
        <p className="mt-1 text-xs text-content-muted">
          {devicesLoaded && usableDevices.length === 0
            ? 'No approved device is available to this account. An administrator must enrol one and provision its credential before emergency access will work.'
            : 'Emergency access is bound to this enrolled device and a new professional work context.'}
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        <button type="button"
          onClick={() => setMode('nfc')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            mode === 'nfc'
              ? 'bg-brand text-brand-fg'
              : 'bg-surface-sunken text-content-muted hover:bg-surface-sunken'
          }`}
        >
          <Smartphone size={16} className="inline mr-2" />
          NFC Card
        </button>
        <button type="button"
          onClick={() => setMode('qr')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            mode === 'qr'
              ? 'bg-brand text-brand-fg'
              : 'bg-surface-sunken text-content-muted hover:bg-surface-sunken'
          }`}
        >
          <QrCode size={16} className="inline mr-2" />
          QR Code
        </button>
        <button type="button"
          onClick={() => setMode('manual')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            mode === 'manual'
              ? 'bg-brand text-brand-fg'
              : 'bg-surface-sunken text-content-muted hover:bg-surface-sunken'
          }`}
        >
          <Search size={16} className="inline mr-2" />
          Manual
        </button>
      </div>

      {/* Input based on mode */}
      {mode === 'nfc' && (
        <div className="space-y-4">
          {canReadCards && (
            <button
              type="button"
              onClick={() => (listening ? stopListening() : void readCard())}
              disabled={tapState === 'waiting'}
              className="w-full min-h-[44px] py-3 bg-brand text-brand-fg font-semibold rounded-lg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 inline-flex items-center justify-center gap-2"
            >
              <Nfc size={18} aria-hidden="true" />
              {listening ? 'Stop reading' : 'Tap card to read'}
            </button>
          )}
          <div>
            <label htmlFor="nfc-tag" className="block text-sm font-medium text-content-secondary mb-1">
              {canReadCards ? 'Or enter the card number' : 'Card number'}
            </label>
            <input
              id="nfc-tag"
              type="text"
              value={nfcTagId}
              onChange={(e) => setNfcTagId(e.target.value)}
              placeholder="NFC-XXXX-XXXX"
              className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand"
              disabled={tapState === 'waiting'}
            />
            {!canReadCards && (
              <p className="mt-1 text-xs text-content-muted">
                Reading a card by tapping works in Chrome on Android. On this device, enter the number printed on the card, or scan the patient&apos;s QR code.
              </p>
            )}
          </div>
          <button type="submit"
            aria-disabled={tapState === 'waiting' || undefined}
            className="aria-disabled:cursor-wait w-full py-3 bg-critical text-critical-fg font-semibold rounded-lg hover:bg-critical transition-colors emergency-pulse"
          >
            {tapState === 'waiting' ? 'Opening...' : (
              <span className="inline-flex items-center justify-center gap-2"><Wifi size={18} aria-hidden="true" /> Open emergency summary</span>
            )}
          </button>
        </div>
      )}

      {mode === 'qr' && (
        <div className="space-y-4">
          {cameraOpen ? (
            <QrScanner
              onResult={handleScannedCode}
              onCancel={() => setCameraOpen(false)}
              hint="Point the camera at the patient's Medical ID QR code or card. On a laptop, hold the code up to the webcam."
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setTapState('idle');
                setOfflineView(null);
                setCameraOpen(true);
              }}
              disabled={tapState === 'waiting'}
              className="w-full min-h-[44px] py-3 bg-brand text-brand-fg font-semibold rounded-lg hover:bg-brand transition-colors disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 inline-flex items-center justify-center gap-2"
            >
              <Camera size={18} aria-hidden="true" /> Scan QR code with camera
            </button>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-content-muted">No camera? Enter the code by hand</summary>
            <div className="mt-2 space-y-2">
              <label htmlFor="qr-data" className="block text-sm font-medium text-content-secondary">
                QR code text
              </label>
              <textarea
                id="qr-data"
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder="NFC-XXXX-XXXX, or the text a QR reader app shows"
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand h-24"
                disabled={tapState === 'waiting'}
              />
              <button
                type="button"
                onClick={() => handleScannedCode(qrInput)}
                disabled={tapState === 'waiting' || !qrInput.trim()}
                className="w-full py-2 bg-surface-sunken text-content-secondary font-medium rounded-lg disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
              >
                Verify code
              </button>
            </div>
          </details>
          {offlineView && <OfflineQrSummary summary={offlineView.summary} reason={offlineView.reason} />}
        </div>
      )}

      {mode === 'manual' && (
        <div className="space-y-4">
          {isParamedic ? <p className="text-sm text-content-muted">
            Manual patient search is unavailable to paramedics. Use a registered NFC card or QR code with an approved hospital device.
          </p> : <p className="text-sm text-content-muted">
            For manual patient lookup, use the{' '}
            <Link to="/patients" className="text-brand hover:underline">
              Patient Search
            </Link>{' '}
            page.
          </p>}
        </div>
      )}

      {/* Reset button */}
      {(tapState === 'success' || tapState === 'error') && (
        <button type="button"
          onClick={() => {
            setTapState('idle');
            setError(null);
          }}
          className="w-full mt-4 py-2 text-content-muted hover:text-content text-sm"
        >
          Reset
        </button>
      )}
    </div>
    </form>
  );
}

export default NFCTapSimulator;
