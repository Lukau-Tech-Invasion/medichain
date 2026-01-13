import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { BarChart3, TrendingUp, Users, Activity, Clock, AlertCircle, CheckCircle, XCircle, Calendar } from 'lucide-react';

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
  const { user: _user } = useAuthStore();
  const [selectedPeriod, setSelectedPeriod] = useState<MetricPeriod>('today');
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [departmentData, setDepartmentData] = useState<DepartmentMetrics[]>([]);
  const [patientFlow, setPatientFlow] = useState<PatientFlowData[]>([]);

  useEffect(() => {
    // Sample metrics data
    setMetrics([
      {
        title: 'Total Patients',
        value: selectedPeriod === 'today' ? 156 : selectedPeriod === 'week' ? 1234 : selectedPeriod === 'month' ? 5678 : 68450,
        change: '+12%',
        trend: 'up',
        icon: <Users className="w-6 h-6" />,
        color: 'blue',
      },
      {
        title: 'Avg Wait Time',
        value: selectedPeriod === 'today' ? '23 min' : selectedPeriod === 'week' ? '28 min' : selectedPeriod === 'month' ? '25 min' : '27 min',
        change: '-8%',
        trend: 'down',
        icon: <Clock className="w-6 h-6" />,
        color: 'green',
      },
      {
        title: 'Bed Occupancy',
        value: '87%',
        change: '+3%',
        trend: 'up',
        icon: <Activity className="w-6 h-6" />,
        color: 'purple',
      },
      {
        title: 'Critical Alerts',
        value: selectedPeriod === 'today' ? 8 : selectedPeriod === 'week' ? 47 : selectedPeriod === 'month' ? 203 : 2456,
        change: '-15%',
        trend: 'down',
        icon: <AlertCircle className="w-6 h-6" />,
        color: 'red',
      },
    ]);

    // Sample department data
    setDepartmentData([
      { department: 'emergency', patients: 45, avgWaitTime: 32, bedOccupancy: 92, staffOnDuty: 12 },
      { department: 'surgery', patients: 23, avgWaitTime: 15, bedOccupancy: 78, staffOnDuty: 18 },
      { department: 'medicine', patients: 67, avgWaitTime: 20, bedOccupancy: 85, staffOnDuty: 15 },
      { department: 'pediatrics', patients: 18, avgWaitTime: 18, bedOccupancy: 65, staffOnDuty: 8 },
      { department: 'radiology', patients: 34, avgWaitTime: 25, bedOccupancy: 0, staffOnDuty: 6 },
      { department: 'laboratory', patients: 89, avgWaitTime: 12, bedOccupancy: 0, staffOnDuty: 10 },
    ]);

    // Sample patient flow data (24-hour)
    setPatientFlow([
      { hour: '00:00', admissions: 2, discharges: 1, transfers: 0 },
      { hour: '02:00', admissions: 1, discharges: 0, transfers: 1 },
      { hour: '04:00', admissions: 3, discharges: 2, transfers: 0 },
      { hour: '06:00', admissions: 5, discharges: 3, transfers: 1 },
      { hour: '08:00', admissions: 8, discharges: 6, transfers: 2 },
      { hour: '10:00', admissions: 12, discharges: 8, transfers: 3 },
      { hour: '12:00', admissions: 15, discharges: 10, transfers: 4 },
      { hour: '14:00', admissions: 13, discharges: 11, transfers: 3 },
      { hour: '16:00', admissions: 11, discharges: 9, transfers: 2 },
      { hour: '18:00', admissions: 9, discharges: 7, transfers: 2 },
      { hour: '20:00', admissions: 6, discharges: 4, transfers: 1 },
      { hour: '22:00', admissions: 4, discharges: 2, transfers: 1 },
    ]);
  }, [selectedPeriod]);

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
