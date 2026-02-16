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
  Activity,
  Loader2
} from 'lucide-react';
import { apiUrl } from '@medichain/shared';
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

interface _Medication {
  id: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
  ndc: string;
  expirationDate: string;
}

const BarcodePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'scan' | 'history' | 'settings'>('scan');
  const [scanMode, setScanMode] = useState<ScanMode>('patient');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [scanHistory, setScanHistory] = useState<ScannedItem[]>([]);
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(null);
  const [lastScan, setLastScan] = useState<ScannedItem | null>(null);
  const [manualEntry, setManualEntry] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { user } = useAuthStore();

  useEffect(() => {
    // Fetch scan history from API - start with empty state
    const fetchScanHistory = async () => {
      if (!user?.walletAddress) {
        setLoading(false);
        return;
      }
      
      try {
        const response = await fetch(apiUrl('/api/barcode/scan-history'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            setScanHistory(data.map((item: { id: string; type: ScanMode; barcode: string; name: string; details: string; timestamp: string; result: ScanResult; message?: string }) => ({
              ...item,
              timestamp: new Date(item.timestamp)
            })));
          }
        }
        // If endpoint doesn't exist yet, just start with empty history
      } catch {
        // API not available - start with empty history
        console.log('Barcode scan history API not available');
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

  const simulateScan = async () => {
    if (!user?.walletAddress) {
      console.error('User not authenticated');
      return;
    }
    
    setIsScanning(true);
    
    try {
      // Call the barcode scan API endpoint
      const response = await fetch(apiUrl('/api/barcode/scan'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role || 'Doctor',
        },
        body: JSON.stringify({
          barcode: manualEntry || `SCAN-${Date.now()}`,
          scanMode,
          currentPatientId: currentPatient?.id || null,
        }),
      });
      
      if (response.ok) {
        const scanResult = await response.json();
        const newScan: ScannedItem = {
          id: scanResult.id || `scan-${Date.now()}`,
          type: scanMode,
          barcode: scanResult.barcode || manualEntry,
          name: scanResult.name || 'Unknown',
          details: scanResult.details || '',
          timestamp: new Date(scanResult.timestamp || Date.now()),
          result: scanResult.result || 'success',
          message: scanResult.message,
        };
        
        setLastScan(newScan);
        setScanHistory(prev => [newScan, ...prev]);
        
        // If scanning a patient, set as current patient
        if (scanMode === 'patient' && scanResult.patient) {
          setCurrentPatient(scanResult.patient);
        }
      } else {
        // Handle API error - show error in UI
        const errorScan: ScannedItem = {
          id: `scan-${Date.now()}`,
          type: scanMode,
          barcode: manualEntry || 'N/A',
          name: 'Scan Failed',
          details: 'Unable to process barcode',
          timestamp: new Date(),
          result: 'error',
          message: 'API request failed',
        };
        setLastScan(errorScan);
        setScanHistory(prev => [errorScan, ...prev]);
      }
    } catch (err) {
      console.error('Barcode scan error:', err);
      const errorScan: ScannedItem = {
        id: `scan-${Date.now()}`,
        type: scanMode,
        barcode: manualEntry || 'N/A',
        name: 'Scan Failed',
        details: 'Server connection error',
        timestamp: new Date(),
        result: 'error',
        message: 'Could not connect to server',
      };
      setLastScan(errorScan);
      setScanHistory(prev => [errorScan, ...prev]);
    } finally {
      setIsScanning(false);
    }
  };

  const handleManualEntry = () => {
    if (!manualEntry.trim()) return;
    simulateScan();
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
      case 'pending': return <Clock className="w-6 h-6 text-gray-400" />;
    }
  };

  const getResultBg = (result: ScanResult) => {
    switch (result) {
      case 'success': return 'bg-green-50 border-green-200';
      case 'warning': return 'bg-yellow-50 border-yellow-200';
      case 'error': return 'bg-red-50 border-red-200';
      case 'pending': return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-700 text-white p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <ScanLine className="w-8 h-8" />
            <h1 className="text-xl font-bold">Barcode Scanner</h1>
          </div>
          {currentPatient && (
            <div className="text-right">
              <p className="text-sm font-medium">{currentPatient.name}</p>
              <p className="text-xs text-gray-300">Room {currentPatient.room}</p>
            </div>
          )}
        </div>
      </div>

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
              <span className="capitalize">{mode}</span>
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
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab}
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
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                <CameraOff className="w-16 h-16 mb-4" />
                <p>Camera not active</p>
                <button
                  onClick={startCamera}
                  className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium"
                >
                  Start Camera
                </button>
              </div>
            )}

            {/* Scan Overlay */}
            {isCameraActive && (
              <>
                {/* Scanning Frame */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-64 h-40 border-2 border-white/50 rounded-lg relative">
                    <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl" />
                    <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr" />
                    <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl" />
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br" />
                    
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
                    onClick={simulateScan}
                    disabled={isScanning}
                    className={`px-8 py-3 rounded-full font-semibold ${
                      isScanning
                        ? 'bg-blue-400 text-white'
                        : 'bg-blue-600 text-white'
                    }`}
                  >
                    {isScanning ? 'Scanning...' : 'Scan'}
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
            <label htmlFor="barcode-manual-entry" className="sr-only">Enter barcode manually</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id="barcode-manual-entry"
                  type="text"
                  value={manualEntry}
                  onChange={(e) => setManualEntry(e.target.value)}
                  placeholder="Enter barcode manually..."
                  className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg pl-10 pr-4 py-2 focus:ring-2 focus:ring-blue-500"
                />
                <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              </div>
              <button
                onClick={handleManualEntry}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium"
              >
                Submit
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
                    <span className="font-semibold text-gray-900">{lastScan.name}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{lastScan.details}</p>
                  {lastScan.message && (
                    <p className={`text-sm mt-1 ${
                      lastScan.result === 'error' ? 'text-red-600' : 'text-yellow-600'
                    }`}>
                      {lastScan.message}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">{lastScan.barcode}</p>
                </div>
              </div>
            </div>
          )}

          {/* Current Patient Alert */}
          {currentPatient && currentPatient.allergies.length > 0 && (
            <div className="mx-4 mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <span className="text-red-300 font-medium">Allergies:</span>
                <span className="text-red-200">{currentPatient.allergies.join(', ')}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="flex-1 bg-gray-50 p-4 space-y-3">
          {scanHistory.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <History className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No scan history yet</p>
            </div>
          ) : (
            scanHistory.map(scan => (
              <div key={scan.id} className={`bg-white rounded-lg shadow p-4 border-l-4 ${
                scan.result === 'success' ? 'border-green-500' :
                scan.result === 'warning' ? 'border-yellow-500' :
                scan.result === 'error' ? 'border-red-500' : 'border-gray-300'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-full ${
                      scan.type === 'patient' ? 'bg-blue-100 text-blue-600' :
                      scan.type === 'medication' ? 'bg-purple-100 text-purple-600' :
                      scan.type === 'equipment' ? 'bg-gray-100 text-gray-600' :
                      'bg-green-100 text-green-600'
                    }`}>
                      {getModeIcon(scan.type)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{scan.name}</p>
                      <p className="text-sm text-gray-500">{scan.details}</p>
                      <p className="text-xs text-gray-400 mt-1">{scan.barcode}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {getResultIcon(scan.result)}
                    <p className="text-xs text-gray-400 mt-1">
                      {scan.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                {scan.message && (
                  <p className={`text-sm mt-2 ${
                    scan.result === 'error' ? 'text-red-600' : 'text-yellow-600'
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
        <div className="flex-1 bg-gray-50 p-4 space-y-4">
          <div className="bg-white rounded-lg shadow divide-y">
            <div className="p-4">
              <h3 className="font-semibold text-gray-900">Scanner Settings</h3>
            </div>
            {[
              { label: 'Auto-scan on focus', enabled: true },
              { label: 'Vibrate on successful scan', enabled: true },
              { label: 'Sound feedback', enabled: true },
              { label: 'Continuous scanning mode', enabled: false },
              { label: 'Save scan history', enabled: true }
            ].map((setting, idx) => (
              <div key={idx} className="p-4 flex items-center justify-between">
                <span className="text-gray-700">{setting.label}</span>
                <button
                  className={`w-12 h-6 rounded-full transition-colors ${
                    setting.enabled ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      setting.enabled ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow divide-y">
            <div className="p-4">
              <h3 className="font-semibold text-gray-900">Supported Formats</h3>
            </div>
            <div className="p-4">
              <div className="flex flex-wrap gap-2">
                {['Code 128', 'Code 39', 'EAN-13', 'UPC-A', 'QR Code', 'Data Matrix', 'PDF417'].map(format => (
                  <span key={format} className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                    {format}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <button className="w-full flex items-center justify-center gap-2 text-red-600 font-medium">
              <History className="w-5 h-5" />
              Clear Scan History
            </button>
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
