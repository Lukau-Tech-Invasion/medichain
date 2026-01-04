/**
 * Alert Component
 */

import { type HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, CheckCircle2, Info, XCircle, X } from 'lucide-react';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  onClose?: () => void;
}

export function Alert({
  children,
  variant = 'info',
  title,
  onClose,
  className,
  ...props
}: AlertProps) {
  const variants = {
    info: {
      container: 'bg-blue-50 border-blue-200 text-blue-800',
      icon: <Info className="w-5 h-5 text-blue-500" />,
    },
    success: {
      container: 'bg-green-50 border-green-200 text-green-800',
      icon: <CheckCircle2 className="w-5 h-5 text-green-500" />,
    },
    warning: {
      container: 'bg-yellow-50 border-yellow-200 text-yellow-800',
      icon: <AlertCircle className="w-5 h-5 text-yellow-500" />,
    },
    error: {
      container: 'bg-red-50 border-red-200 text-red-800',
      icon: <XCircle className="w-5 h-5 text-red-500" />,
    },
  };

  const config = variants[variant];

  return (
    <div
      role="alert"
      className={clsx(
        'flex gap-3 p-4 border rounded-lg',
        config.container,
        className
      )}
      {...props}
    >
      <div className="shrink-0">{config.icon}</div>
      <div className="flex-1 min-w-0">
        {title && <p className="font-medium">{title}</p>}
        <div className={clsx('text-sm', title && 'mt-1')}>{children}</div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded hover:bg-black/10 transition-colors"
          aria-label="Close alert"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
