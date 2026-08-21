import { Link } from 'react-router-dom';
import { 
  Users, 
  ArrowRight, 
  AlertTriangle, 
  Droplets, 
  Activity,
  Syringe,
  Footprints,
  Loader2
} from 'lucide-react';

export interface PatientListItem {
  patient_id: string;
  health_id?: string;
  full_name: string;
  room?: string;
  esi_level?: number;
  blood_type?: string;
  allergies?: string[];
  flags?: {
    fall_risk?: boolean;
    iv_site?: boolean;
    diabetic?: boolean;
    wound_care?: boolean;
    ventilator?: boolean;
    isolation?: boolean;
  };
  last_vitals?: {
    time: string;
    abnormal?: boolean;
  };
}

interface PatientListPanelProps {
  title: string;
  patients: PatientListItem[];
  loading?: boolean;
  maxDisplay?: number;
  viewAllLink?: string;
  showEsi?: boolean;
  showFlags?: boolean;
  emptyMessage?: string;
}

const esiColors: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: 'bg-critical-subtle', text: 'text-critical-subtle-fg', label: 'ESI-1' },
  2: { bg: 'bg-surface-sunken', text: 'text-content-secondary', label: 'ESI-2' },
  3: { bg: 'bg-caution-subtle', text: 'text-caution-subtle-fg', label: 'ESI-3' },
  4: { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg', label: 'ESI-4' },
  5: { bg: 'bg-notice-subtle', text: 'text-notice-subtle-fg', label: 'ESI-5' },
};

/**
 * Patient list panel for dashboards
 * Displays a list of patients with optional flags and ESI levels
 */
export default function PatientListPanel({
  title,
  patients,
  loading = false,
  maxDisplay = 5,
  viewAllLink = '/patients',
  showEsi = false,
  showFlags = false,
  emptyMessage = 'No patients found',
}: PatientListPanelProps) {
  const displayedPatients = patients.slice(0, maxDisplay);

  return (
    <div className="bg-surface rounded-xl shadow">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="text-content-muted" size={20} />
          <h3 className="font-semibold text-content">{title}</h3>
          {!loading && patients.length > 0 && (
            <span className="bg-surface-sunken text-content-muted text-xs px-2 py-0.5 rounded-full">
              {patients.length}
            </span>
          )}
        </div>
        {viewAllLink && (
          <Link 
            to={viewAllLink} 
            className="text-brand hover:text-brand text-sm inline-flex items-center gap-1 min-h-[24px] py-1"
          >
            View all <ArrowRight size={14} />
          </Link>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <Loader2 className="mx-auto mb-3 text-gray-300 animate-spin" size={48} />
          <p className="text-content-muted">Loading patients...</p>
        </div>
      ) : displayedPatients.length > 0 ? (
        <div className="divide-y divide-border">
          {displayedPatients.map((patient) => (
            <Link
              key={patient.patient_id}
              to={`/patients/${patient.patient_id}`}
              className="flex items-center justify-between p-4 hover:bg-surface-sunken transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-subtle rounded-full flex items-center justify-center">
                  <Users className="text-brand" size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-content">{patient.full_name}</p>
                    {showFlags && patient.flags?.fall_risk && (
                      <span title="Fall Risk">
                        <Footprints size={14} className="text-yellow-500" />
                      </span>
                    )}
                    {showFlags && patient.flags?.iv_site && (
                      <span title="IV Site">
                        <Syringe size={14} className="text-blue-500" />
                      </span>
                    )}
                    {showFlags && patient.flags?.diabetic && (
                      <span title="Diabetic">
                        <Droplets size={14} className="text-purple-500" />
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-content-muted">
                    {patient.room && `${patient.room} • `}
                    {patient.health_id || patient.patient_id}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {patient.blood_type && (
                  <span className="text-xs bg-critical-subtle text-critical-subtle-fg px-2 py-1 rounded">
                    {patient.blood_type}
                  </span>
                )}
                {patient.allergies && patient.allergies.length > 0 && (
                  <span className="text-xs bg-caution-subtle text-caution-subtle-fg px-2 py-1 rounded flex items-center gap-1">
                    <AlertTriangle size={12} />
                    {patient.allergies.length}
                  </span>
                )}
                {showEsi && patient.esi_level && esiColors[patient.esi_level] && (
                  <span className={`text-xs px-2 py-1 rounded font-medium ${esiColors[patient.esi_level].bg} ${esiColors[patient.esi_level].text}`}>
                    {esiColors[patient.esi_level].label}
                  </span>
                )}
                {patient.last_vitals?.abnormal && (
                  <Activity size={16} className="text-red-500 animate-pulse" />
                )}
                <ArrowRight size={16} className="text-content-muted" />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="p-8 text-center text-content-muted">
          <Users className="mx-auto mb-3 text-gray-300" size={48} />
          <p>{emptyMessage}</p>
        </div>
      )}
    </div>
  );
}
