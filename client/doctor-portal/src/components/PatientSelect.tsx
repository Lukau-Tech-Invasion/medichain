import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store';
import { getPatients, clickable, getApiClient, useTranslation, formatDateOnly, ModalPanel, searchOfflineRoster, withViewTransition } from '@medichain/shared';
import { rememberIdentified } from '../workspace/identifiedPatients';
import type { OfflineBundle, OfflinePatient } from '@medichain/shared';
import { useClinicianOffline } from '../offline/ClinicianOffline';
import type { PatientDirectoryEntry } from '@medichain/shared';
import { ChartAccessPrompt, applyAccess, declaredAccessFor } from './ChartAccess';
import { Search, User, ChevronDown, Loader2, X } from 'lucide-react';
import { useContext } from 'react';
import { UNSAFE_LocationContext, UNSAFE_NavigationContext } from 'react-router-dom';
import { usePatientWorkspace } from '../workspace/PatientWorkspaceContext';
import { patientFormOfPath, workspacePath } from '../workspace/forms';

// ux-allow(no-form): rendered inside other pages' forms, where a nested <form> is invalid; Enter is handled on the control itself.

/**
 * Whether the page around the picker already holds typed content. Moving a
 * page into the patient workspace remounts it, so the move is only made when
 * nothing would be lost.
 */
function pageHasTypedContent(root: HTMLElement | null): boolean {
  const scope = root?.closest('main') ?? document.querySelector('main');
  if (!scope) return false;
  const fields = scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=search]), textarea',
  );
  return [...fields].some((field) => !root?.contains(field) && field.value.trim() !== '');
}

/**
 * Which page the person last clicked or typed on.
 *
 * Moving into the workspace remounts the page as it first opens. A picker that
 * appeared only after the person did something (opened "Enter result", "New
 * repair", "Add specimen") would land them back on the list with that form
 * gone, so only a picker that was on screen before any of that moves.
 */
let lastInteractionPage: string | null = null;
const currentPage = (): string =>
  (window.history.state as { key?: string } | null)?.key ?? window.location.pathname;
if (typeof document !== 'undefined') {
  const note = () => { lastInteractionPage = currentPage(); };
  document.addEventListener('pointerdown', note, true);
  document.addEventListener('keydown', note, true);
}

/** A directory row, exactly as `getPatients` returns it; pages receive the whole entry. */
export type Patient = PatientDirectoryEntry;

/**
 * One patient's directory entry by id, searched on the server.
 *
 * For a page opened with `?patient=<id>`: looking the id up in the first page
 * of `getPatients()` found nobody past the fiftieth patient. Resolves the
 * directory identity only; it does not open or grant chart access. `null`
 * when no readable entry matches.
 */
/** A patient from the day kept on this device, in the directory's shape. */
function fromRoster(p: OfflinePatient): Patient {
  return { patient_id: p.patient_id, full_name: p.full_name, date_of_birth: p.date_of_birth, content_available: true } as Patient;
}

/** The kept day's entry for `patientId`, when there is one. */
function rosterEntry(roster: OfflineBundle | null, patientId: string): Patient | null {
  const found = roster?.patients.find((p) => p.patient_id === patientId);
  return found ? fromRoster(found) : null;
}

export async function findDirectoryPatient(patientId: string): Promise<Patient | null> {
  const rows = await getPatients({ query: patientId, limit: 50 });
  return rows.find((row) => row.patient_id === patientId && row.content_available !== false) ?? null;
}

// One lookup per patient per session: a list of fifty records about three
// patients costs three requests, and revisiting the list costs none.
const directoryNameCache = new Map<string, Promise<string | null>>();

/**
 * Display names for the patients a list of records refers to.
 *
 * Lists used to label each record from the first page of `getPatients()`, so a
 * record about anyone past the fiftieth patient showed a bare id. An id that
 * cannot be resolved is absent from the map; the caller shows the id rather
 * than guessing a name.
 */
export function useDirectoryNames(patientIds: readonly string[]): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const key = Array.from(new Set(patientIds.filter(Boolean))).sort().join('|');

  useEffect(() => {
    const ids = key ? key.split('|') : [];
    if (ids.length === 0) return;
    let active = true;
    void Promise.all(ids.map((id) => {
      let lookup = directoryNameCache.get(id);
      if (!lookup) {
        lookup = findDirectoryPatient(id).then((entry) => entry?.full_name ?? null, () => null);
        directoryNameCache.set(id, lookup);
      }
      return lookup.then((name) => [id, name] as const);
    })).then((resolved) => {
      if (!active) return;
      setNames(new Map(resolved.filter((pair): pair is readonly [string, string] => pair[1] !== null)));
    });
    return () => { active = false; };
  }, [key]);

  return names;
}

/**
 * The directory entry for the patient a page has chosen.
 *
 * Pages used to find the chosen patient in the first page of `getPatients()`
 * when saving; past the fiftieth patient that found nobody, and the save either
 * stored a blank name or returned without a word. `resolve()` is for the save
 * path: it waits for the lookup instead of racing it.
 */
export function useDirectoryPatient(patientId: string | null | undefined): {
  entry: Patient | null;
  resolve: () => Promise<Patient | null>;
} {
  const [entry, setEntry] = useState<Patient | null>(null);
  const pending = useRef<{ id: string; lookup: Promise<Patient | null> } | null>(null);

  const lookup = useCallback((id: string) => {
    if (pending.current?.id !== id) {
      pending.current = { id, lookup: findDirectoryPatient(id).catch(() => null) };
    }
    return pending.current.lookup;
  }, []);

  useEffect(() => {
    setEntry(null);
    if (!patientId) return;
    let active = true;
    void lookup(patientId).then((found) => { if (active) setEntry(found); });
    return () => { active = false; };
  }, [patientId, lookup]);

  const resolve = useCallback(
    async () => (patientId ? lookup(patientId) : null),
    [patientId, lookup],
  );
  return { entry: entry?.patient_id === patientId ? entry : null, resolve };
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
  /** False only for a workflow that selects a patient without opening clinical data. */
  requireChartAccess?: boolean;
}

/**
 * PatientSelect - Reusable component for selecting a patient from the database
 * 
 * Features:
 * - Fetches patients from API
 * - Searchable dropdown
 * - Shows patient name, ID, and health ID
 * - Keyboard accessible
 * - Asks why the chart is being opened (once per patient per tab) and opens a
 *   server-issued access context before the page receives the patient, so
 *   every page that picks a patient and loads their data is covered (WP10)
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
  requireChartAccess = true,
}: PatientSelectProps) {
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedDirectoryPatient, setSelectedDirectoryPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  // The component's own load failure, distinct from the `error` prop a page
  // passes down from its field validation.
  const [loadError, setLoadError] = useState<string | null>(null);
  const { t } = useTranslation();
  // A patient picked but not yet opened: the reason prompt is showing.
  const [pending, setPending] = useState<Patient | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Read without the throwing hooks: the picker is also rendered outside a
  // router (unit tests, embedded panels), where there is nowhere to move to.
  const location = useContext(UNSAFE_LocationContext)?.location;
  const navigator = useContext(UNSAFE_NavigationContext)?.navigator;
  // Inside a patient workspace the patient is already chosen: adopt it, once.
  const workspace = usePatientWorkspace();
  // No signal: search today's patients on this device instead of the server.
  const { online, roster } = useClinicianOffline();
  const searchingOffline = !online && roster !== null;
  // Read once, at mount: was this picker revealed by something the person did?
  const appearedAfterInteraction = useRef(lastInteractionPage === currentPage());
  // What was last handed over: the id, and whether the entry came with it. The
  // chart can open before the patient's entry loads, and a page that keeps only
  // the entry (Pre-Op, IV site, burn, care plan, fall risk) was left with no
  // patient -- it refused to save -- because the id alone never changed again.
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (!workspace) return;
    const entry = workspace.patient ?? undefined;
    const handedOver = `${workspace.patientId}|${entry ? 'entry' : 'id'}`;
    if (value !== workspace.patientId || adopted.current !== handedOver) {
      adopted.current = handedOver;
      onChange(workspace.patientId, entry);
    }
    // `onChange` is often an inline function; re-running on its identity would
    // re-adopt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.patientId, workspace?.patient, value]);

  // Query the server rather than downloading a roster and filtering protected
  // names in the browser. The short debounce avoids a request for every key.
  useEffect(() => {
    if (!user || workspace) return;

    let active = true;
    setPatients([]);
    setLoading(true);

    const fetchPatients = async () => {
      setLoading(true);
      setLoadError(null);
      if (searchingOffline) {
        if (active) {
          setPatients(searchOfflineRoster(roster, searchTerm).map(fromRoster));
          setLoading(false);
        }
        return;
      }
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
  }, [user, searchTerm, searchingOffline, roster]);

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
  const selectedPatient: Pick<Patient, 'patient_id' | 'full_name' | 'health_id'> | undefined = selectedDirectoryPatient?.patient_id === value
    ? selectedDirectoryPatient : patients.find(p => p.patient_id === value)
      ?? (value ? { patient_id: value, full_name: 'Selected patient', health_id: undefined } : undefined);

  // An edited record may belong to a patient outside the first directory page.
  // Resolve only its directory identity; this does not open or grant chart access.
  useEffect(() => {
    let active = true;
    setSelectedDirectoryPatient(null);
    if (!user || !value) return;
    if (searchingOffline) {
      setSelectedDirectoryPatient(rosterEntry(roster, value));
      return;
    }
    findDirectoryPatient(value).then(found => {
      if (active) setSelectedDirectoryPatient(found);
    }).catch(() => {
      if (!active) return;
      const kept = rosterEntry(roster, value);
      if (kept) setSelectedDirectoryPatient(kept);
      else setLoadError('The selected patient could not be loaded');
    });
    return () => { active = false; };
  }, [value, user, searchingOffline, roster]);

  // Reads of the selected patient cite its access context; leaving the page
  // clears it, so the next page's patient cannot inherit this one's.
  useEffect(() => {
    const access = declaredAccessFor(value || undefined);
    if (value && access) applyAccess(value, access);
  }, [value]);
  useEffect(() => () => getApiClient().setPatientAccessContext(undefined), []);

  const choose = (patient: Patient) => {
    setSelectedDirectoryPatient(patient);
    // Chosen by name from the directory: the break-glass screen may say who
    // this is without asking the server (identifiedPatients.ts).
    if (patient.content_available !== false) {
      rememberIdentified({ patientId: patient.patient_id, name: patient.full_name, dateOfBirth: patient.date_of_birth, gender: patient.gender });
    }
    onChange(patient.patient_id, patient);
    setSearchTerm('');
    setIsOpen(false);
    // Opened the old way (`/vitals`, then pick a patient): carry on inside the
    // patient's workspace, so the next form needs no picking at all.
    const form = location ? patientFormOfPath(location.pathname) : undefined;
    if (navigator && !workspace && requireChartAccess && form && !appearedAfterInteraction.current
      && !pageHasTypedContent(wrapperRef.current)) {
      // Into the chart by a cross-fade (c10); the picker has no row left to glide.
      withViewTransition(() => navigator.replace(workspacePath(patient.patient_id, form), { from: location }));
    }
  };

  const handleSelect = (patient: Patient) => {
    // Offline the reason prompt cannot reach the server to open an access
    // context, and nothing is read from the server either. The day list was
    // downloaded under the clinician's authority and logged per patient.
    if (!requireChartAccess || searchingOffline) {
      choose(patient);
      return;
    }
    const access = declaredAccessFor(patient.patient_id);
    if (access) {
      applyAccess(patient.patient_id, access);
      choose(patient);
      return;
    }
    setIsOpen(false);
    setPending(patient);
  };

  const handleClear = () => {
    onChange('', undefined);
    setSearchTerm('');
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPatients([]);
    setLoading(true);
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

  if (workspace) {
    // Inside a chart the patient is already chosen -- the banner names them and
    // the access-reason gate has been passed for them. No control that could
    // switch to somebody else, and no second copy of the name (c3).
    return null;
  }

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
                  {/* ux-allow(raw-patient-id): the picker's second identifier under the name, beside the health id (UX plan 1.2). */}
                  {selectedPatient.patient_id}{selectedPatient.health_id ? ` • ${selectedPatient.health_id}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Clear selected patient ${selectedPatient.full_name}`}
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
              // A placeholder is not a label: it disappears as soon as the
              // clinician types. Pages that pass `label` are labelled by it;
              // the rest still need a name a screen reader can announce.
              aria-label={label ? undefined : 'Patient: search by name or record ID'}
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
                {searchingOffline
                  ? t('clinicianOffline.noMatchOffline')
                  : searchTerm ? 'No patients found matching your search' : 'No patients available'}
              </div>
            ) : (
              <>
              {searchingOffline && (
                <p className="px-3 py-2 text-xs text-caution-subtle-fg bg-caution-subtle">{t('clinicianOffline.searchOffline')}</p>
              )}
              {patients.map((patient) => {
                // Two identifiers on every row; a name shared with another row is
                // called out, because that is where the wrong chart gets opened.
                const sameName = patients.some((other) => other.patient_id !== patient.patient_id
                  && other.full_name.trim().toLowerCase() === patient.full_name.trim().toLowerCase());
                return (
                <button
                  key={patient.patient_id}
                  type="button"
                  data-patient-id={patient.patient_id}
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
                      {patient.date_of_birth ? `${t('patientSelect.born')} ${formatDateOnly(patient.date_of_birth)}` : patient.patient_id}
                      {patient.health_id ? ` • ${t('patientSelect.healthId')} ${patient.health_id}` : ''}
                    </p>
                    {sameName && (
                      <p className="mt-0.5 text-xs font-semibold text-caution-subtle-fg">{t('patientSelect.sameName')}</p>
                    )}
                  </div>
                </button>
                );
              })}
              </>
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
      {pending && (
        <ModalPanel
          label={t('accessReason.title')}
          onClose={() => setPending(null)}
          closeOnBackdrop={false}
          overlayClassName="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
          className="w-full max-w-xl"
        >
            <ChartAccessPrompt
              patientId={pending.patient_id}
              title={t('accessReason.title')}
              onReady={(access) => {
                applyAccess(pending.patient_id, access);
                choose(pending);
                setPending(null);
              }}
              onCancel={() => setPending(null)}
            />
        </ModalPanel>
      )}
    </div>
  );
}
