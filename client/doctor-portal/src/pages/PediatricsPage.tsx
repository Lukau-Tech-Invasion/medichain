import React, { useState, useEffect } from 'react';
import {
  Baby,
  Search,
  Plus,
  TrendingUp,
  Ruler,
  Scale,
  Activity,
  AlertTriangle,
  CheckCircle,
  Heart
} from 'lucide-react';

/**
 * PediatricsPage
 * 
 * Page for pediatric assessment and documentation.
 * Implements pediatric assessment form, growth chart, and risk screening.
 */

type AgeGroup = 'newborn' | 'infant' | 'toddler' | 'preschool' | 'school-age' | 'adolescent';
type DevelopmentStatus = 'on-track' | 'monitor' | 'concern';

interface GrowthData {
  date: Date;
  weight: number;
  height: number;
  headCircumference?: number;
  bmi?: number;
  weightPercentile: number;
  heightPercentile: number;
}

interface PediatricPatient {
  id: string;
  name: string;
  mrn: string;
  dob: Date;
  ageMonths: number;
  ageGroup: AgeGroup;
  gender: 'male' | 'female';
  growthData: GrowthData[];
  vaccinesUpToDate: boolean;
  developmentStatus: DevelopmentStatus;
  alerts: string[];
}

const PediatricsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'patients' | 'assessment' | 'growth'>('patients');
  const [patients, setPatients] = useState<PediatricPatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PediatricPatient | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const now = new Date();
    const monthsAgo = (m: number) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() - m);
      return d;
    };

    setPatients([
      {
        id: 'PED-001',
        name: 'Yusuf Al-Rashid',
        mrn: '123456',
        dob: monthsAgo(8),
        ageMonths: 8,
        ageGroup: 'infant',
        gender: 'male',
        growthData: [
          { date: monthsAgo(6), weight: 5.2, height: 58, headCircumference: 39, weightPercentile: 45, heightPercentile: 50 },
          { date: monthsAgo(4), weight: 6.8, height: 63, headCircumference: 41, weightPercentile: 50, heightPercentile: 55 },
          { date: monthsAgo(2), weight: 7.9, height: 68, headCircumference: 43, weightPercentile: 55, heightPercentile: 60 },
          { date: now, weight: 8.5, height: 71, headCircumference: 44.5, weightPercentile: 55, heightPercentile: 58 }
        ],
        vaccinesUpToDate: true,
        developmentStatus: 'on-track',
        alerts: []
      },
      {
        id: 'PED-002',
        name: 'Sara Hassan',
        mrn: '234567',
        dob: monthsAgo(24),
        ageMonths: 24,
        ageGroup: 'toddler',
        gender: 'female',
        growthData: [
          { date: monthsAgo(12), weight: 9.5, height: 76, weightPercentile: 40, heightPercentile: 45 },
          { date: monthsAgo(6), weight: 10.8, height: 82, weightPercentile: 35, heightPercentile: 40 },
          { date: now, weight: 11.2, height: 85, weightPercentile: 30, heightPercentile: 35, bmi: 15.5 }
        ],
        vaccinesUpToDate: false,
        developmentStatus: 'monitor',
        alerts: ['Vaccines overdue: MMR, Varicella', 'Weight tracking below curve']
      },
      {
        id: 'PED-003',
        name: 'Omar Khalil Jr.',
        mrn: '345678',
        dob: monthsAgo(72),
        ageMonths: 72,
        ageGroup: 'school-age',
        gender: 'male',
        growthData: [
          { date: monthsAgo(12), weight: 18.5, height: 108, weightPercentile: 50, heightPercentile: 55, bmi: 15.9 },
          { date: now, weight: 21, height: 115, weightPercentile: 55, heightPercentile: 60, bmi: 15.9 }
        ],
        vaccinesUpToDate: true,
        developmentStatus: 'on-track',
        alerts: []
      }
    ]);
  }, []);

  const getAgeDisplay = (months: number): string => {
    if (months < 1) return 'Newborn';
    if (months < 12) return `${months} months`;
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return remainingMonths > 0 ? `${years} yr ${remainingMonths} mo` : `${years} years`;
  };

  const getAgeGroupColor = (group: AgeGroup): string => {
    const colors: Record<AgeGroup, string> = {
      'newborn': 'bg-pink-100 text-pink-700',
      'infant': 'bg-purple-100 text-purple-700',
      'toddler': 'bg-blue-100 text-blue-700',
      'preschool': 'bg-green-100 text-green-700',
      'school-age': 'bg-orange-100 text-orange-700',
      'adolescent': 'bg-cyan-100 text-cyan-700'
    };
    return colors[group];
  };

  const getDevelopmentBadge = (status: DevelopmentStatus) => {
    const styles: Record<DevelopmentStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'on-track': { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
      'monitor': { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <Activity className="w-3 h-3" /> },
      'concern': { bg: 'bg-red-100', text: 'text-red-700', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const s = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {status.replace('-', ' ')}
      </span>
    );
  };

  const filteredPatients = patients.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.mrn.includes(searchQuery)
  );

  const developmentalMilestones: Record<AgeGroup, string[]> = {
    'newborn': ['Startles to loud sounds', 'Focuses on faces', 'Moves arms and legs equally'],
    'infant': ['Sits without support', 'Responds to name', 'Babbles', 'Transfers objects hand to hand'],
    'toddler': ['Walks independently', 'Says 2-word phrases', 'Follows simple instructions', 'Points to show interest'],
    'preschool': ['Hops on one foot', 'Speaks in sentences', 'Plays with other children', 'Can tell stories'],
    'school-age': ['Rides bicycle', 'Reads independently', 'Understands time concepts', 'Shows empathy'],
    'adolescent': ['Abstract thinking', 'Identity formation', 'Peer relationships', 'Future planning']
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-sky-500 to-blue-400 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Baby className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Pediatric Assessment</h1>
        </div>
        <p className="text-sky-100">Growth tracking and developmental screening</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{patients.length}</p>
          <p className="text-xs text-gray-500">Patients</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{patients.filter(p => p.alerts.length > 0).length}</p>
          <p className="text-xs text-gray-500">Needs Attention</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{patients.filter(p => p.vaccinesUpToDate).length}</p>
          <p className="text-xs text-gray-500">Vaccines Current</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {(['patients', 'assessment', 'growth'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium capitalize ${
                activeTab === tab ? 'text-sky-700 border-b-2 border-sky-700' : 'text-gray-500'
              }`}
            >
              {tab === 'patients' ? 'All Patients' : tab === 'assessment' ? 'Assessment' : 'Growth Charts'}
            </button>
          ))}
        </div>
      </div>

      {/* Patients Tab */}
      {activeTab === 'patients' && (
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or MRN..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>

          <div className="space-y-3">
            {filteredPatients.map(patient => {
              const latestGrowth = patient.growthData[patient.growthData.length - 1];
              return (
                <div
                  key={patient.id}
                  onClick={() => setSelectedPatient(patient)}
                  className={`bg-white rounded-lg shadow border p-4 cursor-pointer hover:shadow-md ${
                    patient.alerts.length > 0 ? 'border-l-4 border-l-yellow-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{patient.name}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs ${getAgeGroupColor(patient.ageGroup)}`}>
                          {patient.ageGroup}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">
                        {getAgeDisplay(patient.ageMonths)} • MRN: {patient.mrn}
                      </p>
                    </div>
                    {getDevelopmentBadge(patient.developmentStatus)}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <Scale className="w-4 h-4 mx-auto text-gray-400 mb-1" />
                      <p className="text-sm font-semibold">{latestGrowth.weight} kg</p>
                      <p className="text-xs text-gray-500">{latestGrowth.weightPercentile}%ile</p>
                    </div>
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <Ruler className="w-4 h-4 mx-auto text-gray-400 mb-1" />
                      <p className="text-sm font-semibold">{latestGrowth.height} cm</p>
                      <p className="text-xs text-gray-500">{latestGrowth.heightPercentile}%ile</p>
                    </div>
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <Heart className="w-4 h-4 mx-auto text-gray-400 mb-1" />
                      <p className="text-sm font-semibold">{patient.vaccinesUpToDate ? '✓' : '!'}</p>
                      <p className="text-xs text-gray-500">Vaccines</p>
                    </div>
                  </div>

                  {patient.alerts.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-yellow-700">
                          {patient.alerts.map((alert, idx) => (
                            <p key={idx}>{alert}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Assessment Tab */}
      {activeTab === 'assessment' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">New Pediatric Assessment</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="peds-patient" className="block text-sm font-medium mb-1">Patient *</label>
                <select id="peds-patient" className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select patient...</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.name} - {getAgeDisplay(p.ageMonths)}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="peds-weight" className="block text-sm font-medium mb-1">Weight (kg) *</label>
                  <input id="peds-weight" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="0.0" />
                </div>
                <div>
                  <label htmlFor="peds-height" className="block text-sm font-medium mb-1">Height (cm) *</label>
                  <input id="peds-height" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="0.0" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="peds-head-circumference" className="block text-sm font-medium mb-1">Head Circumference (cm)</label>
                  <input id="peds-head-circumference" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="Optional" />
                </div>
                <div>
                  <label htmlFor="peds-temperature" className="block text-sm font-medium mb-1">Temperature (°C)</label>
                  <input id="peds-temperature" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="36.5" />
                </div>
              </div>

              <div>
                <span id="peds-milestones-label" className="block text-sm font-medium mb-2">Developmental Milestones</span>
                <div className="bg-sky-50 border border-sky-200 rounded-lg p-4" role="group" aria-labelledby="peds-milestones-label">
                  <p className="text-sm text-sky-700 mb-2">Select achieved milestones:</p>
                  <div className="space-y-2">
                    {developmentalMilestones['infant'].map((milestone, idx) => (
                      <label key={idx} htmlFor={`peds-milestone-${idx}`} className="flex items-center gap-2">
                        <input id={`peds-milestone-${idx}`} type="checkbox" className="w-4 h-4" />
                        <span className="text-sm">{milestone}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="peds-notes" className="block text-sm font-medium mb-1">Notes</label>
                <textarea id="peds-notes" className="w-full border rounded-lg px-3 py-2" rows={3} placeholder="Assessment notes..." />
              </div>

              <button className="w-full py-3 bg-sky-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" /> Save Assessment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Growth Charts Tab */}
      {activeTab === 'growth' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Growth Chart Tracking</h2>
            <div className="space-y-4">
              {patients.map(patient => (
                <div key={patient.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">{patient.name}</h3>
                      <p className="text-sm text-gray-500">{getAgeDisplay(patient.ageMonths)}</p>
                    </div>
                    <TrendingUp className="w-5 h-5 text-green-500" />
                  </div>
                  <div className="h-24 bg-gradient-to-r from-sky-100 to-blue-100 rounded flex items-center justify-center text-gray-400">
                    <span className="text-sm">Growth curve visualization</span>
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-gray-500">
                    <span>Weight: {patient.growthData[patient.growthData.length - 1].weightPercentile}%ile</span>
                    <span>Height: {patient.growthData[patient.growthData.length - 1].heightPercentile}%ile</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Patient Detail Modal */}
      {selectedPatient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedPatient.name}</h2>
                <p className="text-sm text-gray-500">{getAgeDisplay(selectedPatient.ageMonths)} • {selectedPatient.gender}</p>
              </div>
              <button onClick={() => setSelectedPatient(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-sky-50 rounded-lg p-4 text-center">
                  <Scale className="w-6 h-6 mx-auto text-sky-600 mb-1" />
                  <p className="text-xl font-bold">{selectedPatient.growthData[selectedPatient.growthData.length - 1].weight} kg</p>
                  <p className="text-sm text-sky-600">{selectedPatient.growthData[selectedPatient.growthData.length - 1].weightPercentile}th percentile</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 text-center">
                  <Ruler className="w-6 h-6 mx-auto text-purple-600 mb-1" />
                  <p className="text-xl font-bold">{selectedPatient.growthData[selectedPatient.growthData.length - 1].height} cm</p>
                  <p className="text-sm text-purple-600">{selectedPatient.growthData[selectedPatient.growthData.length - 1].heightPercentile}th percentile</p>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">Growth History</h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-right">Weight</th>
                        <th className="p-2 text-right">Height</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPatient.growthData.slice().reverse().map((g, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{g.date.toLocaleDateString()}</td>
                          <td className="p-2 text-right">{g.weight} kg</td>
                          <td className="p-2 text-right">{g.height} cm</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2">
                <span className={`flex-1 text-center py-2 rounded-lg text-sm ${selectedPatient.vaccinesUpToDate ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  Vaccines: {selectedPatient.vaccinesUpToDate ? 'Up to date' : 'Overdue'}
                </span>
                {getDevelopmentBadge(selectedPatient.developmentStatus)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PediatricsPage;
