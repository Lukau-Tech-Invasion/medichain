/** Nursing overview: only confirmed successful reads may produce empty-work claims. */
import { useNavigate } from 'react-router-dom';
import { Users, Activity, AlertTriangle, Droplets, HeartPulse, Pill, ClipboardList, FileText } from 'lucide-react';
import { useTranslation, type NurseDashboardResponse, type NursingOrderTask } from '@medichain/shared';
import { StatCard, CriticalAlertsBanner, QuickActionsPanel, PatientListPanel, type CriticalAlert, type QuickAction } from '../components/dashboard';
import { useAuthStore } from '../store';
import { useNurseDashboardReads, type NurseRead } from '../hooks/useNurseDashboardReads';
import MyWardPanel from '../components/MyWardPanel';

type DashboardRead = NurseRead<NurseDashboardResponse>;

/** Render independent dashboard and order resources without suppressing either successful result. */
export default function NurseDashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { dashboard, orders } = useNurseDashboardReads(user?.userId ?? '');
  return <div className="min-w-0 p-4 sm:p-6 space-y-6 bg-surface-sunken min-h-screen">
    <header><h1 className="text-2xl font-bold text-content">{t('docNurseDashboard.title')}</h1>
      <p className="text-sm text-content-muted mt-1">{t('docNurseDashboard.subtitle')}</p></header>
    <NurseReadStatus resource={dashboard} kind="dashboard" />
    <NurseReadStatus resource={orders} kind="orders" />
    {dashboard.data && <NurseVitalAlerts data={dashboard.data} />}
    {dashboard.data && <NurseMedications data={dashboard.data} />}
    <NurseStats resource={dashboard} />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 [&>*]:min-w-0">
      <MyWardPanel />
      <NurseTasks dashboard={dashboard} orders={orders} />
    </div>
    {/* The roster above is "my patients". This list is the facility's most
        recently registered patients, labelled as such: it used to be titled
        "My Patients" and was the first 15 rows of the patients table. */}
    <NursePatients resource={dashboard} />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 [&>*]:min-w-0"><NurseQuickActions /><NurseIo resource={dashboard} /></div>
  </div>;
}

/** Announce unknown resources and provide a retry scoped to only that read. */
function NurseReadStatus({ resource, kind }: { resource: NurseRead<unknown>; kind: 'dashboard' | 'orders' }) {
  const { t } = useTranslation();
  if (resource.status === 'ready') return null;
  if (resource.status === 'loading') return <p role="status">{t(kind === 'dashboard' ? 'docNurseDashboard.loadingDashboard' : 'docNurseDashboard.loadingOrders')}</p>;
  return <div role="alert" className="bg-caution-subtle text-caution-subtle-fg rounded-lg p-4">
    <p>{t(kind === 'dashboard' ? 'docNurseDashboard.dashboardFailed' : 'docNurseDashboard.ordersFailed')}</p>
    <button className="mt-2 rounded-lg border border-current px-3 py-2 font-semibold focus-visible:outline focus-visible:outline-2" onClick={() => void resource.reload()}>
      {t(kind === 'dashboard' ? 'docNurseDashboard.retryDashboard' : 'docNurseDashboard.retryOrders')}
    </button>
  </div>;
}

/** Preserve the dashboard's existing abnormal-observation alert mapping. */
function NurseVitalAlerts({ data }: { data: NurseDashboardResponse }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const alerts: CriticalAlert[] = data.vitals_needing_attention.map(v => ({
    id: v.flowsheet_id || v.patient_id, type: 'critical_value', title: t('docNurseDashboard.abnormalVitals'),
    description: v.abnormal_values?.join(', ') || t('docNurseDashboard.checkVitals'),
    patient_name: v.patient_name, timestamp: new Date().toISOString(), severity: 'high',
  }));
  return <CriticalAlertsBanner alerts={alerts} onViewAll={() => navigate('/critical-value')} />;
}

/** Keep MAR-provided route/time/dose fields; missing observations are not inferred as oral dosing. */
function NurseMedications({ data }: { data: NurseDashboardResponse }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const medications = data.medication_records.slice(0, 5);
  if (!medications.length) return null;
  return <div className="bg-ok-subtle border-2 border-ok rounded-lg p-4">
    <div className="flex items-start justify-between mb-3 gap-3">
      <h3 className="text-lg font-bold text-ok-subtle-fg flex gap-2"><Pill size={24} />{t('docNurseDashboard.medsDueNow', { count: medications.length })}</h3>
      <button onClick={() => navigate('/mar')} className="font-medium text-ok-subtle-fg">{t('docNurseDashboard.openMar')}</button>
    </div>
    <div className="space-y-2">{medications.map(med => <div key={med.record_id} className="flex items-center justify-between gap-3 p-3 bg-surface rounded border border-ok">
      <div className="flex-1 min-w-0"><p className="font-medium text-content">{med.patient_name || t('docNurseDashboard.unknown')} - {med.medication_name || t('docNurseDashboard.unknown')} {med.dosage || ''}</p>
        <p className="text-sm text-content-muted">{med.route || t('docNurseDashboard.unknown')} - {t('docNurseDashboard.due')}: {med.scheduled_time || t('docNurseDashboard.unknown')}</p></div>
      <button className="px-3 py-2 rounded bg-brand text-brand-fg" onClick={() => navigate('/mar')}>{t('docNurseDashboard.administer')}</button>
    </div>)}</div>
  </div>;
}

/** Unknown dashboard counters stay unavailable rather than becoming zero. */
function NurseStats({ resource }: { resource: DashboardRead }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = resource.data;
  const cards = [
    { label: 'statRecentPatients', value: data?.patients.total, icon: Users, color: 'bg-ok-subtle', iconColor: 'text-ok-subtle-fg', path: '/patients' },
    { label: 'statVitalsDue', value: data?.tasks.vitals_due, icon: Activity, color: 'bg-caution-subtle', iconColor: 'text-caution-subtle-fg', path: '/vitals' },
    { label: 'statFallRisk', value: data?.fall_risk_patients.length, icon: AlertTriangle, color: 'bg-critical-subtle', iconColor: 'text-critical-subtle-fg' },
    { label: 'statIvChecks', value: data?.tasks.ivs_to_check, icon: Droplets, color: 'bg-notice-subtle', iconColor: 'text-notice-subtle-fg', path: '/iv-site' },
    { label: 'statWoundsToAssess', value: data?.tasks.wounds_to_assess, icon: HeartPulse, color: 'bg-caution-subtle', iconColor: 'text-caution-subtle-fg', path: '/wound-care' },
  ];
  return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">{cards.map(card => <StatCard key={card.label}
    label={t(`docNurseDashboard.${card.label}`)} value={typeof card.value === 'number' && Number.isFinite(card.value) ? card.value : t('docNurseDashboard.unavailable')}
    icon={<card.icon size={24} className={card.iconColor} />} color={card.color} loading={resource.status === 'loading'}
    onClick={card.path ? () => navigate(card.path!) : undefined} />)}</div>;
}

/** Render only a confirmed patient roster as empty; an unavailable roster is a separate state. */
function NursePatients({ resource }: { resource: DashboardRead }) {
  const { t } = useTranslation();
  const patients = resource.data?.patients.list.map(patient => ({
    patient_id: patient.patient_id, full_name: patient.full_name, room: patient.room, esi_level: patient.esi_level,
    flags: { fall_risk: patient.fall_risk, iv_site: patient.iv_site, wound_care: patient.wound_care_due },
  })) ?? [];
  if (resource.status === 'failed') return <section className="bg-surface rounded-lg shadow p-4 border border-border">
    <h3 className="font-semibold">{t('docNurseDashboard.recentPatients')}</h3><p>{t('docNurseDashboard.unavailable')}</p>
  </section>;
  return <PatientListPanel patients={patients} title={t('docNurseDashboard.recentPatients')} loading={resource.status === 'loading'} />;
}

/** Combine known observations/orders, but claim no outstanding work only when both reads succeeded. */
function NurseTasks({ dashboard, orders }: { dashboard: DashboardRead; orders: NurseRead<NursingOrderTask[]> }) {
  const { t } = useTranslation();
  const tasks = [
    ...(dashboard.data?.vitals_needing_attention ?? []).map(v => ({ id: v.flowsheet_id || v.patient_id,
      task: t('docNurseDashboard.taskVitalsFor'), patient: v.patient_name || v.patient_id, detail: v.abnormal_values?.join(', ') || '' })),
    ...(orders.data ?? []).map(order => ({ id: order.id, task: t(`docNurseDashboard.taskKind_${order.type}`),
      patient: order.patient_id, detail: [order.frequency, order.instructions].filter(Boolean).join(' — ') })),
  ];
  const complete = dashboard.status === 'ready' && orders.status === 'ready';
  return <section className="bg-surface rounded-lg shadow p-4 border border-border">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-content-secondary mb-3"><ClipboardList size={16} aria-hidden="true" />{t('docNurseDashboard.tasksDue')}</h3>
    {!complete && <p className="text-sm text-content-muted">{t('docNurseDashboard.tasksUnknown')}</p>}
    {complete && !tasks.length && <p className="text-sm text-content-muted p-2">{t('docNurseDashboard.tasksNone')}</p>}
    <div className="space-y-2">{tasks.map(task => <div key={task.id} className="flex flex-wrap gap-3 p-2 border rounded">
      <span className="text-sm text-content flex-1">{task.task}</span><span className="text-sm text-content-muted">{task.patient}</span>
      {task.detail && <span className="text-sm text-content-muted">{task.detail}</span>}
    </div>)}</div>
  </section>;
}

/** Keep existing workflow navigation available even while overview reads are unavailable. */
function NurseQuickActions() {
  const { t } = useTranslation();
  const actions: QuickAction[] = [
    { id: 'mar', label: t('docNurseDashboard.qaOpenMar'), icon: Pill, href: '/mar', color: 'green' },
    { id: 'vitals', label: t('docNurseDashboard.qaRecordVitals'), icon: Activity, href: '/vitals', color: 'blue' },
    { id: 'io', label: t('docNurseDashboard.qaIoDoc'), icon: Droplets, href: '/intake-output', color: 'amber' },
    { id: 'care-plan', label: t('docNurseDashboard.qaUpdateCarePlan'), icon: ClipboardList, href: '/care-plan', color: 'purple' },
  ];
  return <QuickActionsPanel actions={actions} columns={2} />;
}

/** Present confirmed intake/output rows; unknown measurements or failed reads cannot imply zero. */
function NurseIo({ resource }: { resource: DashboardRead }) {
  const { t } = useTranslation();
  const records = resource.data?.io_records;
  const volume = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? `${value} mL` : t('docNurseDashboard.unknown');
  const balance = (record: NurseDashboardResponse['io_records'][number]) => {
    if (typeof record.total_intake !== 'number' || typeof record.total_output !== 'number') return t('docNurseDashboard.unknown');
    const difference = record.total_intake - record.total_output;
    return Number.isFinite(difference) ? `${difference > 0 ? '+' : ''}${difference} mL` : t('docNurseDashboard.unknown');
  };
  return <section className="bg-surface rounded-lg shadow p-4 border border-border">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-content-secondary mb-3"><FileText size={16} aria-hidden="true" />{t('docNurseDashboard.ioSummaryToday')}</h3>
    {!records ? <p>{t('docNurseDashboard.unavailable')}</p> : !records.length ? <p className="text-sm text-content-muted">{t('docNurseDashboard.noIoRecords')}</p> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-content-muted border-b">
        {['colPatient', 'colIntake', 'colOutput', 'colBalance'].map(label => <th key={label} className="pb-2">{t(`docNurseDashboard.${label}`)}</th>)}
      </tr></thead><tbody>{records.map((record, index) => <tr key={index} className="border-b">
        <td className="py-2">{record.patient_name || t('docNurseDashboard.unknown')}</td><td>{volume(record.total_intake)}</td><td>{volume(record.total_output)}</td>
        <td>{balance(record)}</td>
      </tr>)}</tbody></table></div>}
  </section>;
}
