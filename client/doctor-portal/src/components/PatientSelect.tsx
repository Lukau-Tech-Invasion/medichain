import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store';
import { getPatients, clickable } from '@medichain/shared';
import { Search, User, ChevronDown, Loader2, X } from 'lucide-react';

export interface Patient {
  patient_id: string;
  full_name: string;
  health_id?: string;
  date_of_birth?: string;
}

interface PatientSelectProps {
  value: string;
  onChange: (patientId: string, patient?: Patient) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
  id?: string;
  /** A field error from the page's own validation, shown under the control. */
  error?: string;
  /** Called when focus leaves the control, so a page can validate on blur. */
  onBlur?: () => void;
}

/**
 * PatientSelect - Reusable component for selecting a patient from the database
 * 
 * Features:
 * - Fetches patients from API
 * - Searchable dropdown
 * - Shows patient name, ID, and health ID
 * - Keyboard accessible
 */
export default function PatientSelect({
  value,
  onChange,
  placeholder = 'Search and select a patient...',
  required = false,
  disabled = false,
  className = '',
  label,
  id,
  error,
  onBlur,
}: PatientSelectProps) {
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  // The component's own load failure, distinct from the `error` prop a page
  // passes down from its field validation.
  const [loadError, setLoadError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Query the server rather than downloading a roster and filtering protected
  // names in the browser. The short debounce avoids a request for every key.
  useEffect(() => {
    if (!user) return;

    let active = true;

    const fetchPatients = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const patientArray = await getPatients({ query: searchTerm, limit: 50 });
        // Unreadable rows remain visible in the directory but cannot be used
        // as a clinical selector until their profile can be decrypted.
        if (active) setPatients(patientArray.filter((patient) => patient.content_available !== false));
      } catch {
        if (active) setLoadError('Failed to load patients');
      } finally {
        if (active) setLoading(false);
      }
    };

    const timer = window.setTimeout(() => {
      void fetchPatients();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      active = false;
    };
  }, [user, searchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onBlur]);

  // Get selected patient details for display
  const selectedPatient = patients.find(p => p.patient_id === value);

  const handleSelect = (patient: Patient) => {
    onChange(patient.patient_id, patient);
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('', undefined);
    setSearchTerm('');
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    if (!isOpen) setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown' && !isOpen) {
      setIsOpen(true);
    }
  };

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-content-secondary mb-2">
          {label} {required && <span className="text-critical">*</span>}
        </label>
      )}
      
      <div className="relative">
        {/* Selected patient display or search input */}
        {selectedPatient && !isOpen ? (
          // `${id}-selected`: the search input carries `id` only while the
          // picker is open, so once a patient is chosen there is nothing at
          // `#id` to address. That left anything driving this control — a
          // browser test, a keyboard shortcut, a label — with no handle on the
          // collapsed state, and it is the state the screen spends most of its
          // life in.
          <div
            id={id ? `${id}-selected` : undefined}
            className={`
              w-full flex items-center justify-between px-4 py-2.5
              border border-border-strong rounded-lg
              bg-surface
              ${disabled ? 'bg-disabled text-disabled-fg cursor-not-allowed' : 'cursor-pointer hover:border-brand'}
            `}
            {...clickable(() => !disabled && setIsOpen(true))}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-brand-subtle dark:bg-primary-900 rounded-full flex items-center justify-center">
                <User size={16} className="text-brand dark:text-primary-400" />
              </div>
              <div>
                <p className="font-medium text-content">{selectedPatient.full_name}</p>
                <p className="text-xs text-content-muted">
                  {selectedPatient.patient_id} • {selectedPatient.health_id}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleClear(); }}
                  className="p-1 hover:bg-surface-sunken rounded"
                >
                  <X size={16} className="text-content-muted" />
                </button>
              )}
              <ChevronDown size={18} className="text-content-muted" />
            </div>
          </div>
        ) : (
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              ref={inputRef}
              id={id}
              type="text"
              value={searchTerm}
              onChange={handleInputChange}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              className={`
                w-full pl-10 pr-10 py-2.5 
                border border-border-interactive rounded-lg 
                bg-surface 
                text-content
                placeholder:text-content-muted placeholder:text-content-muted
                focus:ring-2 focus:ring-primary-500 focus:border-brand
                disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed
              `}
            />
            {loading ? (
              <Loader2 size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted animate-spin" />
            ) : (
              <ChevronDown 
                size={18} 
                className={`absolute right-3 top-1/2 -translate-y-1/2 text-content-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} 
              />
            )}
          </div>
        )}

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-content-muted">
                <Loader2 size={20} className="animate-spin mr-2" />
                Loading patients...
              </div>
            ) : loadError ? (
              <div className="py-4 px-3 text-center text-critical-subtle-fg">{loadError}</div>
            ) : patients.length === 0 ? (
              <div className="py-4 px-3 text-center text-content-muted">
                {searchTerm ? 'No patients found matching your search' : 'No patients available'}
              </div>
            ) : (
              patients.map((patient) => (
                <button
                  key={patient.patient_id}
                  type="button"
                  onClick={() => handleSelect(patient)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 text-left
                    hover:bg-surface-sunken transition-colors
                    ${value === patient.patient_id ? 'bg-brand-subtle dark:bg-primary-900/30' : ''}
                  `}
                >
                  <div className="w-8 h-8 bg-brand-subtle dark:bg-primary-900 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-brand dark:text-primary-400">
                      {patient.full_name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-content truncate">
                      {patient.full_name}
                    </p>
                    <p className="text-xs text-content-muted truncate">
                      {patient.patient_id} • Health ID: {patient.health_id}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* The page's own field validation, so a form that requires a patient can
          say so here rather than only on submit. */}
      {error && (
        <p id={id ? `${id}-error` : undefined} role="alert" className="mt-1 text-sm text-critical-subtle-fg">
          {error}
        </p>
      )}
    </div>
  );
}
