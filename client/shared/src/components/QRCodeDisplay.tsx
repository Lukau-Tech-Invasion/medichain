/**
 * QR Code Display Component
 * Displays QR codes for patient identification
 */

import { clsx } from 'clsx';
import { QrCode, Download, RefreshCw } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';

export interface QRCodeDisplayProps {
  /** Base64 encoded QR code image */
  qrCodeBase64?: string;
  /** Patient ID associated with the QR */
  patientId: string;
  /** Card/Tag hash for verification */
  cardHash?: string;
  /** Size of the QR code display */
  size?: 'sm' | 'md' | 'lg';
  /** Show download button */
  showDownload?: boolean;
  /** Callback for regenerating QR */
  onRegenerate?: () => void;
  /** Loading state */
  isLoading?: boolean;
  className?: string;
}

export function QRCodeDisplay({
  qrCodeBase64,
  patientId,
  cardHash,
  size = 'md',
  showDownload = true,
  onRegenerate,
  isLoading = false,
  className,
}: QRCodeDisplayProps) {
  const sizes = {
    sm: 'w-32 h-32',
    md: 'w-48 h-48',
    lg: 'w-64 h-64',
  };

  const handleDownload = () => {
    if (!qrCodeBase64) return;
    
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${qrCodeBase64}`;
    link.download = `medichain-${patientId}-qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Card className={clsx('text-center', className)} padding="lg">
      <div className="flex flex-col items-center">
        <div 
          className={clsx(
            'bg-white border-2 border-gray-200 rounded-lg flex items-center justify-center mb-4',
            sizes[size]
          )}
        >
          {isLoading ? (
            <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
          ) : qrCodeBase64 ? (
            <img 
              src={`data:image/png;base64,${qrCodeBase64}`}
              alt={`QR Code for patient ${patientId}`}
              className="w-full h-full p-2"
            />
          ) : (
            <QrCode className="w-12 h-12 text-gray-400" />
          )}
        </div>

        <p className="text-sm text-gray-600 mb-1">Patient ID</p>
        <p className="font-mono font-semibold text-gray-900 mb-2">{patientId}</p>
        
        {cardHash && (
          <>
            <p className="text-xs text-gray-500 mb-1">Card Hash (first 16 chars)</p>
            <p className="font-mono text-xs text-gray-600 mb-4 break-all">
              {cardHash.substring(0, 16)}...
            </p>
          </>
        )}

        <div className="flex gap-2">
          {showDownload && qrCodeBase64 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              leftIcon={<Download className="w-4 h-4" />}
            >
              Download
            </Button>
          )}
          {onRegenerate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRegenerate}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-4 h-4" />}
            >
              Regenerate
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * NFC Card Display
 * Visual representation of a patient's NFC card
 */

export interface NFCCardDisplayProps {
  patientId: string;
  patientName: string;
  cardHash: string;
  status: 'Active' | 'Suspended' | 'Revoked';
  nationalIdType: string;
  className?: string;
}

export function NFCCardDisplay({
  patientId,
  patientName,
  cardHash,
  status,
  nationalIdType,
  className,
}: NFCCardDisplayProps) {
  const statusColors = {
    Active: 'from-green-500 to-green-700',
    Suspended: 'from-yellow-500 to-yellow-700',
    Revoked: 'from-red-500 to-red-700',
  };

  return (
    <div
      className={clsx(
        'relative w-80 h-48 rounded-2xl overflow-hidden shadow-lg',
        'bg-gradient-to-br from-blue-600 to-blue-800',
        className
      )}
    >
      {/* Status indicator */}
      <div 
        className={clsx(
          'absolute top-3 right-3 w-3 h-3 rounded-full bg-gradient-to-br',
          statusColors[status]
        )}
        title={status}
      />

      {/* Card content */}
      <div className="absolute inset-0 p-5 flex flex-col justify-between text-white">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <QrCode className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs opacity-70">MediChain</p>
              <p className="font-bold">Health ID Card</p>
            </div>
          </div>
          <p className="text-lg font-semibold">{patientName}</p>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="opacity-70">ID</span>
            <span className="font-mono">{patientId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="opacity-70">Type</span>
            <span>{nationalIdType}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="opacity-70">Hash</span>
            <span className="font-mono opacity-80">{cardHash.substring(0, 12)}...</span>
          </div>
        </div>
      </div>

      {/* NFC symbol */}
      <div className="absolute bottom-3 right-3 w-8 h-8">
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full text-white/30">
          <path 
            d="M6 12C6 8.68629 8.68629 6 12 6M12 18C8.68629 18 6 15.3137 6 12M9 12C9 10.3431 10.3431 9 12 9M12 15C10.3431 15 9 13.6569 9 12M12 12H12.01" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
          />
        </svg>
      </div>
    </div>
  );
}
