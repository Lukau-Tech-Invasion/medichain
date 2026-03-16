/**
 * Toast Notification System
 * 
 * Provides toast notifications to replace browser alert() calls.
 * Supports success, error, warning, and info types with auto-dismiss.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, title?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

const TOAST_DURATION = 5000; // Auto-dismiss after 5 seconds

const toastStyles: Record<ToastType, { bg: string; border: string; icon: React.ReactNode; iconBg: string }> = {
  success: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    iconBg: 'bg-green-100',
    icon: <CheckCircle className="text-green-600" size={20} />,
  },
  error: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    iconBg: 'bg-red-100',
    icon: <AlertCircle className="text-red-600" size={20} />,
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    iconBg: 'bg-amber-100',
    icon: <AlertTriangle className="text-amber-600" size={20} />,
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    iconBg: 'bg-blue-100',
    icon: <Info className="text-blue-600" size={20} />,
  },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const style = toastStyles[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg shadow-lg border ${style.bg} ${style.border} animate-slide-in`}
      role="alert"
      aria-live="polite"
    >
      <div className={`flex-shrink-0 p-1 rounded-full ${style.iconBg}`}>
        {style.icon}
      </div>
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
        )}
        <p className="text-sm text-gray-700">{toast.message}</p>
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 p-1 rounded hover:bg-gray-200 transition-colors"
        aria-label="Dismiss notification"
      >
        <X size={16} className="text-gray-500" />
      </button>
    </div>
  );
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-md w-full pointer-events-auto">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string, title?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message, title }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

/**
 * Convenience functions for showing toasts
 * Usage: 
 *   const { showSuccess, showError, showWarning, showInfo } = useToastActions();
 *   showSuccess('Record saved successfully');
 *   showError('Failed to submit form');
 */
export function useToastActions() {
  const { addToast } = useToast();

  return {
    showSuccess: (message: string, title?: string) => addToast('success', message, title),
    showError: (message: string, title?: string) => addToast('error', message, title),
    showWarning: (message: string, title?: string) => addToast('warning', message, title),
    showInfo: (message: string, title?: string) => addToast('info', message, title),
  };
}
