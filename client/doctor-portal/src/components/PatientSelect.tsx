import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store';
import { apiUrl } from '@medichain/shared';
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
}: PatientSelectProps) {
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch patients on mount
  useEffect(() => {
    if (!user) return;

    const fetchPatients = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(apiUrl('/api/patients'), {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const patientArray = Array.isArray(data) ? data : (data.data || []);
          setPatients(patientArray);
        } else {
          setError('Failed to load patients');
        }
      } catch (err) {
        console.error('Failed to fetch patients:', err);
        setError('Failed to load patients');
      } finally {
        setLoading(false);
      }
    };

    fetchPatients();
  }, [user]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter patients based on search term
  const filteredPatients = patients.filter(p =>
    (p.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (p.patient_id?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (p.health_id?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

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
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      
      <div className="relative">
        {/* Selected patient display or search input */}
        {selectedPatient && !isOpen ? (
          <div 
            className={`
              w-full flex items-center justify-between px-4 py-2.5 
              border border-gray-300 dark:border-slate-600 rounded-lg 
              bg-white dark:bg-slate-800 
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary-400'}
            `}
            onClick={() => !disabled && setIsOpen(true)}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary-100 dark:bg-primary-900 rounded-full flex items-center justify-center">
                <User size={16} className="text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{selectedPatient.full_name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedPatient.patient_id} • {selectedPatient.health_id}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleClear(); }}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"
                >
                  <X size={16} className="text-gray-400" />
                </button>
              )}
              <ChevronDown size={18} className="text-gray-400" />
            </div>
          </div>
        ) : (
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
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
                border border-gray-300 dark:border-slate-600 rounded-lg 
                bg-white dark:bg-slate-800 
                text-gray-900 dark:text-white
                placeholder-gray-400 dark:placeholder-gray-500
                focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            />
            {loading ? (
              <Loader2 size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
            ) : (
              <ChevronDown 
                size={18} 
                className={`absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
              />
            )}
          </div>
        )}

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-gray-500 dark:text-gray-400">
                <Loader2 size={20} className="animate-spin mr-2" />
                Loading patients...
              </div>
            ) : error ? (
              <div className="py-4 px-3 text-center text-red-500">{error}</div>
            ) : filteredPatients.length === 0 ? (
              <div className="py-4 px-3 text-center text-gray-500 dark:text-gray-400">
                {searchTerm ? 'No patients found matching your search' : 'No patients available'}
              </div>
            ) : (
              filteredPatients.map((patient) => (
                <button
                  key={patient.patient_id}
                  type="button"
                  onClick={() => handleSelect(patient)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 text-left
                    hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors
                    ${value === patient.patient_id ? 'bg-primary-50 dark:bg-primary-900/30' : ''}
                  `}
                >
                  <div className="w-8 h-8 bg-primary-100 dark:bg-primary-900 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-primary-600 dark:text-primary-400">
                      {patient.full_name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {patient.full_name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {patient.patient_id} • Health ID: {patient.health_id}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
