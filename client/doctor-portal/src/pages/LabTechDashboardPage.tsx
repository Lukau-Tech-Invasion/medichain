/**
 * Lab Technician Dashboard Page
 * 
 * Lab-specific dashboard with STAT queue, QC status, pending specimens, and critical values
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FlaskConical,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Activity,
  BarChart3,
} from 'lucide-react';
import {
  getLabDashboard,
  notifyRejectionOrderingProvider,
  useTranslation,
} from '@medichain/shared';
import {
  StatCard,
  CriticalAlertsBanner,
  QuickActionsPanel,
  type CriticalAlert,
  type QuickAction,
} from '../components/dashboard';

interface LabDashboardData {
  role: string;
  test_queue: {
    pending: any[];
    approved_today: any[];
    pending_count: number;
    approved_count: number;
  };
  specimens: any[];
  rejections: any[];
  qc_records: any[];
  critical_notifications: any[];
  chain_of_custody: any[];
  available_panels: any[];
  alerts: {
    pending_tests: number;
    critical_values: number;
    rejections_today: number;
  };
}

export default function LabTechDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<LabDashboardData | null>(null);
  /** Which rejection is mid-request, so its button can be disabled. */
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const [notifyResult, setNotifyResult] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const response = await getLabDashboard();
      setData(response as LabDashboardData);
    } catch (error) {
      console.error('Failed to load lab dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const criticalAlerts: CriticalAlert[] = data?.critical_notifications?.map((c: any) => ({
    id: c.critical_value_id || String(Math.random()),
    type: 'critical_value' as const,
    title: `${c.test_name}: ${c.value} ${c.unit}`,
    description: t('docLabDashboard.criticalDesc'),
    patient_name: c.patient_name,
    timestamp: new Date().toISOString(),
    severity: 'critical' as const,
  })) || [];

  const quickActions: QuickAction[] = [
    { id: 'log-specimen', label: t('docLabDashboard.qaLogSpecimen'), icon: FlaskConical, href: '/specimen', color: 'blue' },
    { id: 'run-qc', label: t('docLabDashboard.qaRunQc'), icon: CheckCircle, href: '/lab-qc', color: 'green' },
    { id: 'result-entry', label: t('docLabDashboard.qaEnterResults'), icon: Activity, href: '/lab-results', color: 'amber' },
    { id: 'call-critical', label: t('docLabDashboard.qaCallCritical'), icon: AlertTriangle, href: '/critical-value', color: 'emergency' },
  ];

  const statQueue = data?.test_queue?.pending?.filter((q: any) => q.priority === 'STAT').map((q: any) => ({
    test_name: q.test_name || t('docLabDashboard.unknownTest'),
    patient_name: q.patient_name || t('docLabDashboard.unknown'),
    time_in_lab: q.time_in_lab || t('docLabDashboard.justArrived'),
    priority: q.priority || 'STAT',
  })) || [];

  const pendingQueue = data?.test_queue?.pending?.map((q: any) => ({
    accession: q.accession_number || q.id,
    patient_name: q.patient_name || t('docLabDashboard.unknown'),
    test_name: q.test_name || t('docLabDashboard.unknownTest'),
    priority: q.priority || 'Routine',
    time_in_lab: q.time_in_lab || t('docLabDashboard.pending'),
  })) || [];

  /**
   * Tell the ordering provider their specimen was rejected.
   *
   * Re-reads the dashboard afterwards rather than flipping local state: the
   * server decides whether the provider had already been told, and a second
   * clinician may have pressed Notify in the meantime.
   */
  const handleNotify = async (rejectionId: string) => {
    setNotifyingId(rejectionId);
    setNotifyResult((p) => ({ ...p, [rejectionId]: '' }));
    try {
      await notifyRejectionOrderingProvider(rejectionId);
      setNotifyResult((p) => ({ ...p, [rejectionId]: t('docLabDashboard.notified') }));
      const fresh = await getLabDashboard();
      setData(fresh as LabDashboardData);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The two refusals worth naming rather than showing raw: one means
      // somebody already did it, the other that there is nobody to tell.
      const friendly = /ALREADY_NOTIFIED/.test(message)
        ? t('docLabDashboard.alreadyNotified')
        : /NO_ORDERING_PROVIDER/.test(message)
          ? t('docLabDashboard.noOrderingProvider')
          : `${t('docLabDashboard.notifyFailed')} — ${message}`;
      setNotifyResult((p) => ({ ...p, [rejectionId]: friendly }));
    } finally {
      setNotifyingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-surface-sunken min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-content">{t('docLabDashboard.title')}</h1>
        <p className="text-sm text-content-muted mt-1">{t('docLabDashboard.subtitle')}</p>
      </div>

      {/* Critical Values Banner */}
      <CriticalAlertsBanner
        alerts={criticalAlerts}
        onAcknowledge={(id) => console.log('Call provider for:', id)}
        onViewAll={() => navigate('/lab/critical-values')}
      />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('docLabDashboard.statSpecimens')}
          value={data?.test_queue?.pending?.filter((t: any) => t.priority === 'STAT').length || 0}
          icon={<AlertTriangle className="text-critical-subtle-fg" size={24} />}
          color="bg-critical-subtle"
          onClick={() => navigate('/specimen')}
          loading={loading}
        />
        <StatCard
          label={t('docLabDashboard.pendingQueue')}
          value={data?.test_queue?.pending_count || 0}
          icon={<FlaskConical className="text-caution-subtle-fg" size={24} />}
          color="bg-caution-subtle"
          onClick={() => navigate('/lab-results')}
          loading={loading}
        />
        <StatCard
          label={t('docLabDashboard.completedToday')}
          value={data?.test_queue?.approved_count || 0}
          icon={<CheckCircle className="text-ok-subtle-fg" size={24} />}
          color="bg-ok-subtle"
          loading={loading}
        />
        <StatCard
          label={t('docLabDashboard.rejected')}
          value={data?.rejections?.length || 0}
          icon={<XCircle className="text-critical-subtle-fg" size={24} />}
          color="bg-critical-subtle"
          onClick={() => navigate('/specimen')}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* STAT Queue */}
        <div className="bg-surface rounded-lg shadow p-4 border border-critical">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-critical-subtle-fg mb-3">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" aria-hidden="true" /> {t('docLabDashboard.statQueue')}
          </h3>
          {statQueue.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-critical-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-critical-subtle-fg uppercase">{t('docLabDashboard.colTest')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-critical-subtle-fg uppercase">{t('docLabDashboard.colPatient')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-critical-subtle-fg uppercase">{t('docLabDashboard.colTime')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-critical-subtle-fg uppercase">{t('docLabDashboard.colPriority')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  {statQueue.map((item, idx) => (
                    <tr key={idx} className="hover:bg-critical-subtle">
                      <td className="px-3 py-2 font-medium text-content">{item.test_name}</td>
                      <td className="px-3 py-2 text-content-muted">{item.patient_name}</td>
                      <td className="px-3 py-2 text-content-muted">{item.time_in_lab}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 text-xs bg-critical text-critical-fg rounded">{item.priority}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-content-muted text-center py-4">{t('docLabDashboard.noStat')}</p>
          )}
        </div>

        {/* QC Status */}
        <div className="bg-surface rounded-lg shadow p-4 border border-border">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-content-secondary mb-3">
            <AlertTriangle size={16} aria-hidden="true" /> {t('docLabDashboard.qcStatus')}
          </h3>
          {data?.qc_records && data.qc_records.length > 0 ? (
            <div className="space-y-2">
              {data.qc_records.slice(0, 4).map((qc: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <p className="text-sm font-medium">{qc.analyzer_name || t('docLabDashboard.unknownAnalyzer')}</p>
                    <p className="text-xs text-content-muted">{t('docLabDashboard.lastQc', { time: qc.last_qc_time || t('docLabDashboard.pending') })}</p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${
                      qc.status === 'passed'
                        ? 'bg-ok-subtle text-ok-subtle-fg'
                        : qc.status === 'due'
                        ? 'bg-caution-subtle text-caution-subtle-fg'
                        : 'bg-critical-subtle text-critical-subtle-fg'
                    }`}
                  >
                    {qc.status === 'passed' ? (
                      <span className="inline-flex items-center gap-1"><CheckCircle size={12} aria-hidden="true" /> {t('docLabDashboard.qcPassed')}</span>
                    ) : qc.status === 'due' ? (
                      <span className="inline-flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> {t('docLabDashboard.qcDue')}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1"><XCircle size={12} aria-hidden="true" /> {t('docLabDashboard.qcFailed')}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-content-muted">{t('docLabDashboard.noQc')}</p>
          )}
          <button
            onClick={() => navigate('/lab/qc')}
            className="mt-3 w-full py-2 text-sm bg-notice-subtle text-notice-subtle-fg rounded hover:bg-notice-subtle"
          >
            {t('docLabDashboard.runQc')}
          </button>
        </div>
      </div>

      {/* Pending Specimens Queue Table */}
      <div className="bg-surface rounded-lg shadow p-4 border border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-content-secondary">
            <BarChart3 size={16} aria-hidden="true" /> {t('docLabDashboard.pendingSpecimens')}
          </h3>
          <button
            onClick={() => navigate('/lab-results')}
            className="text-xs text-notice-subtle-fg hover:text-notice-subtle-fg"
          >
            {t('docLabDashboard.viewAll')}
          </button>
        </div>
        {pendingQueue.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docLabDashboard.colAccession')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docLabDashboard.colPatient')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docLabDashboard.colTest')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docLabDashboard.colPriority')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-content-muted uppercase">{t('docLabDashboard.colTime')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pendingQueue.slice(0, 10).map((item, idx) => (
                  <tr key={idx} className="hover:bg-surface-sunken cursor-pointer">
                    <td className="px-3 py-2 font-mono text-content">{item.accession}</td>
                    <td className="px-3 py-2 text-content-muted">{item.patient_name}</td>
                    <td className="px-3 py-2 font-medium text-content">{item.test_name}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        item.priority === 'STAT' ? 'bg-critical-subtle text-critical-subtle-fg' :
                        item.priority === 'Urgent' ? 'bg-surface-sunken text-content-secondary' :
                        'bg-surface-sunken text-content-secondary'
                      }`}>
                        {item.priority}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-content-muted">{item.time_in_lab}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-content-muted text-center py-4">{t('docLabDashboard.noPending')}</p>
        )}
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <QuickActionsPanel actions={quickActions} />

        {/* Rejected Specimens */}
        <div className="bg-surface rounded-lg shadow p-4 border border-border">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-content-secondary mb-3">
            <XCircle size={16} aria-hidden="true" /> {t('docLabDashboard.rejectedSpecimens')}
          </h3>
          {data?.rejections && data.rejections.length > 0 ? (
            <div className="space-y-2">
              {data.rejections.map((rej: any, idx: number) => (
                <div key={idx} className="p-3 bg-critical-subtle border border-critical rounded">
                  <p className="text-sm font-medium text-critical-subtle-fg">
                    {rej.accession_number || t('docLabDashboard.unknown')} - {rej.rejection_reason || t('docLabDashboard.unknownReason')}
                  </p>
                  <p className="text-xs text-critical-subtle-fg mt-1">{t('docLabDashboard.patientLabel', { name: rej.patient_name || t('docLabDashboard.unknown') })}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleNotify(rej.id)}
                      disabled={notifyingId === rej.id || rej.notified_ordering_provider}
                      className="text-xs font-medium underline text-critical-subtle-fg disabled:no-underline disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {rej.notified_ordering_provider
                        ? t('docLabDashboard.notified')
                        : notifyingId === rej.id
                          ? t('docLabDashboard.notifying')
                          : t('docLabDashboard.notifyProvider')}
                    </button>
                    {/*
                      "Request Recollect" is deliberately absent rather than
                      disabled-and-unexplained. `recollection_required` and
                      `recollection_scheduled` exist on the entity and
                      `get_pending_recollections()` reads them, but nothing in
                      the repository defines what scheduling a recollection
                      means: when it is due, who performs it, whether the
                      patient is contacted, or what the safety consequence of
                      delay is. Those are clinical governance decisions, and
                      guessing them in a UI is how a nurse ends up acting on an
                      invented instruction. Tracked as SCR-009 in
                      docs/REMEDIATION_LEDGER_2026-08-22.md.
                    */}
                  </div>
                  {notifyResult[rej.id] && (
                    <p role="status" className="mt-1 text-xs text-critical-subtle-fg">
                      {notifyResult[rej.id]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-content-muted">{t('docLabDashboard.noRejections')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
