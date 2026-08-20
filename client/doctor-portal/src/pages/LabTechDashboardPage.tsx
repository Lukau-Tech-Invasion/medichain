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
import { getLabDashboard, useTranslation } from '@medichain/shared';
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
                        <span className="px-2 py-0.5 text-xs bg-red-600 text-white rounded">{item.priority}</span>
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
                        item.priority === 'Urgent' ? 'bg-orange-100 text-orange-700' :
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
                  <button className="mt-2 text-xs text-critical-subtle-fg hover:text-critical-subtle-fg font-medium">
                    {t('docLabDashboard.notifyRecollect')}
                  </button>
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
