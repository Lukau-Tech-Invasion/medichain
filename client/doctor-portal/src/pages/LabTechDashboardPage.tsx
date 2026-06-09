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
import { getLabDashboard } from '@medichain/shared';
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
    description: 'Critical value - notify provider immediately',
    patient_name: c.patient_name,
    timestamp: new Date().toISOString(),
    severity: 'critical' as const,
  })) || [];

  const quickActions: QuickAction[] = [
    { id: 'log-specimen', label: 'Log Specimen', icon: FlaskConical, href: '/specimen', color: 'blue' },
    { id: 'run-qc', label: 'Run QC', icon: CheckCircle, href: '/lab-qc', color: 'green' },
    { id: 'result-entry', label: 'Enter Results', icon: Activity, href: '/lab-results', color: 'amber' },
    { id: 'call-critical', label: 'Call Critical Value', icon: AlertTriangle, href: '/critical-value', color: 'emergency' },
  ];

  const statQueue = data?.test_queue?.pending?.filter((t: any) => t.priority === 'STAT').map((t: any) => ({
    test_name: t.test_name || 'Unknown Test',
    patient_name: t.patient_name || 'Unknown',
    time_in_lab: t.time_in_lab || 'Just arrived',
    priority: t.priority || 'STAT',
  })) || [];

  const pendingQueue = data?.test_queue?.pending?.map((t: any) => ({
    accession: t.accession_number || t.id,
    patient_name: t.patient_name || 'Unknown',
    test_name: t.test_name || 'Unknown Test',
    priority: t.priority || 'Routine',
    time_in_lab: t.time_in_lab || 'Pending',
  })) || [];

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Laboratory Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Test Queue & QC Status</p>
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
          label="STAT Specimens"
          value={data?.test_queue?.pending?.filter((t: any) => t.priority === 'STAT').length || 0}
          icon={<AlertTriangle className="text-red-600" size={24} />}
          color="bg-red-100"
          onClick={() => navigate('/specimen')}
          loading={loading}
        />
        <StatCard
          label="Pending Queue"
          value={data?.test_queue?.pending_count || 0}
          icon={<FlaskConical className="text-amber-600" size={24} />}
          color="bg-amber-100"
          onClick={() => navigate('/lab-results')}
          loading={loading}
        />
        <StatCard
          label="Completed Today"
          value={data?.test_queue?.approved_count || 0}
          icon={<CheckCircle className="text-green-600" size={24} />}
          color="bg-green-100"
          loading={loading}
        />
        <StatCard
          label="Rejected"
          value={data?.rejections?.length || 0}
          icon={<XCircle className="text-red-600" size={24} />}
          color="bg-red-100"
          onClick={() => navigate('/specimen')}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* STAT Queue */}
        <div className="bg-white rounded-lg shadow p-4 border border-red-200">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-red-700 mb-3">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" aria-hidden="true" /> STAT Queue
          </h3>
          {statQueue.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-red-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-red-600 uppercase">Test</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-red-600 uppercase">Patient</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-red-600 uppercase">Time</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-red-600 uppercase">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  {statQueue.map((item, idx) => (
                    <tr key={idx} className="hover:bg-red-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{item.test_name}</td>
                      <td className="px-3 py-2 text-gray-600">{item.patient_name}</td>
                      <td className="px-3 py-2 text-gray-600">{item.time_in_lab}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 text-xs bg-red-600 text-white rounded">{item.priority}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No STAT specimens</p>
          )}
        </div>

        {/* QC Status */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
            <AlertTriangle size={16} aria-hidden="true" /> QC Status
          </h3>
          {data?.qc_records && data.qc_records.length > 0 ? (
            <div className="space-y-2">
              {data.qc_records.slice(0, 4).map((qc: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <p className="text-sm font-medium">{qc.analyzer_name || 'Unknown Analyzer'}</p>
                    <p className="text-xs text-gray-500">Last QC: {qc.last_qc_time || 'Pending'}</p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${
                      qc.status === 'passed'
                        ? 'bg-green-100 text-green-700'
                        : qc.status === 'due'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {qc.status === 'passed' ? (
                      <span className="inline-flex items-center gap-1"><CheckCircle size={12} aria-hidden="true" /> PASSED</span>
                    ) : qc.status === 'due' ? (
                      <span className="inline-flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> DUE NOW</span>
                    ) : (
                      <span className="inline-flex items-center gap-1"><XCircle size={12} aria-hidden="true" /> FAILED</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No QC records</p>
          )}
          <button
            onClick={() => navigate('/lab/qc')}
            className="mt-3 w-full py-2 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            Run QC
          </button>
        </div>
      </div>

      {/* Pending Specimens Queue Table */}
      <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <BarChart3 size={16} aria-hidden="true" /> Pending Specimens Queue
          </h3>
          <button
            onClick={() => navigate('/lab-results')}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            View All
          </button>
        </div>
        {pendingQueue.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Accession</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Test</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pendingQueue.slice(0, 10).map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-3 py-2 font-mono text-gray-900">{item.accession}</td>
                    <td className="px-3 py-2 text-gray-600">{item.patient_name}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{item.test_name}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        item.priority === 'STAT' ? 'bg-red-100 text-red-700' :
                        item.priority === 'Urgent' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {item.priority}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{item.time_in_lab}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-4">No pending specimens</p>
        )}
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <QuickActionsPanel actions={quickActions} />

        {/* Rejected Specimens */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
            <XCircle size={16} aria-hidden="true" /> Rejected Specimens
          </h3>
          {data?.rejections && data.rejections.length > 0 ? (
            <div className="space-y-2">
              {data.rejections.map((rej: any, idx: number) => (
                <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded">
                  <p className="text-sm font-medium text-red-900">
                    {rej.accession_number || 'Unknown'} - {rej.rejection_reason || 'Unknown reason'}
                  </p>
                  <p className="text-xs text-red-600 mt-1">Patient: {rej.patient_name || 'Unknown'}</p>
                  <button className="mt-2 text-xs text-red-700 hover:text-red-900 font-medium">
                    [Notify] [Request Recollect]
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No rejections today</p>
          )}
        </div>
      </div>
    </div>
  );
}
