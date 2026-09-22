import React, { useState, useEffect, useRef } from 'react';
import {
  ScanLine,
  CameraOff,
  User,
  Pill,
  Package,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  FlipHorizontal,
  Flashlight,
  FlashlightOff,
  History,
  Barcode,
  Activity
} from 'lucide-react';
import {
  apiUrl,
  EmptyState,
  getApiClient,
  scanBarcode,
  useTranslation,
  LoadingSpinner,
  getScannerSettings,
  updateScannerSettings,
  clearScanHistory,
  getApiErrorMessage,
  type ScannerSettings,
} from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

/**
 * BarcodePage
 * 
 * Page for patient wristband and medication barcode scanning.
 * Integrates with camera for real-time barcode detection.
 */

type ScanMode = 'patient' | 'medication' | 'equipment' | 'specimen';
type ScanResult = 'success' | 'warning' | 'error' | 'pending';

interface ScannedItem {
  id: string;
  type: ScanMode;
  barcode: string;
  name: string;
  details: string;
  timestamp: Date;
  result: ScanResult;
  message?: string;
}

interface Patient {
  id: string;
  name: string;
  dob: string;
  mrn: string;
  room: string;
  allergies: string[];
}

interface PersistedBarcodeScan {
  scan_id: string;
  barcode_value: string;
  entity_type?: string;
  scanned_at?: number;
  scanned_at_iso?: string;
  location?: string | null;
}

interface BarcodeDetectionResult {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectionResult[]>;
}

interface BarcodeDetectorConstructor {
  new (): BarcodeDetectorInstance;
}

function mapPersistedScan(scan: PersistedBarcodeScan): ScannedItem {
  const resolved = scan.entity_type === 'specimen';
  const timestamp = scan.scanned_at_iso
    ? new Date(scan.scanned_at_iso)
    : new Date((scan.scanned_at ?? 0) * 1000);

  return {
    id: scan.scan_id,
    type: resolved ? 'specimen' : 'equipment',
    barcode: scan.barcode_value,
    name: resolved ? 'Registered specimen' : 'Unresolved barcode',
    details: scan.location ? `Location: ${scan.location}` : 'No registered specimen matches this barcode.',
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date(0) : timestamp,
    result: resolved ? 'success' : 'warning',
    message: resolved ? undefined : 'The scan was recorded, but its clinical entity was not resolved.',
  };
}

const BarcodePage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'scan' | 'history' | 'settings'>('scan');
  // The five toggles used to be literals in this file's JSX: nothing read
  // them and the scan path honoured none of them, including `saveHistory`,
  // which governs whether a durable record is written at all.
  const [scannerSettings, setScannerSettings] = useState<ScannerSettings>({
    autoScan: true,
    vibrate: true,
    sound: true,
    continuous: false,
    saveHistory: true,
  });
  const [settingsNotice, setSettingsNotice] = useState('');
  const [scanMode, setScanMode] = useState<ScanMode>('patient');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [scanHistory, setScanHistory] = useState<ScannedItem[]>([]);
  // The barcode API resolves registered specimens only. Keep the patient
  // context absent until there is an authenticated patient-wristband lookup
  // contract, rather than showing details inferred from a barcode string.
  const [currentPatient] = useState<Patient | null>(null);
  const [lastScan, setLastScan] = useState<ScannedItem | null>(null);
  const [manualEntry, setManualEntry] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { user } = useAuthStore();

  /** Re-read this clinician's scan list from the server. */
  const loadScanHistory = async () => {
    const user = useAuthStore.getState().user;
    if (!user?.walletAddress) return;
    try {
      const response = await fetch(apiUrl('/api/barcode/scans/my'), {
        headers: getApiClient().getSessionHeaders(user.walletAddress),
      });
      if (!response.ok) return;
      const history = await response.json();
      if (Array.isArray(history)) {
        setScanHistory(history.map((item) => mapPersistedScan(item as PersistedBarcodeScan)));
      }
    } catch (error) {
      console.error('Barcode scan history could not be loaded:', error);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getScannerSettings()
      .then((res) => {
        if (!cancelled && res.settings) setScannerSettings(res.settings);
      })
      // No stored settings is the normal first visit, not an error: the
      // defaults above are the ones the panel always drew.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** Flip one toggle and save the set. */
  const toggleSetting = async (key: keyof ScannerSettings) => {
    const next = { ...scannerSettings, [key]: !scannerSettings[key] };
    setScannerSettings(next);
    setSettingsNotice('');
    try {
      await updateScannerSettings(next);
    } catch (err) {
      // Put it back: a toggle that looks saved and is not is the defect this
      // whole change exists to remove.
      setScannerSettings(scannerSettings);
      setSettingsNotice(getApiErrorMessage(err, t('docBarcode.settingsFailed')));
    }
  };

  /**
   * Clear this clinician's scan list.
   *
   * Deletes nothing. A scan is the record of somebody handling a specimen, and
   * ADR-0005 defers irreversible deletion here; the list starts again from now
   * and the scans stay for anyone asking who handled what.
   */
  const handleClearHistory = async () => {
    setSettingsNotice('');
    try {
      const res = await clearScanHistory();
      setSettingsNotice(res.message);
      await loadScanHistory();
    } catch (err) {
      setSettingsNotice(getApiErrorMessage(err, t('docBarcode.clearFailed')));
    }
  };

  useEffect(() => {
    // Fetch scan history from API - start with empty state
    const fetchScanHistory = async () => {
      if (!user?.walletAddress) {
        setLoading(false);
        return;
      }
      
      try {
        const response = await fetch(apiUrl('/api/barcode/scans/my'), {
          headers: {
            'Content-Type': 'application/json',
            ...getApiClient().getSessionHeaders(user.walletAddress),
            'X-Provider-Role': user.role || 'Doctor',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            setScanHistory(data.map((item) => mapPersistedScan(item as PersistedBarcodeScan)));
          }
        }
      } catch (error) {
        console.error('Barcode scan history could not be loaded:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchScanHistory();
  }, [user]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error('Camera access denied:', err);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const submitScan = async (barcode: string) => {
    if (!user?.walletAddress) {
      console.error('User not authenticated');
      return;
    }
    
    setIsScanning(true);
    
    try {
      const scanResult = await scanBarcode({ barcode, scan_mode: scanMode });
      const entity = scanResult.entity_info;
      const resolved = entity.type === 'specimen' && entity.resolved === true;
      const newScan: ScannedItem = {
        id: `scan-${scanResult.scanned_at}`,
        type: resolved ? 'specimen' : 'equipment',
        barcode: scanResult.barcode_value,
        name: resolved ? 'Registered specimen' : t('docBarcode.unknown'),
        details: resolved
          ? `Patient: ${typeof entity.patient_id === 'string' ? entity.patient_id : '-'}`
          : 'No registered specimen matches this barcode.',
        timestamp: new Date(scanResult.scanned_at * 1000),
        result: resolved ? 'success' : 'warning',
        message: resolved ? undefined : 'The scan was recorded, but its clinical entity was not resolved.',
      };

      setLastScan(newScan);
      // Re-read the persisted record rather than adding a browser-only row.
      const response = await fetch(apiUrl('/api/barcode/scans/my'), {
        headers: getApiClient().getSessionHeaders(user.walletAddress),
      });
      if (response.ok) {
        const history = await response.json();
        if (Array.isArray(history)) {
          setScanHistory(history.map((item) => mapPersistedScan(item as PersistedBarcodeScan)));
        }
      }
    } catch (err) {
      console.error('Barcode scan error:', err);
      const errorScan: ScannedItem = {
        id: `scan-${Date.now()}`,
        type: scanMode,
        barcode: manualEntry || 'N/A',
        name: t('docBarcode.scanFailed'),
        details: t('docBarcode.serverConnError'),
        timestamp: new Date(),
        result: 'error',
        message: t('docBarcode.couldNotConnect'),
      };
      setLastScan(errorScan);
    } finally {
      setIsScanning(false);
    }
  };

  const scanCamera = async () => {
    if (!videoRef.current) return;
    const detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!detector) {
      setLastScan({
        id: `scan-${Date.now()}`,
        type: scanMode,
        barcode: '',
        name: t('docBarcode.scanFailed'),
        details: 'This browser does not support camera barcode detection. Enter the barcode manually.',
        timestamp: new Date(),
        result: 'error',
      });
      return;
    }
    setIsScanning(true);
    try {
      const result = await new detector().detect(videoRef.current);
      const barcode = result[0]?.rawValue?.trim();
      if (!barcode) {
        setLastScan({
          id: `scan-${Date.now()}`,
          type: scanMode,
          barcode: '',
          name: t('docBarcode.scanFailed'),
          details: 'No barcode was detected. Position a barcode inside the frame and try again.',
          timestamp: new Date(),
          result: 'error',
        });
        return;
      }
      await submitScan(barcode);
    } finally {
      setIsScanning(false);
    }
  };

  const handleManualEntry = () => {
    if (!manualEntry.trim()) return;
    void submitScan(manualEntry.trim());
    setManualEntry('');
  };

  const getModeIcon = (mode: ScanMode) => {
    switch (mode) {
      case 'patient': return <User className="w-5 h-5" />;
      case 'medication': return <Pill className="w-5 h-5" />;
      case 'equipment': return <Package className="w-5 h-5" />;
      case 'specimen': return <Activity className="w-5 h-5" />;
    }
  };

  const getResultIcon = (result: ScanResult) => {
    switch (result) {
      case 'success': return <CheckCircle className="w-6 h-6 text-green-500" />;
      case 'warning': return <AlertTriangle className="w-6 h-6 text-yellow-500" />;
      case 'error': return <XCircle className="w-6 h-6 text-red-500" />;
      case 'pending': return <Clock className="w-6 h-6 text-content-muted" />;
    }
  };

  const getResultBg = (result: ScanResult) => {
    switch (result) {
      case 'success': return 'bg-ok-subtle border-ok';
      case 'warning': return 'bg-caution-subtle border-caution';
      case 'error': return 'bg-critical-subtle border-critical';
      case 'pending': return 'bg-surface-sunken border-border';
    }
  };

  const modeLabel = (m: ScanMode): string => ({
    patient: t('docBarcode.modePatient'), medication: t('docBarcode.modeMedication'),
    equipment: t('docBarcode.modeEquipment'), specimen: t('docBarcode.modeSpecimen'),
  }[m]);

  const tabLabel = (tb: 'scan' | 'history' | 'settings'): string => ({
    scan: t('docBarcode.tabScan'), history: t('docBarcode.tabHistory'), settings: t('docBarcode.tabSettings'),
  }[tb]);

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-700 text-white p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <ScanLine className="w-8 h-8" />
            <h1 className="text-xl font-bold">{t('docBarcode.title')}</h1>
          </div>
          {currentPatient && (
            <div className="text-right">
              <p className="text-sm font-medium">{currentPatient.name}</p>
              <p className="text-xs text-gray-300">{t('docBarcode.room', { room: currentPatient.room })}</p>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-content-muted">
          <LoadingSpinner size="sm" />
          {t('common.loading')}
        </div>
      )}

      {/* Mode Selector */}
      <div className="bg-gray-800 px-4 py-3">
        <div className="flex gap-2 overflow-x-auto">
          {(['patient', 'medication', 'equipment', 'specimen'] as ScanMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setScanMode(mode)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                scanMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {getModeIcon(mode)}
              <span className="capitalize">{modeLabel(mode)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-800 border-t border-gray-700">
        <div className="flex">
          {(['scan', 'history', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'text-blue-400 border-b-2 border-notice'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
      </div>

      {/* Scan Tab */}
      {activeTab === 'scan' && (
        <div className="flex-1 flex flex-col">
          {/* Camera View */}
          <div className="relative flex-1 bg-black min-h-[300px]">
            {isCameraActive ? (
              // `muted` is what satisfies jsx-a11y/media-has-caption here, and
              // it is also simply true: a barcode viewfinder is a live camera
              // preview with no audio track and no recorded speech, so there is
              // nothing a caption track could contain. It still needs a name,
              // hence the aria-label -- a screen reader otherwise announces an
              // unlabelled video region and no more.
              //
              // No eslint-disable: an earlier version carried one, which became
              // an *unused directive* once `muted` was added and failed CI. A
              // suppression that outlives the problem it suppressed is worse
              // than none, because it hides the next real violation.
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-label={t('docBarcode.cameraViewfinderLabel')}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300">
                <CameraOff className="w-16 h-16 mb-4" />
                <p>{t('docBarcode.cameraNotActive')}</p>
                <button
                  onClick={startCamera}
                  className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium"
                >
                  {t('docBarcode.startCamera')}
                </button>
              </div>
            )}

            {/* Scan Overlay */}
            {isCameraActive && (
              <>
                {/* Scanning Frame */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-64 h-40 border-2 border-white/50 rounded-lg relative">
                    <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-notice rounded-tl" />
                    <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-notice rounded-tr" />
                    <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-notice rounded-bl" />
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-notice rounded-br" />
                    
                    {/* Scan Line Animation */}
                    {isScanning && (
                      <div className="absolute inset-x-0 top-0 h-0.5 bg-blue-400 animate-pulse" 
                           style={{ animation: 'scanLine 1.5s ease-in-out infinite' }} />
                    )}
                  </div>
                </div>

                {/* Camera Controls */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
                  <button
                    onClick={() => setFlashOn(!flashOn)}
                    className="p-3 bg-black/50 rounded-full text-white"
                  >
                    {flashOn ? <Flashlight className="w-6 h-6" /> : <FlashlightOff className="w-6 h-6" />}
                  </button>
                  <button
                    onClick={() => void scanCamera()}
                    disabled={isScanning}
                    className={`px-8 py-3 rounded-full font-semibold ${
                      isScanning
                        ? 'bg-blue-400 text-white'
                        : 'bg-blue-600 text-white'
                    }`}
                  >
                    {isScanning ? t('docBarcode.scanning') : t('docBarcode.scan')}
                  </button>
                  <button
                    onClick={() => {
                      setFacingMode(f => f === 'environment' ? 'user' : 'environment');
                    }}
                    className="p-3 bg-black/50 rounded-full text-white"
                  >
                    <FlipHorizontal className="w-6 h-6" />
                  </button>
                </div>

                {/* Stop Camera */}
                <button
                  onClick={stopCamera}
                  className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white"
                >
                  <CameraOff className="w-5 h-5" />
                </button>
              </>
            )}
          </div>

          {/* Manual Entry */}
          <div className="bg-gray-800 p-4">
            <label htmlFor="barcode-manual-entry" className="sr-only">{t('docBarcode.manualAria')}</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id="barcode-manual-entry"
                  type="text"
                  value={manualEntry}
                  onChange={(e) => setManualEntry(e.target.value)}
                  placeholder={t('docBarcode.manualPlaceholder')}
                  className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg pl-10 pr-4 py-2 focus:ring-2 focus:ring-blue-500"
                />
                <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
              </div>
              <button
                onClick={handleManualEntry}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium"
              >
                {t('docBarcode.submit')}
              </button>
            </div>
          </div>

          {/* Last Scan Result */}
          {lastScan && (
            <div className={`mx-4 mb-4 p-4 rounded-lg border ${getResultBg(lastScan.result)}`}>
              <div className="flex items-start gap-3">
                {getResultIcon(lastScan.result)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {getModeIcon(lastScan.type)}
                    <span className="font-semibold text-content">{lastScan.name}</span>
                  </div>
                  <p className="text-sm text-content-muted mt-1">{lastScan.details}</p>
                  {lastScan.message && (
                    <p className={`text-sm mt-1 ${
                      lastScan.result === 'error' ? 'text-critical-subtle-fg' : 'text-caution-subtle-fg'
                    }`}>
                      {lastScan.message}
                    </p>
                  )}
                  <p className="text-xs text-content-muted mt-2">{lastScan.barcode}</p>
                </div>
              </div>
            </div>
          )}

          {/* Current Patient Alert */}
          {currentPatient && currentPatient.allergies.length > 0 && (
            <div className="mx-4 mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <span className="text-red-300 font-medium">{t('docBarcode.allergies')}</span>
                <span className="text-critical-fg">{currentPatient.allergies.join(', ')}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="flex-1 bg-surface-sunken p-4 space-y-3">
          {scanHistory.length === 0 ? (
            <EmptyState
              icon={<History className="w-12 h-12" />}
              title={t('docBarcode.noHistoryTitle')}
              description={t('docBarcode.noHistoryDesc')}
            />
          ) : (
            scanHistory.map(scan => (
              <div key={scan.id} className={`bg-surface rounded-lg shadow p-4 border-l-4 ${
                scan.result === 'success' ? 'border-green-500' :
                scan.result === 'warning' ? 'border-yellow-500' :
                scan.result === 'error' ? 'border-red-500' : 'border-border-strong'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-full ${
                      scan.type === 'patient' ? 'bg-notice-subtle text-notice-subtle-fg' :
                      scan.type === 'medication' ? 'bg-surface-sunken text-content-secondary' :
                      scan.type === 'equipment' ? 'bg-surface-sunken text-content-muted' :
                      'bg-ok-subtle text-ok-subtle-fg'
                    }`}>
                      {getModeIcon(scan.type)}
                    </div>
                    <div>
                      <p className="font-medium text-content">{scan.name}</p>
                      <p className="text-sm text-content-muted">{scan.details}</p>
                      <p className="text-xs text-content-muted mt-1">{scan.barcode}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {getResultIcon(scan.result)}
                    <p className="text-xs text-content-muted mt-1">
                      {scan.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                {scan.message && (
                  <p className={`text-sm mt-2 ${
                    scan.result === 'error' ? 'text-critical-subtle-fg' : 'text-caution-subtle-fg'
                  }`}>
                    {scan.message}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="flex-1 bg-surface-sunken p-4 space-y-4">
          <div className="bg-surface rounded-lg shadow divide-y">
            <div className="p-4">
              <h3 className="font-semibold text-content">{t('docBarcode.scannerSettings')}</h3>
            </div>
            {([
              { key: 'autoScan', label: t('docBarcode.setAutoScan') },
              { key: 'vibrate', label: t('docBarcode.setVibrate') },
              { key: 'sound', label: t('docBarcode.setSound') },
              { key: 'continuous', label: t('docBarcode.setContinuous') },
              { key: 'saveHistory', label: t('docBarcode.setSaveHistory') },
            ] as Array<{ key: keyof ScannerSettings; label: string }>).map((setting) => {
              const enabled = scannerSettings[setting.key];
              return (
                <div key={setting.key} className="p-4 flex items-center justify-between">
                  <span id={`scanner-${setting.key}-label`} className="text-content-secondary">
                    {setting.label}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-labelledby={`scanner-${setting.key}-label`}
                    onClick={() => toggleSetting(setting.key)}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      enabled ? 'bg-brand' : 'bg-disabled'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-surface rounded-full shadow transition-transform ${
                        enabled ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="bg-surface rounded-lg shadow divide-y">
            <div className="p-4">
              <h3 className="font-semibold text-content">{t('docBarcode.supportedFormats')}</h3>
            </div>
            <div className="p-4">
              <div className="flex flex-wrap gap-2">
                {['Code 128', 'Code 39', 'EAN-13', 'UPC-A', 'QR Code', 'Data Matrix', 'PDF417'].map(format => (
                  <span key={format} className="px-3 py-1 bg-surface-sunken text-content-secondary rounded-full text-sm">
                    {format}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-surface rounded-lg shadow p-4">
            <button
              type="button"
              onClick={handleClearHistory}
              className="w-full flex items-center justify-center gap-2 text-critical-subtle-fg font-medium"
            >
              <History className="w-5 h-5" />
              {t('docBarcode.clearHistory')}
            </button>
            <p className="mt-2 text-xs text-content-muted">
              {t('docBarcode.clearHistoryNote')}
            </p>
            {settingsNotice && (
              <p role="status" className="mt-2 text-xs text-content-muted">
                {settingsNotice}
              </p>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes scanLine {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(160px); }
        }
      `}</style>
    </div>
  );
};

export default BarcodePage;
