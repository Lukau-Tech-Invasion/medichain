import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  Search,
  Plus,
  Clock,
  CheckCircle,
  AlertTriangle,
  User,
  Target,
  Activity,
  Edit,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { apiUrl } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

/**
 * NursingCarePlanPage
 * 
 * Page for creating and managing nursing care plans.
 * Implements care plan list, care plan editor, and status tracking.
 */

type PlanStatus = 'active' | 'on-hold' | 'completed' | 'discontinued';
type Priority = 'high' | 'medium' | 'low';
type GoalStatus = 'not-met' | 'partially-met' | 'met';

interface Intervention {
  id: string;
  description: string;
  frequency: string;
  completed: boolean;
  lastPerformed?: Date;
}

interface Goal {
  id: string;
  description: string;
  targetDate: Date;
  status: GoalStatus;
}

interface CarePlan {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  room: string;
  diagnosis: string;
  priority: Priority;
  status: PlanStatus;
  goals: Goal[];
  interventions: Intervention[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const NursingCarePlanPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'plans' | 'new' | 'templates'>('plans');
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [_selectedPlan, _setSelectedPlan] = useState<CarePlan | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

  useEffect(() => {
    const fetchPlans = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(apiUrl('/api/clinical/nursing-care-plans'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Nurse'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch care plans: ${response.status}`);
        }
        
        const data = await response.json();
        // Convert date strings to Date objects
        const plansWithDates = (data || []).map((plan: CarePlan) => ({
          ...plan,
          createdAt: new Date(plan.createdAt),
          updatedAt: new Date(plan.updatedAt),
          goals: (plan.goals || []).map((goal: Goal) => ({
            ...goal,
            targetDate: new Date(goal.targetDate)
          })),
          interventions: (plan.interventions || []).map((intervention: Intervention) => ({
            ...intervention,
            lastPerformed: intervention.lastPerformed ? new Date(intervention.lastPerformed) : undefined
          }))
        }));
        setPlans(plansWithDates);
      } catch (err) {
        console.error('Error fetching care plans:', err);
        setError(err instanceof Error ? err.message : 'Failed to load nursing care plans');
        setPlans([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchPlans();
  }, [user]);

  const getStatusBadge = (status: PlanStatus) => {
    const styles: Record<PlanStatus, { bg: string; text: string }> = {
      'active': { bg: 'bg-green-100', text: 'text-green-700' },
      'on-hold': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
      'completed': { bg: 'bg-blue-100', text: 'text-blue-700' },
      'discontinued': { bg: 'bg-gray-100', text: 'text-gray-700' }
    };
    const s = styles[status];
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>{status}</span>;
  };

  const getPriorityBadge = (priority: Priority) => {
    const styles: Record<Priority, { bg: string; text: string }> = {
      'high': { bg: 'bg-red-100', text: 'text-red-700' },
      'medium': { bg: 'bg-orange-100', text: 'text-orange-700' },
      'low': { bg: 'bg-gray-100', text: 'text-gray-700' }
    };
    const s = styles[priority];
    return <span className={`px-2 py-1 rounded text-xs font-medium ${s.bg} ${s.text}`}>{priority}</span>;
  };

  const getGoalStatusBadge = (status: GoalStatus) => {
    const styles: Record<GoalStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'not-met': { bg: 'bg-red-100', text: 'text-red-700', icon: <AlertTriangle className="w-3 h-3" /> },
      'partially-met': { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: <Clock className="w-3 h-3" /> },
      'met': { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> }
    };
    const s = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {status.replace('-', ' ')}
      </span>
    );
  };

  const filteredPlans = plans.filter(p =>
    (p.patientName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    p.mrn.includes(searchQuery) ||
    (p.diagnosis?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const templates = [
    { id: 'T1', name: 'Fall Prevention', diagnosis: 'Risk for Falls', interventions: 5 },
    { id: 'T2', name: 'Pressure Injury Prevention', diagnosis: 'Risk for Impaired Skin Integrity', interventions: 6 },
    { id: 'T3', name: 'Pain Management', diagnosis: 'Acute/Chronic Pain', interventions: 4 },
    { id: 'T4', name: 'Infection Prevention', diagnosis: 'Risk for Infection', interventions: 5 },
    { id: 'T5', name: 'Aspiration Precautions', diagnosis: 'Risk for Aspiration', interventions: 4 },
    { id: 'T6', name: 'Mobility Impairment', diagnosis: 'Impaired Physical Mobility', interventions: 6 }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <ClipboardList className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Nursing Care Plans</h1>
        </div>
        <p className="text-purple-100">Create and manage patient care plans</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-purple-600 animate-spin mb-2" />
          <p className="text-gray-500">Loading care plans...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-red-700">{error}</p>
            <p className="text-xs text-red-500 mt-1">Check that the API server is running on port 8080</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-gray-800">{plans.filter(p => p.status === 'active').length}</p>
              <p className="text-xs text-gray-500">Active Plans</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{plans.filter(p => p.priority === 'high').length}</p>
              <p className="text-xs text-gray-500">High Priority</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-green-600">
                {plans.reduce((acc, p) => acc + p.goals.filter(g => g.status === 'met').length, 0)}
              </p>
              <p className="text-xs text-gray-500">Goals Met</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white border-b">
            <div className="flex">
              {(['plans', 'new', 'templates'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize ${
                    activeTab === tab ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-500'
                  }`}
                >
                  {tab === 'plans' ? 'Care Plans' : tab === 'new' ? 'New Plan' : 'Templates'}
                </button>
              ))}
            </div>
          </div>

          {/* Plans List */}
          {activeTab === 'plans' && (
            <div className="p-4">
              <div className="relative mb-4">
                <label htmlFor="ncp-search" className="sr-only">Search care plans</label>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="ncp-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by patient, MRN, or diagnosis..."
                  className="w-full pl-10 pr-4 py-2 border rounded-lg"
                />
              </div>

              <div className="space-y-3">
                {filteredPlans.map(plan => (
                  <div key={plan.id} className="bg-white rounded-lg shadow border overflow-hidden">
                    <div
                      className="p-4 cursor-pointer"
                      onClick={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
                    >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{plan.patientName}</h3>
                        {getPriorityBadge(plan.priority)}
                      </div>
                      <p className="text-sm text-gray-500">Room {plan.room} • MRN: {plan.mrn}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(plan.status)}
                      {expandedPlan === plan.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>

                  <div className="bg-purple-50 rounded p-2 mb-2">
                    <p className="text-sm font-medium text-purple-800">{plan.diagnosis}</p>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span><Target className="w-3 h-3 inline mr-1" />{plan.goals.length} goals</span>
                    <span><Activity className="w-3 h-3 inline mr-1" />{plan.interventions.length} interventions</span>
                    <span><User className="w-3 h-3 inline mr-1" />{plan.createdBy}</span>
                  </div>
                </div>

                {expandedPlan === plan.id && (
                  <div className="border-t p-4 bg-gray-50">
                    <div className="mb-4">
                      <h4 className="font-medium mb-2 flex items-center gap-2"><Target className="w-4 h-4" /> Goals</h4>
                      <div className="space-y-2">
                        {plan.goals.map(goal => (
                          <div key={goal.id} className="flex items-center justify-between bg-white p-2 rounded border">
                            <span className="text-sm">{goal.description}</span>
                            {getGoalStatusBadge(goal.status)}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2 flex items-center gap-2"><Activity className="w-4 h-4" /> Interventions</h4>
                      <div className="space-y-2">
                        {plan.interventions.map(int => (
                          <div key={int.id} className="flex items-center justify-between bg-white p-2 rounded border">
                            <div className="flex items-center gap-2">
                              <input type="checkbox" checked={int.completed} readOnly className="w-4 h-4" />
                              <span className={`text-sm ${int.completed ? 'line-through text-gray-400' : ''}`}>{int.description}</span>
                            </div>
                            <span className="text-xs text-gray-500">{int.frequency}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button className="flex-1 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1">
                        <Edit className="w-4 h-4" /> Edit Plan
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Plan */}
      {activeTab === 'new' && (
        <div className="p-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Create Care Plan</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="ncp-patient" className="block text-sm font-medium mb-1">Patient *</label>
                <select id="ncp-patient" className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select patient...</option>
                  {plans.map(p => (
                    <option key={p.patientId} value={p.patientId}>{p.patientName} - Room {p.room}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ncp-diagnosis" className="block text-sm font-medium mb-1">Nursing Diagnosis *</label>
                <input id="ncp-diagnosis" type="text" className="w-full border rounded-lg px-3 py-2" placeholder="e.g., Risk for Falls" />
              </div>
              <div role="group" aria-labelledby="ncp-priority-label">
                <label id="ncp-priority-label" className="block text-sm font-medium mb-1">Priority *</label>
                <div className="flex gap-2">
                  {(['high', 'medium', 'low'] as const).map(p => (
                    <button key={p} className={`flex-1 py-2 rounded-lg border capitalize ${p === 'high' ? 'bg-red-50 border-red-300 text-red-700' : p === 'medium' ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-gray-50 border-gray-300'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <button className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" /> Create Care Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates */}
      {activeTab === 'templates' && (
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-4">Care Plan Templates</h2>
          <div className="grid gap-3">
            {templates.map(t => (
              <div key={t.id} className="bg-white rounded-lg shadow border p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{t.name}</h3>
                  <p className="text-sm text-gray-500">{t.diagnosis}</p>
                  <p className="text-xs text-gray-400">{t.interventions} interventions</p>
                </div>
                <button className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium">Use Template</button>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default NursingCarePlanPage;
