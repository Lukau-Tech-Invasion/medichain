import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store';
import { apiUrl } from '@medichain/shared';
import { Search, User, ChevronDown, Loader2, X, UserCircle } from 'lucide-react';

export interface StaffMember {
  wallet_address: string;
  name: string;
  role: string;
  username?: string;
  specialty?: string;
}

interface StaffSelectProps {
  value: string;
  onChange: (staffId: string, staff?: StaffMember) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
  id?: string;
  /** Filter by role: 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist', 'Admin' */
  roleFilter?: string;
  /** If true, returns the staff name instead of wallet address */
  returnName?: boolean;
}

/**
 * StaffSelect - Reusable component for selecting staff/providers from the database
 * 
 * Features:
 * - Fetches providers from API
 * - Searchable dropdown
 * - Shows staff name, role, and specialty
 * - Can filter by role (Doctor, Nurse, etc.)
 * - Keyboard accessible
 */
export default function StaffSelect({
  value,
  onChange,
  placeholder = 'Search and select a staff member...',
  required = false,
  disabled = false,
  className = '',
  label,
  id,
  roleFilter,
  returnName = false,
}: StaffSelectProps) {
  const { user } = useAuthStore();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch staff on mount
  useEffect(() => {
    if (!user) return;

    const fetchStaff = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = roleFilter 
          ? apiUrl(`/api/providers?role=${roleFilter}`)
          : apiUrl('/api/providers');
        
        const response = await fetch(url, {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const staffArray = Array.isArray(data.providers) ? data.providers : [];
          setStaff(staffArray);
        } else {
          setError('Failed to load staff members');
        }
      } catch (err) {
        console.error('Failed to fetch staff:', err);
        setError('Failed to load staff members');
      } finally {
        setLoading(false);
      }
    };

    fetchStaff();
  }, [user, roleFilter]);

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

  // Filter staff based on search term
  const filteredStaff = staff.filter(s =>
    (s.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (s.role?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (s.specialty?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (s.username?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  // Get selected staff details for display (check by wallet address or name)
  const selectedStaff = staff.find(s => 
    s.wallet_address === value || s.name === value
  );

  const handleSelect = (member: StaffMember) => {
    const returnValue = returnName ? member.name : member.wallet_address;
    onChange(returnValue, member);
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

  // Role color mapping
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'Doctor': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300';
      case 'Nurse': return 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300';
      case 'LabTechnician': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300';
      case 'Pharmacist': return 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300';
      case 'Admin': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300';
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
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
        {/* Selected staff display or search input */}
        {selectedStaff && !isOpen ? (
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
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                <UserCircle size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{selectedStaff.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${getRoleColor(selectedStaff.role)}`}>
                    {selectedStaff.role}
                  </span>
                  {selectedStaff.specialty && ` • ${selectedStaff.specialty}`}
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
                Loading staff...
              </div>
            ) : error ? (
              <div className="py-4 px-3 text-center text-red-500">{error}</div>
            ) : filteredStaff.length === 0 ? (
              <div className="py-4 px-3 text-center text-gray-500 dark:text-gray-400">
                {searchTerm ? 'No staff found matching your search' : 'No staff available'}
              </div>
            ) : (
              filteredStaff.map((member) => (
                <button
                  key={member.wallet_address}
                  type="button"
                  onClick={() => handleSelect(member)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 text-left
                    hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors
                    ${value === member.wallet_address || value === member.name ? 'bg-primary-50 dark:bg-primary-900/30' : ''}
                  `}
                >
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      {member.name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {member.name}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className={`inline-block px-1.5 py-0.5 rounded ${getRoleColor(member.role)}`}>
                        {member.role}
                      </span>
                      {member.specialty && <span>• {member.specialty}</span>}
                    </div>
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
