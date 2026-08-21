/**
 * Shared Toast Notification System
 * 
 * Provides toast notifications to replace browser alert() calls.
 * Supports success, error, warning, and info types with auto-dismiss.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
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

/**
 * Toast styling, in semantic tokens rather than raw palette scales.
 *
 * The raw scales (`bg-green-50`, `text-gray-700`, ...) have a single fixed
 * value and no dark variant, so in dark mode a toast rendered as a near-white
 * card whose text colour was whatever it inherited - which is how error
 * messages ended up unreadable at exactly the moment they mattered. The
 * `*-subtle` / `*-subtle-fg` token pairs carry their own light and dark values
 * and are the pairs `scripts/check-contrast.py` verifies against WCAG AA, so
 * using them here means the gate now actually covers this component.
 */
const toastStyles: Record<
  ToastType,
  { bg: string; border: string; fg: string; icon: React.ReactNode; iconBg: string }
> = {
  success: {
    bg: 'bg-ok-subtle',
    border: 'border-ok',
    fg: 'text-ok-subtle-fg',
    iconBg: 'bg-ok-subtle',
    icon: <CheckCircle className="text-ok-subtle-fg" size={20} />,
  },
  error: {
    bg: 'bg-critical-subtle',
    border: 'border-critical',
    fg: 'text-critical-subtle-fg',
    iconBg: 'bg-critical-subtle',
    icon: <AlertCircle className="text-critical-subtle-fg" size={20} />,
  },
  warning: {
    bg: 'bg-caution-subtle',
    border: 'border-caution',
    fg: 'text-caution-subtle-fg',
    iconBg: 'bg-caution-subtle',
    icon: <AlertTriangle className="text-caution-subtle-fg" size={20} />,
  },
  info: {
    bg: 'bg-notice-subtle',
    border: 'border-notice',
    fg: 'text-notice-subtle-fg',
    iconBg: 'bg-notice-subtle',
    icon: <Info className="text-notice-subtle-fg" size={20} />,
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
          <p className={`text-sm font-semibold ${style.fg}`}>{toast.title}</p>
        )}
        <p className={`text-sm ${style.fg}`}>{toast.message}</p>
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 p-1 rounded hover:opacity-70 transition-opacity"
        aria-label="Dismiss notification"
      >
        <X size={16} className={style.fg} />
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

/**
 * Provider-less fallback: toasts are dropped, nothing else breaks.
 *
 * `useToast` used to throw without a `ToastProvider` above it. A hook throw
 * unmounts the whole React tree, so a page whose only use of toasts is an
 * error banner would render as a blank screen instead — in a clinical UI that
 * trades a missing notification for a lost page. It also made every component
 * using toasts untestable without a wrapper. Losing a toast is recoverable;
 * losing the page is not. Mount `ToastProvider` to actually surface them.
 */
const FALLBACK_TOAST: ToastContextType = {
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
};

export function useToast() {
  return useContext(ToastContext) ?? FALLBACK_TOAST;
}

export function useToastActions() {
  const { addToast } = useToast();

  return {
    showSuccess: (message: string, title?: string) => addToast('success', message, title),
    showError: (message: string, title?: string) => addToast('error', message, title),
    showWarning: (message: string, title?: string) => addToast('warning', message, title),
    showInfo: (message: string, title?: string) => addToast('info', message, title),
  };
}
