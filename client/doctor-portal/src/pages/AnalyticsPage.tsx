import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { apiUrl } from '@medichain/shared';
import { BarChart3, TrendingUp, Users, Activity, Clock, AlertCircle, CheckCircle, XCircle, Calendar, Loader2 } from 'lucide-react';

type MetricPeriod = 'today' | 'week' | 'month' | 'year';
type DepartmentType = 'emergency' | 'surgery' | 'medicine' | 'pediatrics' | 'radiology' | 'laboratory';

interface MetricCard {
  title: string;
  value: string | number;
  change: string;
  trend: 'up' | 'down' | 'stable';
  icon: React.ReactNode;
  color: string;
}

interface DepartmentMetrics {
  department: DepartmentType;
  patients: number;
  avgWaitTime: number;
  bedOccupancy: number;
  staffOnDuty: number;
}

interface PatientFlowData {
  hour: string;
  admissions: number;
  discharges: number;
  transfers: number;
}

/**
 * AnalyticsPage
 * 
 * Page for hospital operations analytics and dashboards.
 */
const AnalyticsPage: React.FC = () => {
  const { user } = useAuthStore();
  const [selectedPeriod, setSelectedPeriod] = useState<MetricPeriod>('today');
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [departmentData, setDepartmentData] = useState<DepartmentMetrics[]>([]);
  const [patientFlow, setPatientFlow] = useState<PatientFlowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to calculate date range from period
  const getDateRange = (period: MetricPeriod): { startDate: string; endDate: string } => {
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    let startDate: string;
    
    switch (period) {
      case 'today':
        startDate = endDate;
        break;
      case 'week': {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.toISOString().split('T')[0];
        break;
      }
      case 'month': {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        startDate = monthAgo.toISOString().split('T')[0];
        break;
      }
      case 'year': {
        const yearAgo = new Date(now);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        startDate = yearAgo.toISOString().split('T')[0];
        break;
      }
      default:
        startDate = endDate;
    }
    
    return { startDate, endDate };
  };

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!user?.walletAddress) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Calculate date range from selected period
        const { startDate, endDate } = getDateRange(selectedPeriod);
        
        // Fetch dashboard metrics from API with proper date parameters
        const response = await fetch(apiUrl(`/api/analytics/dashboard?start_date=${startDate}&end_date=${endDate}`), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch analytics: ${response.status}`);
        }

        const data = await response.json();

        // Map API response to metrics cards
        const patientMetrics = data.patient_metrics || {};
        const appointmentMetrics = data.appointment_metrics || {};
        const financialMetrics = data.financial_metrics || {};
        const cdsMetrics = data.cds_metrics || {};

        setMetrics([
          {
            title: 'Total Patients',
            value: patientMetrics.total_patients || 0,
            change: patientMetrics.new_patients ? `+${patientMetrics.new_patients}` : '0',
            trend: (patientMetrics.new_patients || 0) > 0 ? 'up' : 'stable',
            icon: <Users className="w-6 h-6" />,
            color: 'blue',
          },
          {
            title: 'Appointments',
            value: appointmentMetrics.total_appointments || 0,
            change: appointmentMetrics.completed_appointments ? `${appointmentMetrics.completed_appointments} completed` : '0',
            trend: 'stable',
            icon: <Clock className="w-6 h-6" />,
            color: 'green',
          },
          {
            title: 'Telehealth %',
            value: `${(appointmentMetrics.telehealth_percentage || 0).toFixed(1)}%`,
            change: 'of appointments',
            trend: 'stable',
            icon: <Activity className="w-6 h-6" />,
            color: 'purple',
          },
          {
            title: 'CDS Alerts',
            value: cdsMetrics.total_alerts || 0,
            change: cdsMetrics.alerts_accepted ? `${cdsMetrics.alerts_accepted} accepted` : '0',
            trend: (cdsMetrics.total_alerts || 0) > 10 ? 'up' : 'down',
            icon: <AlertCircle className="w-6 h-6" />,
            color: 'red',
          },
        ]);

        // Map department data from API response
        const deptData = data.department_metrics || [];
        if (deptData.length > 0) {
          setDepartmentData(deptData.map((d: { department: string; patients: number; avg_wait_time: number; bed_occupancy: number; staff_on_duty: number }) => ({
            department: d.department as DepartmentType,
            patients: d.patients || 0,
            avgWaitTime: d.avg_wait_time || 0,
            bedOccupancy: d.bed_occupancy || 0,
            staffOnDuty: d.staff_on_duty || 0
          })));
        } else {
          setDepartmentData([]);
        }

        // Map patient flow data from API response
        const flowData = data.patient_flow || [];
        if (flowData.length > 0) {
          setPatientFlow(flowData.map((f: { hour: string; admissions: number; discharges: number; transfers: number }) => ({
            hour: f.hour,
            admissions: f.admissions || 0,
            discharges: f.discharges || 0,
            transfers: f.transfers || 0
          })));
        } else {
          setPatientFlow([]);
        }

      } catch (err) {
        console.error('Error fetching analytics:', err);
        setError(err instanceof Error ? err.message : 'Failed to load analytics');
        setMetrics([]);
        setDepartmentData([]);
        setPatientFlow([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [user, selectedPeriod]);

  const getColorClasses = (color: string) => {
    switch (color) {
      case 'blue':
        return { bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-200' };
      case 'green':
        return { bg: 'bg-green-100', text: 'text-green-600', border: 'border-green-200' };
      case 'purple':
        return { bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-200' };
      case 'red':
        return { bg: 'bg-red-100', text: 'text-red-600', border: 'border-red-200' };
      default:
        return { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' };
    }
  };

  const getDepartmentName = (dept: DepartmentType) => {
    switch (dept) {
      case 'emergency':
        return 'Emergency Department';
      case 'surgery':
        return 'Surgery';
      case 'medicine':
        return 'Internal Medicine';
      case 'pediatrics':
        return 'Pediatrics';
      case 'radiology':
        return 'Radiology';
      case 'laboratory':
        return 'Laboratory';
      default:
        return dept;
    }
  };

  const getDepartmentColor = (dept: DepartmentType) => {
    switch (dept) {
      case 'emergency':
        return 'red';
      case 'surgery':
        return 'purple';
      case 'medicine':
        return 'blue';
      case 'pediatrics':
        return 'pink';
      case 'radiology':
        return 'indigo';
      case 'laboratory':
        return 'teal';
      default:
        return 'gray';
    }
  };

  const getOccupancyStatus = (occupancy: number) => {
    if (occupancy >= 90) return { color: 'red', label: 'Critical' };
    if (occupancy >= 75) return { color: 'orange', label: 'High' };
    if (occupancy >= 50) return { color: 'green', label: 'Optimal' };
    return { color: 'blue', label: 'Low' };
  };

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          <span className="ml-2 text-gray-600">Loading analytics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <p className="font-medium">Error loading analytics</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-10 h-10" />
          <div>
            <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
            <p className="text-purple-50 mt-1">Hospital operations metrics and performance indicators</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setSelectedPeriod('today')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selectedPeriod === 'today'
              ? 'bg-purple-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setSelectedPeriod('week')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selectedPeriod === 'week'
              ? 'bg-purple-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          This Week
        </button>
        <button
          onClick={() => setSelectedPeriod('month')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selectedPeriod === 'month'
              ? 'bg-purple-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          This Month
        </button>
        <button
          onClick={() => setSelectedPeriod('year')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selectedPeriod === 'year'
              ? 'bg-purple-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          This Year
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        {metrics.map((metric, idx) => {
          const colors = getColorClasses(metric.color);
          return (
            <div key={idx} className={`bg-white rounded-lg shadow p-6 border ${colors.border}`}>
              <div className="flex items-center justify-between mb-4">
                <div className={`${colors.bg} ${colors.text} p-3 rounded-lg`}>
                  {metric.icon}
                </div>
                <div className={`flex items-center gap-1 ${metric.trend === 'up' ? 'text-green-600' : metric.trend === 'down' ? 'text-red-600' : 'text-gray-600'}`}>
                  {metric.trend === 'up' ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : metric.trend === 'down' ? (
                    <TrendingUp className="w-4 h-4 rotate-180" />
                  ) : (
                    <Activity className="w-4 h-4" />
                  )}
                  <span className="text-sm font-medium">{metric.change}</span>
                </div>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">{metric.value}</div>
              <div className="text-sm text-gray-600">{metric.title}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Users className="w-6 h-6 text-purple-600" />
            Department Performance
          </h2>
          <div className="space-y-4">
            {departmentData.map((dept) => {
              const color = getDepartmentColor(dept.department);
              const colors = getColorClasses(color);
              const occupancyStatus = getOccupancyStatus(dept.bedOccupancy);
              
              return (
                <div key={dept.department} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`${colors.bg} ${colors.text} p-2 rounded`}>
                        <Activity className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-gray-900">{getDepartmentName(dept.department)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-600">{dept.staffOnDuty} staff</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-blue-50 rounded p-2">
                      <div className="text-blue-700 font-medium">Patients</div>
                      <div className="text-blue-900 text-lg font-bold">{dept.patients}</div>
                    </div>
                    <div className="bg-green-50 rounded p-2">
                      <div className="text-green-700 font-medium">Wait Time</div>
                      <div className="text-green-900 text-lg font-bold">{dept.avgWaitTime} min</div>
                    </div>
                    {dept.bedOccupancy > 0 ? (
                      <div className={`bg-${occupancyStatus.color}-50 rounded p-2`}>
                        <div className={`text-${occupancyStatus.color}-700 font-medium`}>Occupancy</div>
                        <div className={`text-${occupancyStatus.color}-900 text-lg font-bold flex items-center gap-1`}>
                          {dept.bedOccupancy}%
                          <span className="text-xs font-normal">({occupancyStatus.label})</span>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded p-2">
                        <div className="text-gray-700 font-medium">N/A</div>
                        <div className="text-gray-900 text-lg font-bold">—</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-purple-600" />
            Patient Flow (24h)
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-4 pb-2 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="text-sm text-gray-700">Admissions</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-sm text-gray-700">Discharges</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                <span className="text-sm text-gray-700">Transfers</span>
              </div>
            </div>
            
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {patientFlow.map((data) => {
                const maxValue = Math.max(
                  ...patientFlow.map(d => Math.max(d.admissions, d.discharges, d.transfers))
                );
                
                return (
                  <div key={data.hour} className="space-y-1">
                    <div className="text-xs font-medium text-gray-600">{data.hour}</div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="bg-gray-100 rounded-full overflow-hidden h-2">
                          <div
                            className="bg-blue-500 h-full rounded-full"
                            style={{ width: `${(data.admissions / maxValue) * 100}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{data.admissions}</div>
                      </div>
                      <div className="flex-1">
                        <div className="bg-gray-100 rounded-full overflow-hidden h-2">
                          <div
                            className="bg-green-500 h-full rounded-full"
                            style={{ width: `${(data.discharges / maxValue) * 100}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{data.discharges}</div>
                      </div>
                      <div className="flex-1">
                        <div className="bg-gray-100 rounded-full overflow-hidden h-2">
                          <div
                            className="bg-orange-500 h-full rounded-full"
                            style={{ width: `${(data.transfers / maxValue) * 100}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{data.transfers}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            Top Performing Metrics
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <span className="text-sm text-gray-700">Patient Satisfaction</span>
              <span className="text-lg font-bold text-green-700">94%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <span className="text-sm text-gray-700">Discharge Efficiency</span>
              <span className="text-lg font-bold text-green-700">89%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <span className="text-sm text-gray-700">Staff Utilization</span>
              <span className="text-lg font-bold text-green-700">87%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <span className="text-sm text-gray-700">Medication Safety</span>
              <span className="text-lg font-bold text-green-700">98%</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-600" />
            Areas Needing Attention
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
              <span className="text-sm text-gray-700">ED Wait Times</span>
              <span className="text-lg font-bold text-orange-700">32 min</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
              <span className="text-sm text-gray-700">Lab Turnaround</span>
              <span className="text-lg font-bold text-orange-700">45 min</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
              <span className="text-sm text-gray-700">Bed Availability</span>
              <span className="text-lg font-bold text-orange-700">13%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
              <span className="text-sm text-gray-700">Radiology Queue</span>
              <span className="text-lg font-bold text-orange-700">18 cases</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-600" />
            Critical Issues
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
              <span className="text-sm text-gray-700">ED Overcapacity</span>
              <span className="text-lg font-bold text-red-700">112%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
              <span className="text-sm text-gray-700">Ventilator Shortage</span>
              <span className="text-lg font-bold text-red-700">2 left</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
              <span className="text-sm text-gray-700">Staff Shortage</span>
              <span className="text-lg font-bold text-red-700">-5</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
              <span className="text-sm text-gray-700">Critical Meds Low</span>
              <span className="text-lg font-bold text-red-700">3 items</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Calendar className="w-6 h-6 text-purple-600" />
          Recent Activity Summary
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Event</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Department</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Impact</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <tr>
                <td className="px-4 py-3 text-sm text-gray-900">14:32</td>
                <td className="px-4 py-3 text-sm text-gray-900">Mass casualty incident alert</td>
                <td className="px-4 py-3 text-sm text-gray-600">Emergency</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">High</span>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800">Active</span>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm text-gray-900">13:15</td>
                <td className="px-4 py-3 text-sm text-gray-900">Bed capacity threshold exceeded</td>
                <td className="px-4 py-3 text-sm text-gray-600">Medicine</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800">Medium</span>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Resolved</span>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm text-gray-900">11:45</td>
                <td className="px-4 py-3 text-sm text-gray-900">Equipment maintenance completed</td>
                <td className="px-4 py-3 text-sm text-gray-600">Radiology</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">Low</span>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Complete</span>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm text-gray-900">10:20</td>
                <td className="px-4 py-3 text-sm text-gray-900">Staff shift change</td>
                <td className="px-4 py-3 text-sm text-gray-600">All</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">Low</span>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Complete</span>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm text-gray-900">09:30</td>
                <td className="px-4 py-3 text-sm text-gray-900">Critical medication restock</td>
                <td className="px-4 py-3 text-sm text-gray-600">Pharmacy</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">High</span>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Complete</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPage;
