import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import {
  useTranslation,
  formatTimestamp,
  getApiErrorMessage,
  getPatientCodeBlues,
  getPatientTraumas,
  getPatientStrokes,
  getPatientCardiacEvents,
  getPatientSepsisAssessments,
  type CodeBlueListRow,
  type TraumaListRow,
  type StrokeListRow,
  type CardiacEventListRow,
  type SepsisListRow,
} from '@medichain/shared';
import {
  AlertCircle,
  Activity,
  Heart,
  Brain,
  Flame,
  Siren,
  ChevronLeft,
  Plus,
  Clock,
  User,
  type LucideIcon,
} from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import StaffName from '../components/StaffName';

type EmergencyType = 'code_blue' | 'trauma' | 'stroke' | 'cardiac' | 'sepsis';

/**
 * The rows each tab holds: the list endpoints' summary entities. This page
 * used to declare its own shapes -- `code_blue_id`, `mechanism_of_injury`,
 * `antibiotics_given`, `rosc_achieved` -- none of which any endpoint returns,
 * so every ID rendered blank and every yes/no finding rendered as "No".
 */
interface Records {
  code_blue: CodeBlueListRow[];
  trauma: TraumaListRow[];
  stroke: StrokeListRow[];
  cardiac: CardiacEventListRow[];
  sepsis: SepsisListRow[];
}

const NO_RECORDS: Records = { code_blue: [], trauma: [], stroke: [], cardiac: [], sepsis: [] };

/** One labelled finding. `null` means it was not recorded, and is not shown. */
interface Finding {
  label: string;
  value: ReactNode | null;
}

/** Epoch SECONDS from the API; 0 and null both mean "not recorded". */
function recordedAt(seconds: number | null | undefined): string {
  return seconds ? formatTimestamp(seconds * 1000) : '';
}

function RecordCard({
  icon: Icon,
  iconTone,
  title,
  subtitle,
  at,
  by,
  findings,
}: {
  icon: LucideIcon;
  iconTone: string;
  title: string;
  subtitle?: string | null;
  at: number;
  by: string;
  findings: Finding[];
}) {
  const shown = findings.filter((f) => f.value !== null && f.value !== '');
  return (
    <div className="bg-surface rounded-xl shadow p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-lg ${iconTone}`}>
            <Icon size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-lg text-content">{title}</h3>
            {subtitle && <p className="text-sm text-content-muted">{subtitle}</p>}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 text-sm text-content-muted min-h-[24px] py-1">
            <Clock size={16} />
            {recordedAt(at)}
          </div>
          <div className="flex items-center gap-2 text-sm text-content-muted mt-1 min-h-[24px] py-1">
            <User size={16} />
            <StaffName id={by} />
          </div>
        </div>
      </div>
      {shown.length > 0 && (
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {shown.map((f) => (
            <div key={f.label}>
              <dt className="text-sm font-medium text-content-secondary">{f.label}</dt>
              <dd className="text-content">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function EmergencyProtocolsPage() {
  const { t } = useTranslation();
  const { patientId: routePatientId } = useParams<{ patientId: string }>();
  // The sidebar links here with no patient in the path, so every read was
  // `/api/emergency/{type}/patient/undefined` and the header said
  // "Patient ID:" followed by nothing. A patient chosen on the page is the
  // same patient as one named in the route.
  const [chosenPatientId, setChosenPatientId] = useState('');
  const patientId = routePatientId || chosenPatientId;
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [activeTab, setActiveTab] = useState<EmergencyType>('code_blue');
  const [records, setRecords] = useState<Records>(NO_RECORDS);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  const fetchEmergencyRecords = useCallback(async () => {
    if (!user) return;
    // No patient chosen yet means there is nothing to ask for; asking about
    // the empty id 404s, which reads as "this patient has none".
    if (!patientId) {
      setRecords(NO_RECORDS);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const next = { ...NO_RECORDS };
      switch (activeTab) {
        case 'code_blue':
          next.code_blue = await getPatientCodeBlues(patientId);
          break;
        case 'trauma':
          next.trauma = await getPatientTraumas(patientId);
          break;
        case 'stroke':
          next.stroke = await getPatientStrokes(patientId);
          break;
        case 'cardiac':
          next.cardiac = await getPatientCardiacEvents(patientId);
          break;
        case 'sepsis':
          next.sepsis = await getPatientSepsisAssessments(patientId);
          break;
      }
      setRecords(next);
    } catch (err) {
      // A failed read used to leave the empty-state card up, which says the
      // patient has no such records. This says the page could not look.
      setRecords(NO_RECORDS);
      setLoadError(getApiErrorMessage(err, t('docEmergProto.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [activeTab, patientId, user, t]);

  useEffect(() => {
    if (user) {
      void fetchEmergencyRecords();
    }
  }, [patientId, activeTab, user, fetchEmergencyRecords]);

  const yesNo = (value: boolean | null): string | null =>
    value === null ? null : value ? t('docEmergProto.yes') : t('docEmergProto.no');

  /** Where each protocol is actually documented. */
  const PROTOCOL_ROUTE: Record<EmergencyType, string> = {
    code_blue: '/code-blue',
    trauma: '/trauma',
    stroke: '/stroke',
    cardiac: '/cardiac',
    sepsis: '/sepsis',
  };

  const tabs: { id: EmergencyType; label: string; icon: LucideIcon; color: string }[] = [
    { id: 'code_blue', label: t('docEmergProto.tabCodeBlue'), icon: Siren, color: 'text-notice-subtle-fg' },
    { id: 'trauma', label: t('docEmergProto.tabTrauma'), icon: AlertCircle, color: 'text-content-secondary' },
    { id: 'stroke', label: t('docEmergProto.tabStroke'), icon: Brain, color: 'text-content-secondary' },
    { id: 'cardiac', label: t('docEmergProto.tabCardiac'), icon: Heart, color: 'text-critical-subtle-fg' },
    { id: 'sepsis', label: t('docEmergProto.tabSepsis'), icon: Flame, color: 'text-caution-subtle-fg' },
  ];

  const cards: Record<EmergencyType, ReactNode[]> = {
    code_blue: records.code_blue.map((r) => (
      <RecordCard
        key={r.id}
        icon={Siren}
        iconTone="bg-notice-subtle text-notice-subtle-fg"
        title={t('docEmergProto.codeBlue')}
        subtitle={t('docEmergProto.idLabel', { id: r.id })}
        at={r.code_called_at}
        by={r.documented_by}
        findings={[
          { label: t('docEmergProto.location'), value: r.location },
          { label: t('docEmergProto.initialRhythm'), value: r.initial_rhythm },
          { label: t('docEmergProto.witnessed'), value: yesNo(r.witnessed) },
          { label: t('docEmergProto.outcome'), value: r.outcome },
          { label: t('docEmergProto.codeLeader'), value: r.code_leader },
          { label: t('docEmergProto.teamArrived'), value: recordedAt(r.team_arrived_at) || null },
        ]}
      />
    )),
    trauma: records.trauma.map((r) => (
      <RecordCard
        key={r.id}
        icon={AlertCircle}
        iconTone="bg-surface-sunken text-content-secondary"
        title={t('docEmergProto.traumaAssessment')}
        subtitle={t('docEmergProto.idLabel', { id: r.id })}
        at={r.assessed_at}
        by={r.assessed_by}
        findings={[
          { label: t('docEmergProto.mechanism'), value: r.mechanism },
          { label: t('docEmergProto.gcs'), value: r.gcs },
          { label: t('docEmergProto.traumaLevel'), value: r.trauma_level },
          { label: t('docEmergProto.mtpActivated'), value: yesNo(r.mtp_activated) },
          { label: t('docEmergProto.disposition'), value: r.disposition },
        ]}
      />
    )),
    stroke: records.stroke.map((r) => (
      <RecordCard
        key={r.id}
        icon={Brain}
        iconTone="bg-surface-sunken text-content-secondary"
        title={t('docEmergProto.strokeAssessment')}
        subtitle={t('docEmergProto.idLabel', { id: r.id })}
        at={r.assessed_at}
        by={r.assessed_by}
        findings={[
          { label: t('docEmergProto.nihssTotal'), value: r.nihss_total },
          { label: t('docEmergProto.strokeType'), value: r.stroke_type },
          { label: t('docEmergProto.tpaEligible'), value: yesNo(r.tpa_eligible) },
          { label: t('docEmergProto.tpaGiven'), value: yesNo(r.tpa_given) },
          { label: t('docEmergProto.hemorrhage'), value: yesNo(r.hemorrhage) },
          { label: t('docEmergProto.lvoSuspected'), value: yesNo(r.lvo_suspected) },
        ]}
      />
    )),
    cardiac: records.cardiac.map((r) => (
      <RecordCard
        key={r.id}
        icon={Heart}
        iconTone="bg-critical-subtle text-critical-subtle-fg"
        title={t('docEmergProto.cardiacEvent')}
        subtitle={t('docEmergProto.idLabel', { id: r.id })}
        at={r.documented_at}
        by={r.documented_by}
        findings={[
          { label: t('docEmergProto.eventType'), value: r.event_type },
          { label: t('docEmergProto.cathLab'), value: yesNo(r.cath_lab_activated) },
          { label: t('docEmergProto.pci'), value: yesNo(r.pci_performed) },
          {
            label: t('docEmergProto.doorToBalloon'),
            value:
              r.door_to_balloon_minutes === null
                ? null
                : t('docEmergProto.minutes', { value: r.door_to_balloon_minutes }),
          },
        ]}
      />
    )),
    sepsis: records.sepsis.map((r) => (
      <RecordCard
        key={r.id}
        icon={Flame}
        iconTone="bg-caution-subtle text-caution-subtle-fg"
        title={t('docEmergProto.sepsisAssessment')}
        subtitle={t('docEmergProto.qsofa', { score: r.qsofa_score })}
        at={r.assessed_at}
        by={r.assessed_by}
        findings={[
          { label: t('docEmergProto.severity'), value: r.severity },
          { label: t('docEmergProto.suspectedSource'), value: r.suspected_source },
          // Null SOFA means no organ system was measured, which is not a
          // score of 0 (Rule 12); say so rather than hide the row.
          { label: t('docEmergProto.sofa'), value: r.sofa_score ?? t('docEmergProto.notMeasured') },
          { label: t('docEmergProto.vasopressors'), value: yesNo(r.vasopressors_required) },
          { label: t('docEmergProto.icuAdmission'), value: yesNo(r.icu_admission) },
        ]}
      />
    )),
  };

  const EMPTY_KEY: Record<EmergencyType, string> = {
    code_blue: 'docEmergProto.noCodeBlue',
    trauma: 'docEmergProto.noTrauma',
    stroke: 'docEmergProto.noStroke',
    cardiac: 'docEmergProto.noCardiac',
    sepsis: 'docEmergProto.noSepsis',
  };
  const ActiveIcon = tabs.find((tab) => tab.id === activeTab)?.icon ?? Activity;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link to={patientId ? `/patients/${patientId}` : '/patients'} className="p-2 hover:bg-surface-sunken rounded-lg transition-colors">
            <ChevronLeft size={24} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-content">{t('docEmergProto.title')}</h1>
            {patientId && <p className="text-content-muted mt-1">{t('docEmergProto.patientId', { id: patientId })}</p>}
          </div>
        </div>
        {/* This toggled a `showAddForm` flag that nothing read: the button
            could be pressed for ever and no form existed to appear. Each
            protocol already has its own screen, so "new record" opens the one
            the active tab names. */}
        <button
          onClick={() => navigate(PROTOCOL_ROUTE[activeTab])}
          className="px-6 py-3 bg-critical text-critical-fg rounded-lg hover:bg-critical transition-colors flex items-center gap-2"
        >
          <Plus size={20} />
          {t('docEmergProto.newRecord')}
        </button>
      </div>

      {!routePatientId && (
        <div className="bg-surface rounded-xl shadow p-4 mb-6 max-w-md">
          <PatientSelect
            id="emergency-protocols-patient"
            label={t('docEmergProto.patientSelectLabel')}
            value={chosenPatientId}
            onChange={(selectedPatientId) => setChosenPatientId(selectedPatientId)}
          />
        </div>
      )}

      {/* Emergency Type Tabs */}
      <div className="bg-surface rounded-xl shadow mb-6">
        <div className="flex border-b border-border overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-b-2 border-critical text-critical-subtle-fg'
                    : 'text-content-muted hover:text-content-secondary'
                }`}
              >
                <Icon size={20} className={activeTab === tab.id ? tab.color : ''} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        {loadError && (
          <div role="alert" className="bg-critical-subtle text-critical-subtle-fg rounded-xl p-4">
            {loadError}
          </div>
        )}
        {!loading && !loadError && cards[activeTab]}
        {!patientId && (
          <div className="bg-surface rounded-xl shadow p-12 text-center">
            <p className="text-content-muted">{t('docEmergProto.choosePatient')}</p>
          </div>
        )}
        {patientId && !loading && !loadError && cards[activeTab].length === 0 && (
          <div className="bg-surface rounded-xl shadow p-12 text-center">
            <ActiveIcon className="mx-auto mb-3 text-content-muted" size={48} />
            <p className="text-content-muted">{t(EMPTY_KEY[activeTab])}</p>
          </div>
        )}
        {loading && (
          <div role="status" className="bg-surface rounded-xl shadow p-12 text-center">
            <Activity className="mx-auto mb-3 text-brand animate-spin" size={48} />
            <p className="text-content-muted">{t('docEmergProto.loading')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default EmergencyProtocolsPage;
