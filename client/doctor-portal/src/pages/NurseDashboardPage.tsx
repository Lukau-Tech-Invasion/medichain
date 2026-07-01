/**
 * Nurse Dashboard Page
 * 
 * Nurse-specific dashboard with medications due, patient care tasks, vitals, and shift handoff
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Activity,
  AlertTriangle,
  Droplets,
  Pill,
  ClipboardList,
  Thermometer,
  Clock,
  FileText,
} from 'lucide-react';
import { getNurseDashboard, useTranslation } from '@medichain/shared';
import {
  StatCard,
  CriticalAlertsBanner,
  QuickActionsPanel,
  PatientListPanel,
  type CriticalAlert,
  type QuickAction,
} from '../components/dashboard';
import type { PatientListItem } from '../components/dashboard/PatientListPanel';

interface NurseDashboardData {
  role: string;
  patients: { total: number; list: any[] };
  care_plans: any[];
  vitals_needing_attention: any[];
  medication_records: any[];
  io_records: any[];
  wound_assessments: any[];
  iv_assessments: any[];
  fall_risk_patients: any[];
  recent_incidents: any[];
  tasks: {
    vitals_due: number;
    meds_due: number;
    wounds_to_assess: number;
    ivs_to_check: number;
  };
}

export default function NurseDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<NurseDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const response = await getNurseDashboard();
      setData(response as NurseDashboardData);
    } catch (error) {
      console.error('Failed to load nurse dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const medicationsDue = data?.medication_records?.slice(0, 5).map((med: any) => ({
    id: med.record_id,
    patient_name: med.patient_name || t('docNurseDashboard.unknown'),
    medication: med.medication_name || med.medication,
    time_due: med.scheduled_time || t('docNurseDashboard.now'),
    route: med.route || 'PO',
    dose: med.dosage || med.dose,
  })) || [];

  const quickActions: QuickAction[] = [
    { id: 'mar', label: t('docNurseDashboard.qaOpenMar'), icon: Pill, href: '/mar', color: 'green' },
    { id: 'vitals', label: t('docNurseDashboard.qaRecordVitals'), icon: Activity, href: '/vitals', color: 'blue' },
    { id: 'io', label: t('docNurseDashboard.qaIoDoc'), icon: Droplets, href: '/intake-output', color: 'amber' },
    { id: 'care-plan', label: t('docNurseDashboard.qaUpdateCarePlan'), icon: ClipboardList, href: '/care-plan', color: 'purple' },
  ];

  const patients: PatientListItem[] = data?.patients?.list?.map((p: any) => ({
    patient_id: p.patient_id,
    full_name: p.full_name,
    room: p.room || t('docNurseDashboard.pending'),
    esi_level: p.esi_level,
    flags: {
      fall_risk: p.fall_risk,
      iv_site: p.iv_site,
      wound_care: p.wound_care_due,
    },
  })) || [];

  const criticalAlerts: CriticalAlert[] = data?.vitals_needing_attention?.map((v: any) => ({
    id: v.flowsheet_id || String(Math.random()),
    type: 'critical_value' as const,
    title: t('docNurseDashboard.abnormalVitals'),
    description: v.abnormal_values?.join(', ') || t('docNurseDashboard.checkVitals'),
    patient_name: v.patient_name,
    timestamp: new Date().toISOString(),
    severity: 'high' as const,
  })) || [];

  const tasksData = [
    { time: '08:00', task: t('docNurseDashboard.taskVitals', { count: data?.tasks?.vitals_due || 0 }), patient: t('docNurseDashboard.taskMultiplePatients') },
    { time: '08:30', task: t('docNurseDashboard.taskDressingChange'), patient: 'Room 403' },
    { time: '09:00', task: t('docNurseDashboard.taskBloodSugar', { count: data?.tasks?.vitals_due || 0 }), patient: t('docNurseDashboard.taskMultiplePatients') },
    { time: '09:00', task: t('docNurseDashboard.taskIvAssessment'), patient: 'ICU-2' },
  ];

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('docNurseDashboard.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('docNurseDashboard.subtitle')}</p>
      </div>

      {/* Critical Alerts */}
      <CriticalAlertsBanner
        alerts={criticalAlerts}
        onAcknowledge={(id) => console.log('Acknowledge', id)}
        onViewAll={() => navigate('/critical-alerts')}
      />

      {/* Medications Due Banner */}
      {medicationsDue.length > 0 && (
        <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <Pill className="text-green-600" size={24} />
              <h3 className="text-lg font-bold text-green-900">
                {t('docNurseDashboard.medsDueNow', { count: medicationsDue.length })}
              </h3>
            </div>
            <button
              onClick={() => navigate('/mar')}
              className="text-sm text-green-700 hover:text-green-900 font-medium"
            >
              {t('docNurseDashboard.openMar')}
            </button>
          </div>
          <div className="space-y-2">
            {medicationsDue.map((med: any) => (
              <div
                key={med.id}
                className="flex items-center justify-between p-3 bg-white rounded border border-green-200"
              >
                <div className="flex-1">
                  <p className="font-medium text-gray-900">
                    {med.patient_name} - {med.medication} {med.dose}
                  </p>
                  <p className="text-sm text-gray-500">
                    {med.route} - {t('docNurseDashboard.due')}: {med.time_due}
                  </p>
                </div>
                <button className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                  {t('docNurseDashboard.administer')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stat Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('docNurseDashboard.statMyPatients')}
          value={data?.patients?.total || 0}
          icon={<Users className="text-green-600" size={24} />}
          color="bg-green-100"
          onClick={() => navigate('/patients')}
          loading={loading}
        />
        <StatCard
          label={t('docNurseDashboard.statVitalsDue')}
          value={data?.tasks?.vitals_due || 0}
          icon={<Activity className="text-amber-600" size={24} />}
          color="bg-amber-100"
          onClick={() => navigate('/vitals')}
          loading={loading}
        />
        <StatCard
          label={t('docNurseDashboard.statFallRisk')}
          value={data?.fall_risk_patients?.length || 0}
          icon={<AlertTriangle className="text-red-600" size={24} />}
          color="bg-red-100"
          loading={loading}
        />
        <StatCard
          label={t('docNurseDashboard.statIvChecks')}
          value={data?.tasks?.ivs_to_check || 0}
          icon={<Droplets className="text-blue-600" size={24} />}
          color="bg-blue-100"
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Patients */}
        <PatientListPanel
          patients={patients}
          title={t('docNurseDashboard.statMyPatients')}
          loading={loading}
        />

        {/* Tasks Due Timeline */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
            <ClipboardList size={16} aria-hidden="true" /> {t('docNurseDashboard.tasksDue')}
          </h3>
          <div className="space-y-2">
            {tasksData.map((task, idx) => (
              <div key={idx} className="flex items-center gap-3 p-2 border rounded hover:bg-gray-50">
                <span className="text-sm font-medium text-gray-500 w-12">{task.time}</span>
                <span className="flex-1 text-sm text-gray-900">{task.task}</span>
                <span className="text-sm text-gray-500">{task.patient}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <QuickActionsPanel actions={quickActions} />

        {/* I/O Summary */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
            <FileText size={16} aria-hidden="true" /> {t('docNurseDashboard.ioSummaryToday')}
          </h3>
          {data?.io_records && data.io_records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2">{t('docNurseDashboard.colPatient')}</th>
                    <th className="pb-2">{t('docNurseDashboard.colIntake')}</th>
                    <th className="pb-2">{t('docNurseDashboard.colOutput')}</th>
                    <th className="pb-2">{t('docNurseDashboard.colBalance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.io_records.slice(0, 5).map((io: any, idx: number) => (
                    <tr key={idx} className="border-b">
                      <td className="py-2">{io.patient_name || t('docNurseDashboard.unknown')}</td>
                      <td className="py-2">{io.total_intake || 0} mL</td>
                      <td className="py-2">{io.total_output || 0} mL</td>
                      <td className="py-2">
                        {((io.total_intake || 0) - (io.total_output || 0)) > 0 ? '+' : ''}
                        {(io.total_intake || 0) - (io.total_output || 0)} mL
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('docNurseDashboard.noIoRecords')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
