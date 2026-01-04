/**
 * Emergency Banner Component
 * Displays prominent alerts for emergency situations
 */

import { clsx } from 'clsx';
import { AlertTriangle, Clock, User, MapPin, X } from 'lucide-react';
import { Button } from './Button';

export interface EmergencyBannerProps {
  /** Type of emergency alert */
  type: 'access_granted' | 'access_requested' | 'critical_info';
  /** Patient ID being accessed */
  patientId: string;
  /** Person accessing the records */
  accessorName?: string;
  /** Role of the accessor */
  accessorRole?: string;
  /** Location of access */
  location?: string;
  /** Time remaining for access (in seconds) */
  timeRemaining?: number;
  /** Callback to close the banner */
  onClose?: () => void;
  /** Callback for emergency action */
  onAction?: () => void;
  /** Label for action button */
  actionLabel?: string;
  className?: string;
}

export function EmergencyBanner({
  type,
  patientId,
  accessorName,
  accessorRole,
  location,
  timeRemaining,
  onClose,
  onAction,
  actionLabel,
  className,
}: EmergencyBannerProps) {
  const configs = {
    access_granted: {
      bg: 'bg-red-600',
      icon: <AlertTriangle className="w-6 h-6" />,
      title: '🚨 EMERGENCY ACCESS GRANTED',
      subtitle: 'Time-limited access to medical records',
    },
    access_requested: {
      bg: 'bg-orange-500',
      icon: <Clock className="w-6 h-6" />,
      title: '⏳ EMERGENCY ACCESS REQUESTED',
      subtitle: 'Awaiting authorization',
    },
    critical_info: {
      bg: 'bg-red-700',
      icon: <AlertTriangle className="w-6 h-6" />,
      title: '⚠️ CRITICAL PATIENT INFORMATION',
      subtitle: 'Review immediately',
    },
  };

  const config = configs[type];

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      role="alert"
      className={clsx(
        'text-white px-4 py-3 rounded-lg shadow-lg',
        config.bg,
        className
      )}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 animate-pulse">{config.icon}</div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg">{config.title}</h3>
          <p className="text-white/80 text-sm">{config.subtitle}</p>
          
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1">
              <User className="w-4 h-4" />
              Patient: {patientId}
            </span>
            
            {accessorName && (
              <span className="flex items-center gap-1">
                Accessed by: {accessorName}
                {accessorRole && <span className="opacity-70">({accessorRole})</span>}
              </span>
            )}
            
            {location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                {location}
              </span>
            )}
            
            {timeRemaining !== undefined && (
              <span className="flex items-center gap-1 font-mono font-bold">
                <Clock className="w-4 h-4" />
                {formatTime(timeRemaining)} remaining
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onAction && actionLabel && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          )}
          
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-white/20 transition-colors"
              aria-label="Close banner"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Emergency Access Timer
 * Countdown display for emergency access duration
 */

export interface EmergencyTimerProps {
  /** Expiration time as ISO string or timestamp */
  expiresAt: string | number;
  /** Callback when time expires */
  onExpire?: () => void;
  className?: string;
}

import { useState, useEffect } from 'react';

export function EmergencyTimer({ 
  expiresAt, 
  onExpire, 
  className 
}: EmergencyTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  useEffect(() => {
    const expirationTime = typeof expiresAt === 'string' 
      ? new Date(expiresAt).getTime() 
      : expiresAt;

    const calculateSeconds = () => {
      const now = Date.now();
      return Math.max(0, Math.floor((expirationTime - now) / 1000));
    };

    setSecondsLeft(calculateSeconds());

    const interval = setInterval(() => {
      const remaining = calculateSeconds();
      setSecondsLeft(remaining);
      
      if (remaining === 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  const isLow = secondsLeft < 120; // Less than 2 minutes
  const isCritical = secondsLeft < 60; // Less than 1 minute

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 px-4 py-2 rounded-lg font-mono font-bold text-xl',
        isCritical 
          ? 'bg-red-100 text-red-700 animate-pulse' 
          : isLow 
            ? 'bg-orange-100 text-orange-700' 
            : 'bg-blue-100 text-blue-700',
        className
      )}
    >
      <Clock className="w-5 h-5" />
      <span>
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </div>
  );
}
