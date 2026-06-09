/**
 * Pharmacist Dashboard Page
 * 
 * Pharmacist-specific dashboard with drug interactions, prescription queue,
 * allergy alerts, controlled substances, and IV admixtures
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pill,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Clock,
  ShieldAlert,
  FileCheck,
  Beaker,
  BarChart3,
} from 'lucide-react';
import { getPharmacistDashboard } from '@medichain/shared';
import {
  StatCard,
  CriticalAlertsBanner,
  QuickActionsPanel,
  type CriticalAlert,
  type QuickAction,
} from '../components/dashboard';

interface Prescription {
  prescription_id: string;
  patient_id: string;
  patient_name?: string;
  medication_name: string;
  dosage: string;
  frequency?: string;
  priority?: 'STAT' | 'Urgent' | 'Routine';
  status: string;
  prescribed_by?: string;
  created_at?: string;
}

interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: 'Major' | 'Moderate' | 'Minor';
  description: string;
  patient_name?: string;
  patient_id?: string;
}

interface AllergyAlert {
  id: string;
  patient_id: string;
  patient_name?: string;
  allergen: string;
  medication_ordered: string;
  severity: string;
}

interface PharmacistDashboardData {
  role: string;
  prescriptions: {
    pending_fill: number;
    in_progress: number;
    completed_today: number;
    list: Prescription[];
  };
  drug_interactions: DrugInteraction[];
  allergy_alerts: AllergyAlert[];
  alerts: {
    pending_rx_count: number;
    interactions_count: number;
    allergy_alerts_count: number;
  };
}

export default function PharmacistDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<PharmacistDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const response = await getPharmacistDashboard();
      setData(response as PharmacistDashboardData);
    } catch (error) {
      console.error('Failed to load pharmacist dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  // Map drug interaction alerts for the critical banner
  const criticalAlerts: CriticalAlert[] = [
    // Drug interactions (major = critical)
    ...(data?.drug_interactions?.filter(d => d.severity === 'Major').map((d): CriticalAlert => ({
      id: d.id,
      type: 'drug_interaction',
      title: `Drug Interaction: ${d.drug1} + ${d.drug2}`,
      description: d.description,
      patient_name: d.patient_name || 'Unknown',
      timestamp: new Date().toISOString(),
      severity: 'critical',
    })) || []),
    // Allergy alerts
    ...(data?.allergy_alerts?.map((a): CriticalAlert => ({
      id: a.id,
      type: 'allergy',
      title: `Allergy Alert: ${a.allergen}`,
      description: `Ordered medication: ${a.medication_ordered}`,
      patient_name: a.patient_name || 'Unknown',
      timestamp: new Date().toISOString(),
      severity: 'high',
    })) || []),
  ];

  // Quick actions for pharmacists
  const quickActions: QuickAction[] = [
    { id: 'verify', label: 'Verify Prescription', icon: FileCheck, href: '/e-prescribe', color: 'green' },
    { id: 'interactions', label: 'Check Interactions', icon: ShieldAlert, href: '/drug-interactions', color: 'emergency' },
    { id: 'dispense', label: 'Dispense Medication', icon: Pill, href: '/medication-admin', color: 'blue' },
    { id: 'iv-prep', label: 'IV Admixture', icon: Beaker, href: '/orders', color: 'purple' },
  ];

  // Prepare prescription queue table data
  const prescriptionQueue = data?.prescriptions?.list?.slice(0, 10).map((rx) => [
    rx.priority || 'Routine',
    rx.patient_name || rx.patient_id,
    rx.medication_name,
    rx.dosage,
    rx.status,
  ]) || [];

  // Drug interactions table (moderate + major)
  const interactionsTable = data?.drug_interactions?.map((d) => [
    d.severity,
    d.patient_name || 'Unknown',
    `${d.drug1} + ${d.drug2}`,
    d.description.slice(0, 50) + (d.description.length > 50 ? '...' : ''),
  ]) || [];

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pharmacy Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Prescription Verification & Drug Safety</p>
      </div>

      {/* Critical Alerts: Drug Interactions & Allergy Alerts */}
      <CriticalAlertsBanner
        alerts={criticalAlerts}
        onAcknowledge={(id) => console.log('Acknowledge interaction:', id)}
        onViewAll={() => navigate('/drug-interactions')}
      />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Pending Rx"
          value={data?.prescriptions?.pending_fill || 0}
          icon={<Pill className="text-amber-600" size={24} />}
          color="bg-amber-100"
          onClick={() => navigate('/e-prescribe')}
          loading={loading}
        />
        <StatCard
          label="STAT Orders"
          value={data?.prescriptions?.list?.filter(rx => rx.priority === 'STAT').length || 0}
          icon={<AlertTriangle className="text-red-600" size={24} />}
          color="bg-red-100"
          onClick={() => navigate('/e-prescribe?priority=STAT')}
          loading={loading}
        />
        <StatCard
          label="Verified Today"
          value={data?.prescriptions?.completed_today || 0}
          icon={<CheckCircle className="text-green-600" size={24} />}
          color="bg-green-100"
          loading={loading}
        />
        <StatCard
          label="Interactions"
          value={data?.drug_interactions?.length || 0}
          icon={<ShieldAlert className="text-red-600" size={24} />}
          color="bg-red-100"
          onClick={() => navigate('/drug-interactions')}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Prescription Verification Queue */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <FileCheck size={16} aria-hidden="true" /> Orders to Verify
            </h3>
            <button
              onClick={() => navigate('/e-prescribe')}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              View All
            </button>
          </div>
          {prescriptionQueue.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Medication</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Dose</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {prescriptionQueue.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/e-prescribe')}>
                      <td className="px-3 py-2 text-gray-900">{row[0]}</td>
                      <td className="px-3 py-2 text-gray-600">{row[1]}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{row[2]}</td>
                      <td className="px-3 py-2 text-gray-600">{row[3]}</td>
                      <td className="px-3 py-2 text-gray-600">{row[4]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No pending prescriptions</p>
          )}
        </div>

        {/* Drug Interactions Panel */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <ShieldAlert className="text-red-500" size={18} />
              Drug Interaction Alerts
            </h3>
            <button
              onClick={() => navigate('/drug-interactions')}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              View All
            </button>
          </div>
          {data?.drug_interactions && data.drug_interactions.length > 0 ? (
            <div className="space-y-2">
              {data.drug_interactions.slice(0, 5).map((interaction) => (
                <div
                  key={interaction.id}
                  className={`p-3 rounded border ${
                    interaction.severity === 'Major'
                      ? 'bg-red-50 border-red-200'
                      : interaction.severity === 'Moderate'
                      ? 'bg-orange-50 border-orange-200'
                      : 'bg-yellow-50 border-yellow-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                          interaction.severity === 'Major'
                            ? 'bg-red-600 text-white'
                            : interaction.severity === 'Moderate'
                            ? 'bg-orange-600 text-white'
                            : 'bg-yellow-600 text-white'
                        }`}
                      >
                        {interaction.severity.toUpperCase()}
                      </span>
                      <p className="mt-1 font-medium text-gray-900">
                        {interaction.drug1} + {interaction.drug2}
                      </p>
                      <p className="text-sm text-gray-600">{interaction.description}</p>
                    </div>
                  </div>
                  {interaction.patient_name && (
                    <p className="mt-2 text-xs text-gray-500">
                      Patient: {interaction.patient_name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No drug interaction alerts</p>
          )}
        </div>
      </div>

      {/* Second Row: Allergy Alerts & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Allergy Alerts Panel */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <AlertCircle className="text-orange-500" size={18} />
              Allergy Alerts
            </h3>
          </div>
          {data?.allergy_alerts && data.allergy_alerts.length > 0 ? (
            <div className="space-y-2">
              {data.allergy_alerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className="p-3 bg-orange-50 border border-orange-200 rounded"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{alert.patient_name}</p>
                      <p className="flex items-center gap-1.5 text-sm text-orange-700">
                        <AlertTriangle size={14} aria-hidden="true" /> Allergic to: <strong>{alert.allergen}</strong>
                      </p>
                      <p className="text-sm text-gray-600">
                        Ordered: {alert.medication_ordered}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">
                        Reject
                      </button>
                      <button className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                        Contact MD
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No allergy alerts</p>
          )}
        </div>

        {/* Quick Actions */}
        <QuickActionsPanel actions={quickActions} title="Quick Actions" />
      </div>

      {/* Controlled Substance Log Section */}
      <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Clock className="text-purple-500" size={18} />
            Controlled Substance Log (Schedule II-V)
          </h3>
          <button className="text-xs text-blue-600 hover:text-blue-800">
            DEA Compliance Report
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Medication</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Prescriber</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {/* Show controlled substances from prescriptions or mock data */}
              {data?.prescriptions?.list?.filter(rx => 
                rx.medication_name.toLowerCase().includes('morphine') ||
                rx.medication_name.toLowerCase().includes('oxycodone') ||
                rx.medication_name.toLowerCase().includes('lorazepam') ||
                rx.medication_name.toLowerCase().includes('alprazolam')
              ).slice(0, 5).map((rx, idx) => (
                <tr key={rx.prescription_id || idx} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-900">
                    {rx.created_at ? new Date(rx.created_at).toLocaleTimeString() : '--:--'}
                  </td>
                  <td className="px-4 py-2 font-medium text-gray-900">{rx.medication_name}</td>
                  <td className="px-4 py-2 text-gray-600">{rx.patient_name || rx.patient_id}</td>
                  <td className="px-4 py-2 text-gray-600">{rx.dosage}</td>
                  <td className="px-4 py-2 text-gray-600">{rx.prescribed_by || 'Unknown'}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      rx.status === 'Filled' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {rx.status === 'Filled' ? (
                        <span className="inline-flex items-center gap-1"><CheckCircle size={12} aria-hidden="true" /> Logged</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden="true" /> Pending</span>
                      )}
                    </span>
                  </td>
                </tr>
              )) || (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-gray-500">
                    No controlled substances in queue
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Today's Metrics */}
      <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
          <BarChart3 size={16} aria-hidden="true" /> Today's Metrics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded">
            <p className="text-2xl font-bold text-gray-900">
              {data?.prescriptions?.completed_today || 0}
            </p>
            <p className="text-xs text-gray-500">Orders Verified</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <p className="text-2xl font-bold text-red-600">
              {data?.drug_interactions?.length || 0}
            </p>
            <p className="text-xs text-gray-500">Interactions Caught</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <p className="text-2xl font-bold text-orange-600">
              {data?.allergy_alerts?.length || 0}
            </p>
            <p className="text-xs text-gray-500">Allergy Alerts</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <p className="text-2xl font-bold text-purple-600">
              {data?.prescriptions?.list?.filter(rx => 
                rx.medication_name.toLowerCase().includes('morphine') ||
                rx.medication_name.toLowerCase().includes('oxycodone')
              ).length || 0}
            </p>
            <p className="text-xs text-gray-500">Controlled Dispensed</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <p className="text-2xl font-bold text-blue-600">
              {data?.prescriptions?.in_progress || 0}
            </p>
            <p className="text-xs text-gray-500">In Progress</p>
          </div>
        </div>
      </div>
    </div>
  );
}
