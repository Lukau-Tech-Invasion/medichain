/**
 * Command Palette Component
 * 
 * Quick navigation with keyboard shortcut (Ctrl+K or Cmd+K)
 * Allows users to search and navigate to any page quickly.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Search, X, Home, Users, FileText, Activity, Pill, Siren, Settings, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CommandItem {
  id: string;
  label: string;
  to: string;
  category: string;
  icon: React.ReactNode;
  keywords?: string[];
}

// All navigable pages in the application
const ALL_COMMANDS: CommandItem[] = [
  // Main
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', category: 'Main', icon: <Home size={16} />, keywords: ['home'] },
  { id: 'patient-search', label: 'Patient Search', to: '/patient-search', category: 'Main', icon: <Users size={16} />, keywords: ['find', 'lookup'] },
  { id: 'register', label: 'Register Patient', to: '/register-patient', category: 'Main', icon: <Users size={16} />, keywords: ['new', 'add'] },
  { id: 'appointments', label: 'Appointments', to: '/appointments', category: 'Main', icon: <Activity size={16} />, keywords: ['schedule'] },
  
  // Clinical
  { id: 'triage', label: 'Triage', to: '/triage', category: 'Clinical', icon: <FileText size={16} />, keywords: ['esi'] },
  { id: 'soap', label: 'SOAP Note', to: '/soap', category: 'Clinical', icon: <FileText size={16} />, keywords: ['documentation'] },
  { id: 'vitals', label: 'Vital Signs', to: '/vitals', category: 'Clinical', icon: <Activity size={16} />, keywords: ['bp', 'hr'] },
  { id: 'progress', label: 'Progress Note', to: '/progress-note', category: 'Clinical', icon: <FileText size={16} /> },
  { id: 'hp', label: 'History & Physical', to: '/history-physical', category: 'Clinical', icon: <FileText size={16} />, keywords: ['h&p'] },
  { id: 'discharge', label: 'Discharge', to: '/discharge', category: 'Clinical', icon: <FileText size={16} /> },
  
  // Emergency
  { id: 'emergency-access', label: 'Emergency Access', to: '/emergency-access', category: 'Emergency', icon: <Siren size={16} />, keywords: ['nfc'] },
  { id: 'code-blue', label: 'Code Blue', to: '/code-blue', category: 'Emergency', icon: <Siren size={16} />, keywords: ['cardiac'] },
  { id: 'trauma', label: 'Trauma', to: '/trauma', category: 'Emergency', icon: <Siren size={16} /> },
  { id: 'stroke', label: 'Stroke', to: '/stroke', category: 'Emergency', icon: <Siren size={16} /> },
  { id: 'cardiac', label: 'Cardiac', to: '/cardiac', category: 'Emergency', icon: <Siren size={16} /> },
  { id: 'sepsis', label: 'Sepsis', to: '/sepsis', category: 'Emergency', icon: <Siren size={16} /> },
  
  // Nursing
  { id: 'nursing', label: 'Nursing Hub', to: '/nursing', category: 'Nursing', icon: <Activity size={16} /> },
  { id: 'mar', label: 'MAR', to: '/mar', category: 'Nursing', icon: <Pill size={16} />, keywords: ['medication'] },
  { id: 'care-plan', label: 'Care Plan', to: '/care-plan', category: 'Nursing', icon: <FileText size={16} /> },
  { id: 'io', label: 'Intake & Output', to: '/intake-output', category: 'Nursing', icon: <Activity size={16} /> },
  { id: 'handoff', label: 'Shift Handoff', to: '/shift-handoff', category: 'Nursing', icon: <FileText size={16} />, keywords: ['sbar'] },
  
  // Medications
  { id: 'orders', label: 'Orders', to: '/orders', category: 'Medications', icon: <FileText size={16} /> },
  { id: 'eprescribe', label: 'E-Prescribe', to: '/e-prescribe', category: 'Medications', icon: <Pill size={16} />, keywords: ['rx'] },
  { id: 'drug-interactions', label: 'Drug Interactions', to: '/drug-interactions', category: 'Medications', icon: <Pill size={16} /> },
  
  // Lab
  { id: 'lab-results', label: 'Lab Results', to: '/lab-results', category: 'Lab', icon: <Activity size={16} />, keywords: ['tests'] },
  { id: 'specimen', label: 'Specimen Collection', to: '/specimen', category: 'Lab', icon: <Activity size={16} /> },
  { id: 'critical-value', label: 'Critical Values', to: '/critical-value', category: 'Lab', icon: <Siren size={16} /> },
  { id: 'blood-bank', label: 'Blood Bank', to: '/blood-bank', category: 'Lab', icon: <Activity size={16} /> },
  
  // Admin
  { id: 'user-management', label: 'User Management', to: '/user-management', category: 'Admin', icon: <Users size={16} /> },
  { id: 'analytics', label: 'Analytics', to: '/analytics', category: 'Admin', icon: <Activity size={16} /> },
  { id: 'access-logs', label: 'Access Logs', to: '/access-logs', category: 'Admin', icon: <FileText size={16} /> },
  
  // Settings
  { id: 'settings', label: 'Settings', to: '/settings', category: 'Settings', icon: <Settings size={16} /> },
];

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Filter items based on query
  const filteredItems = query === ''
    ? ALL_COMMANDS.slice(0, 10)
    : ALL_COMMANDS.filter((item) => {
        const searchText = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(searchText) ||
          item.category.toLowerCase().includes(searchText) ||
          item.keywords?.some(k => k.toLowerCase().includes(searchText))
        );
      }).slice(0, 12);

  // Group by category
  const groupedItems = filteredItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, CommandItem[]>);

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback((item: CommandItem) => {
    navigate(item.to);
    onClose();
  }, [navigate, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredItems[selectedIndex]) handleSelect(filteredItems[selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[999] overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-start justify-center pt-[15vh] px-4">
        <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b">
            <Search className="text-gray-400" size={20} />
            <input
              ref={inputRef}
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search pages..."
              className="flex-1 outline-none text-gray-900 placeholder:text-gray-400"
              aria-label="Command palette search"
            />
            <kbd className="hidden sm:inline-flex px-2 py-1 text-xs bg-gray-100 text-gray-500 rounded border">esc</kbd>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
              <X size={18} className="text-gray-400" />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {Object.entries(groupedItems).length > 0 ? (
              Object.entries(groupedItems).map(([category, items]) => (
                <div key={category}>
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase bg-gray-50">
                    {category}
                  </div>
                  {items.map((item) => {
                    const isSelected = filteredItems[selectedIndex]?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          isSelected ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <span className={isSelected ? 'text-primary-600' : 'text-gray-400'}>{item.icon}</span>
                        <span className="flex-1 font-medium">{item.label}</span>
                        <ChevronRight size={16} className={isSelected ? 'text-primary-400' : 'text-gray-300'} />
                      </button>
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-gray-500">No results for "{query}"</div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t bg-gray-50 text-xs text-gray-500 flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border rounded">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border rounded">↵</kbd> select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border rounded">esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage command palette state with keyboard shortcut
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) };
}
