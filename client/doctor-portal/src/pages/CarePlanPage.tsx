import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createCarePlan, getPatients } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  ClipboardList,
  Target,
  CheckCircle2,
  Clock,
  Save,
  Plus,
  Trash2,
  AlertTriangle,
  Search,
  User,
  Activity,
  RefreshCw,
  ArrowRight,
  Heart,
  Brain,
  Shield,
  Stethoscope
} from 'lucide-react';

type GoalStatus = 'not-started' | 'in-progress' | 'met' | 'partially-met' | 'not-met' | 'revised';
type InterventionStatus = 'active' | 'completed' | 'discontinued';
type Priority = 'high' | 'medium' | 'low';

interface NursingDiagnosis {
  id: string;
  diagnosis: string;
  relatedTo: string;
  evidencedBy: string;
  priority: Priority;
  dateIdentified: string;
}

interface Goal {
  id: string;
  diagnosisId: string;
  description: string;
  targetDate: string;
  status: GoalStatus;
  measurableOutcome: string;
  progressNotes: string[];
}

interface Intervention {
  id: string;
  goalId: string;
  description: string;
  frequency: string;
  status: InterventionStatus;
  responsibleParty: string;
  lastPerformed?: string;
  notes?: string;
}

interface _CarePlan {
  id: string;
  patientId: string;
  diagnoses: NursingDiagnosis[];
  goals: Goal[];
  interventions: Intervention[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export default function CarePlanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'diagnoses' | 'goals' | 'interventions' | 'summary'>('diagnoses');

  // Care plan data
  const [diagnoses, setDiagnoses] = useState<NursingDiagnosis[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);

  // Forms
  const [showAddDiagnosis, setShowAddDiagnosis] = useState(false);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [showAddIntervention, setShowAddIntervention] = useState(false);

  const [newDiagnosis, setNewDiagnosis] = useState<Partial<NursingDiagnosis>>({
    diagnosis: '',
    relatedTo: '',
    evidencedBy: '',
    priority: 'medium'
  });

  const [newGoal, setNewGoal] = useState<Partial<Goal>>({
    diagnosisId: '',
    description: '',
    targetDate: '',
    measurableOutcome: '',
    status: 'not-started'
  });

  const [newIntervention, setNewIntervention] = useState<Partial<Intervention>>({
    goalId: '',
    description: '',
    frequency: '',
    responsibleParty: '',
    status: 'active'
  });

  // Common nursing diagnoses (NANDA-I)
  const commonDiagnoses = [
    { category: 'Safety', diagnoses: ['Risk for Falls', 'Risk for Infection', 'Impaired Skin Integrity', 'Risk for Aspiration'] },
    { category: 'Activity', diagnoses: ['Activity Intolerance', 'Impaired Physical Mobility', 'Fatigue', 'Self-Care Deficit'] },
    { category: 'Nutrition', diagnoses: ['Imbalanced Nutrition: Less Than Body Requirements', 'Risk for Unstable Blood Glucose', 'Impaired Swallowing'] },
    { category: 'Elimination', diagnoses: ['Constipation', 'Urinary Retention', 'Bowel Incontinence', 'Impaired Urinary Elimination'] },
    { category: 'Respiratory', diagnoses: ['Ineffective Airway Clearance', 'Impaired Gas Exchange', 'Ineffective Breathing Pattern'] },
    { category: 'Cardiac', diagnoses: ['Decreased Cardiac Output', 'Ineffective Peripheral Tissue Perfusion', 'Risk for Bleeding'] },
    { category: 'Cognition', diagnoses: ['Acute Confusion', 'Chronic Confusion', 'Impaired Memory', 'Risk for Acute Confusion'] },
    { category: 'Psychosocial', diagnoses: ['Anxiety', 'Acute Pain', 'Chronic Pain', 'Hopelessness', 'Social Isolation'] }
  ];

  const frequencies = [
    'Every shift', 'Q2H', 'Q4H', 'BID', 'TID', 'QID', 'Daily', 'Weekly', 'PRN', 'Continuous'
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const patientData = await getPatients();
        setPatients(patientData || []);
        
        const patientId = searchParams.get('patientId');
        if (patientId) {
          const patient = patientData?.find((p: PatientProfile) => p.patient_id === patientId);
          if (patient) {
            setSelectedPatient(patient);
          }
        }
      } catch (err) {
        console.error('Failed to fetch patients', err);
      }
    };
    fetchData();
  }, [searchParams]);

  const getPriorityColor = (priority: Priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-700 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-700 border-green-300';
    }
  };

  const getStatusColor = (status: GoalStatus) => {
    switch (status) {
      case 'met': return 'bg-green-500 text-white';
      case 'partially-met': return 'bg-yellow-500 text-white';
      case 'in-progress': return 'bg-blue-500 text-white';
      case 'not-met': return 'bg-red-500 text-white';
      case 'revised': return 'bg-purple-500 text-white';
      default: return 'bg-gray-300 text-gray-700';
    }
  };

  const _getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Safety': return <Shield className="h-4 w-4" />;
      case 'Cardiac': return <Heart className="h-4 w-4" />;
      case 'Cognition': return <Brain className="h-4 w-4" />;
      case 'Activity': return <Activity className="h-4 w-4" />;
      default: return <Stethoscope className="h-4 w-4" />;
    }
  };

  const addDiagnosis = () => {
    if (!newDiagnosis.diagnosis) return;
    
    const diagnosis: NursingDiagnosis = {
      id: `DX-${Date.now()}`,
      diagnosis: newDiagnosis.diagnosis,
      relatedTo: newDiagnosis.relatedTo || '',
      evidencedBy: newDiagnosis.evidencedBy || '',
      priority: newDiagnosis.priority || 'medium',
      dateIdentified: new Date().toISOString().split('T')[0]
    };

    setDiagnoses(prev => [...prev, diagnosis]);
    setNewDiagnosis({ diagnosis: '', relatedTo: '', evidencedBy: '', priority: 'medium' });
    setShowAddDiagnosis(false);
  };

  const addGoal = () => {
    if (!newGoal.diagnosisId || !newGoal.description) return;
    
    const goal: Goal = {
      id: `GOAL-${Date.now()}`,
      diagnosisId: newGoal.diagnosisId,
      description: newGoal.description,
      targetDate: newGoal.targetDate || '',
      status: 'not-started',
      measurableOutcome: newGoal.measurableOutcome || '',
      progressNotes: []
    };

    setGoals(prev => [...prev, goal]);
    setNewGoal({ diagnosisId: '', description: '', targetDate: '', measurableOutcome: '', status: 'not-started' });
    setShowAddGoal(false);
  };

  const addIntervention = () => {
    if (!newIntervention.goalId || !newIntervention.description) return;
    
    const intervention: Intervention = {
      id: `INT-${Date.now()}`,
      goalId: newIntervention.goalId,
      description: newIntervention.description,
      frequency: newIntervention.frequency || '',
      status: 'active',
      responsibleParty: newIntervention.responsibleParty || 'RN'
    };

    setInterventions(prev => [...prev, intervention]);
    setNewIntervention({ goalId: '', description: '', frequency: '', responsibleParty: '', status: 'active' });
    setShowAddIntervention(false);
  };

  const updateGoalStatus = (goalId: string, status: GoalStatus) => {
    setGoals(prev => prev.map(g => g.id === goalId ? { ...g, status } : g));
  };

  const removeDiagnosis = (id: string) => {
    setDiagnoses(prev => prev.filter(d => d.id !== id));
    setGoals(prev => prev.filter(g => g.diagnosisId !== id));
  };

  const removeGoal = (id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id));
    setInterventions(prev => prev.filter(i => i.goalId !== id));
  };

  const removeIntervention = (id: string) => {
    setInterventions(prev => prev.filter(i => i.id !== id));
  };

  const filteredPatients = patients.filter(p => 
    p.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.patient_id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSave = async () => {
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    if (diagnoses.length === 0) {
      setError('Please add at least one nursing diagnosis');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const carePlanData = {
        care_plan_id: `CP-${Date.now()}`,
        patient_id: selectedPatient.patient_id,
        diagnoses,
        goals,
        interventions,
        created_by: user?.userId || 'unknown',
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000)
      };

      await createCarePlan(carePlanData);
      setSuccess('Care plan saved successfully!');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save care plan. Please try again.');
      console.error('Failed to save care plan', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-600 to-cyan-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <ClipboardList className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Nursing Care Plan</h1>
                <p className="text-teal-100">Create and manage patient-centered care plans</p>
              </div>
            </div>
            {selectedPatient && (
              <div className="text-right text-white">
                <p className="font-medium">{selectedPatient.full_name}</p>
                <p className="text-sm opacity-75">{selectedPatient.patient_id}</p>
              </div>
            )}
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Patient Selection Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-bold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2 text-teal-500" />
                Select Patient
              </h2>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search patients..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {filteredPatients.map(patient => (
                  <button
                    key={patient.patient_id}
                    onClick={() => setSelectedPatient(patient)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedPatient?.patient_id === patient.patient_id
                        ? 'bg-teal-100 border-2 border-teal-500'
                        : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{patient.full_name}</p>
                    <p className="text-sm text-gray-500">{patient.patient_id}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Care Plan Summary */}
            {selectedPatient && (
              <div className="bg-white rounded-lg shadow p-4 mt-4">
                <h3 className="font-bold text-gray-900 mb-3">Care Plan Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Diagnoses:</span>
                    <span className="font-medium">{diagnoses.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Goals:</span>
                    <span className="font-medium">{goals.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Interventions:</span>
                    <span className="font-medium">{interventions.length}</span>
                  </div>
                  <hr className="my-2" />
                  <div className="flex justify-between">
                    <span className="text-gray-500">Goals Met:</span>
                    <span className="font-medium text-green-600">
                      {goals.filter(g => g.status === 'met').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">In Progress:</span>
                    <span className="font-medium text-blue-600">
                      {goals.filter(g => g.status === 'in-progress').length}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {selectedPatient ? (
              <div className="bg-white rounded-lg shadow">
                {/* Tabs */}
                <div className="border-b">
                  <div className="flex">
                    {[
                      { id: 'diagnoses', label: 'Nursing Diagnoses', icon: Stethoscope },
                      { id: 'goals', label: 'Goals & Outcomes', icon: Target },
                      { id: 'interventions', label: 'Interventions', icon: Activity },
                      { id: 'summary', label: 'Summary View', icon: ClipboardList }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        className={`flex-1 flex items-center justify-center space-x-2 py-4 px-4 font-medium transition-colors ${
                          activeTab === tab.id
                            ? 'border-b-2 border-teal-500 text-teal-600'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        <tab.icon className="h-5 w-5" />
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab Content */}
                <div className="p-6">
                  {/* Diagnoses Tab */}
                  {activeTab === 'diagnoses' && (
                    <div>
                      <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-gray-900">Nursing Diagnoses (NANDA-I)</h2>
                        <button
                          onClick={() => setShowAddDiagnosis(true)}
                          className="flex items-center space-x-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700"
                        >
                          <Plus className="h-5 w-5" />
                          <span>Add Diagnosis</span>
                        </button>
                      </div>

                      {showAddDiagnosis && (
                        <div className="mb-6 p-6 bg-gray-50 rounded-lg border-2 border-teal-300">
                          <h3 className="text-lg font-bold mb-4">Add Nursing Diagnosis</h3>
                          <div className="space-y-4">
                            <div>
                              <label htmlFor="careplan-diagnosis" className="block text-sm font-medium text-gray-700 mb-1">Diagnosis</label>
                              <select
                                id="careplan-diagnosis"
                                value={newDiagnosis.diagnosis}
                                onChange={(e) => setNewDiagnosis({ ...newDiagnosis, diagnosis: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              >
                                <option value="">Select diagnosis</option>
                                {commonDiagnoses.map(cat => (
                                  <optgroup key={cat.category} label={cat.category}>
                                    {cat.diagnoses.map(dx => (
                                      <option key={dx} value={dx}>{dx}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label htmlFor="careplan-related-to" className="block text-sm font-medium text-gray-700 mb-1">Related To (Etiology)</label>
                              <input
                                id="careplan-related-to"
                                type="text"
                                value={newDiagnosis.relatedTo}
                                onChange={(e) => setNewDiagnosis({ ...newDiagnosis, relatedTo: e.target.value })}
                                placeholder="e.g., decreased mobility, age > 65, medication side effects"
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label htmlFor="careplan-evidenced-by" className="block text-sm font-medium text-gray-700 mb-1">As Evidenced By (Signs/Symptoms)</label>
                              <input
                                id="careplan-evidenced-by"
                                type="text"
                                value={newDiagnosis.evidencedBy}
                                onChange={(e) => setNewDiagnosis({ ...newDiagnosis, evidencedBy: e.target.value })}
                                placeholder="e.g., unsteady gait, use of assistive device, Morse score > 45"
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              />
                            </div>
                            <fieldset>
                              <legend className="block text-sm font-medium text-gray-700 mb-1">Priority</legend>
                              <div className="flex space-x-4">
                                {(['high', 'medium', 'low'] as Priority[]).map(p => (
                                  <label key={p} htmlFor={`careplan-priority-${p}`} className="flex items-center space-x-2">
                                    <input
                                      id={`careplan-priority-${p}`}
                                      type="radio"
                                      checked={newDiagnosis.priority === p}
                                      onChange={() => setNewDiagnosis({ ...newDiagnosis, priority: p })}
                                      className="text-teal-600"
                                    />
                                    <span className={`px-2 py-1 rounded capitalize ${getPriorityColor(p)}`}>{p}</span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          </div>
                          <div className="flex justify-end space-x-3 mt-4">
                            <button
                              onClick={() => setShowAddDiagnosis(false)}
                              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={addDiagnosis}
                              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                            >
                              Add Diagnosis
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-4">
                        {diagnoses.map(dx => (
                          <div key={dx.id} className={`p-4 rounded-lg border-l-4 ${
                            dx.priority === 'high' ? 'border-l-red-500 bg-red-50' :
                            dx.priority === 'medium' ? 'border-l-yellow-500 bg-yellow-50' :
                            'border-l-green-500 bg-green-50'
                          }`}>
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="flex items-center space-x-2">
                                  <h3 className="font-bold text-gray-900">{dx.diagnosis}</h3>
                                  <span className={`text-xs px-2 py-0.5 rounded ${getPriorityColor(dx.priority)}`}>
                                    {dx.priority.toUpperCase()}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 mt-1">
                                  <strong>R/T:</strong> {dx.relatedTo || 'Not specified'}
                                </p>
                                <p className="text-sm text-gray-600">
                                  <strong>AEB:</strong> {dx.evidencedBy || 'Not specified'}
                                </p>
                                <p className="text-xs text-gray-400 mt-2">Identified: {dx.dateIdentified}</p>
                              </div>
                              <button
                                onClick={() => removeDiagnosis(dx.id)}
                                className="text-red-600 hover:text-red-700 p-2"
                              >
                                <Trash2 className="h-5 w-5" />
                              </button>
                            </div>
                          </div>
                        ))}
                        {diagnoses.length === 0 && (
                          <div className="text-center py-8 text-gray-500">
                            <Stethoscope className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>No nursing diagnoses added yet.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Goals Tab */}
                  {activeTab === 'goals' && (
                    <div>
                      <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-gray-900">Goals & Expected Outcomes</h2>
                        <button
                          onClick={() => setShowAddGoal(true)}
                          disabled={diagnoses.length === 0}
                          className="flex items-center space-x-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50"
                        >
                          <Plus className="h-5 w-5" />
                          <span>Add Goal</span>
                        </button>
                      </div>

                      {diagnoses.length === 0 && (
                        <div className="mb-6 bg-yellow-50 border border-yellow-200 text-yellow-700 p-4 rounded-lg">
                          <AlertTriangle className="h-5 w-5 inline mr-2" />
                          Please add at least one nursing diagnosis before adding goals.
                        </div>
                      )}

                      {showAddGoal && (
                        <div className="mb-6 p-6 bg-gray-50 rounded-lg border-2 border-teal-300">
                          <h3 className="text-lg font-bold mb-4">Add Goal</h3>
                          <div className="space-y-4">
                            <div>
                              <label htmlFor="careplan-goal-diagnosis" className="block text-sm font-medium text-gray-700 mb-1">Related Diagnosis</label>
                              <select
                                id="careplan-goal-diagnosis"
                                value={newGoal.diagnosisId}
                                onChange={(e) => setNewGoal({ ...newGoal, diagnosisId: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              >
                                <option value="">Select diagnosis</option>
                                {diagnoses.map(dx => (
                                  <option key={dx.id} value={dx.id}>{dx.diagnosis}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label htmlFor="careplan-goal-description" className="block text-sm font-medium text-gray-700 mb-1">Goal Description</label>
                              <textarea
                                id="careplan-goal-description"
                                value={newGoal.description}
                                onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })}
                                placeholder="e.g., Patient will remain free from falls during hospitalization"
                                rows={2}
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label htmlFor="careplan-measurable-outcome" className="block text-sm font-medium text-gray-700 mb-1">Measurable Outcome</label>
                              <input
                                id="careplan-measurable-outcome"
                                type="text"
                                value={newGoal.measurableOutcome}
                                onChange={(e) => setNewGoal({ ...newGoal, measurableOutcome: e.target.value })}
                                placeholder="e.g., Zero falls documented, Morse score < 25"
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label htmlFor="careplan-target-date" className="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
                              <input
                                id="careplan-target-date"
                                type="date"
                                value={newGoal.targetDate}
                                onChange={(e) => setNewGoal({ ...newGoal, targetDate: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end space-x-3 mt-4">
                            <button
                              onClick={() => setShowAddGoal(false)}
                              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={addGoal}
                              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                            >
                              Add Goal
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-4">
                        {goals.map(goal => {
                          const relatedDx = diagnoses.find(d => d.id === goal.diagnosisId);
                          return (
                            <div key={goal.id} className="p-4 rounded-lg border bg-white">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <p className="text-xs text-gray-500 mb-1">
                                    For: {relatedDx?.diagnosis || 'Unknown diagnosis'}
                                  </p>
                                  <h3 className="font-bold text-gray-900">{goal.description}</h3>
                                  <p className="text-sm text-gray-600 mt-1">
                                    <Target className="h-4 w-4 inline mr-1" />
                                    {goal.measurableOutcome}
                                  </p>
                                  <p className="text-xs text-gray-400 mt-2">
                                    <Clock className="h-3 w-3 inline mr-1" />
                                    Target: {goal.targetDate || 'Not set'}
                                  </p>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <select
                                    value={goal.status}
                                    onChange={(e) => updateGoalStatus(goal.id, e.target.value as GoalStatus)}
                                    className={`px-3 py-1 rounded text-sm ${getStatusColor(goal.status)}`}
                                  >
                                    <option value="not-started">Not Started</option>
                                    <option value="in-progress">In Progress</option>
                                    <option value="met">Met</option>
                                    <option value="partially-met">Partially Met</option>
                                    <option value="not-met">Not Met</option>
                                    <option value="revised">Revised</option>
                                  </select>
                                  <button
                                    onClick={() => removeGoal(goal.id)}
                                    className="text-red-600 hover:text-red-700 p-2"
                                  >
                                    <Trash2 className="h-5 w-5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {goals.length === 0 && diagnoses.length > 0 && (
                          <div className="text-center py-8 text-gray-500">
                            <Target className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>No goals added yet.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Interventions Tab */}
                  {activeTab === 'interventions' && (
                    <div>
                      <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-gray-900">Nursing Interventions</h2>
                        <button
                          onClick={() => setShowAddIntervention(true)}
                          disabled={goals.length === 0}
                          className="flex items-center space-x-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50"
                        >
                          <Plus className="h-5 w-5" />
                          <span>Add Intervention</span>
                        </button>
                      </div>

                      {goals.length === 0 && (
                        <div className="mb-6 bg-yellow-50 border border-yellow-200 text-yellow-700 p-4 rounded-lg">
                          <AlertTriangle className="h-5 w-5 inline mr-2" />
                          Please add at least one goal before adding interventions.
                        </div>
                      )}

                      {showAddIntervention && (
                        <div className="mb-6 p-6 bg-gray-50 rounded-lg border-2 border-teal-300">
                          <h3 className="text-lg font-bold mb-4">Add Intervention</h3>
                          <div className="space-y-4">
                            <div>
                              <label htmlFor="careplan-intervention-goal" className="block text-sm font-medium text-gray-700 mb-1">Related Goal</label>
                              <select
                                id="careplan-intervention-goal"
                                value={newIntervention.goalId}
                                onChange={(e) => setNewIntervention({ ...newIntervention, goalId: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              >
                                <option value="">Select goal</option>
                                {goals.map(g => (
                                  <option key={g.id} value={g.id}>{g.description.slice(0, 50)}...</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label htmlFor="careplan-intervention-description" className="block text-sm font-medium text-gray-700 mb-1">Intervention</label>
                              <textarea
                                id="careplan-intervention-description"
                                value={newIntervention.description}
                                onChange={(e) => setNewIntervention({ ...newIntervention, description: e.target.value })}
                                placeholder="e.g., Assist patient with ambulation using walker TID"
                                rows={2}
                                className="w-full p-3 border border-gray-300 rounded-lg"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label htmlFor="careplan-intervention-frequency" className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
                                <select
                                  id="careplan-intervention-frequency"
                                  value={newIntervention.frequency}
                                  onChange={(e) => setNewIntervention({ ...newIntervention, frequency: e.target.value })}
                                  className="w-full p-3 border border-gray-300 rounded-lg"
                                >
                                  <option value="">Select frequency</option>
                                  {frequencies.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label htmlFor="careplan-responsible-party" className="block text-sm font-medium text-gray-700 mb-1">Responsible Party</label>
                                <select
                                  id="careplan-responsible-party"
                                  value={newIntervention.responsibleParty}
                                  onChange={(e) => setNewIntervention({ ...newIntervention, responsibleParty: e.target.value })}
                                  className="w-full p-3 border border-gray-300 rounded-lg"
                                >
                                  <option value="">Select</option>
                                  <option value="RN">RN</option>
                                  <option value="LPN">LPN</option>
                                  <option value="CNA">CNA</option>
                                  <option value="PT">PT</option>
                                  <option value="OT">OT</option>
                                  <option value="RT">RT</option>
                                </select>
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end space-x-3 mt-4">
                            <button
                              onClick={() => setShowAddIntervention(false)}
                              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={addIntervention}
                              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                            >
                              Add Intervention
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        {interventions.map(int => {
                          const relatedGoal = goals.find(g => g.id === int.goalId);
                          return (
                            <div key={int.id} className="p-4 rounded-lg border bg-white flex items-center justify-between">
                              <div>
                                <p className="text-xs text-gray-500 mb-1">
                                  For: {relatedGoal?.description.slice(0, 40) || 'Unknown goal'}...
                                </p>
                                <p className="font-medium text-gray-900">{int.description}</p>
                                <div className="flex items-center space-x-4 mt-2 text-sm text-gray-600">
                                  <span><Clock className="h-4 w-4 inline mr-1" />{int.frequency}</span>
                                  <span><User className="h-4 w-4 inline mr-1" />{int.responsibleParty}</span>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className={`px-2 py-1 rounded text-xs ${
                                  int.status === 'active' ? 'bg-green-100 text-green-700' :
                                  int.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {int.status}
                                </span>
                                <button
                                  onClick={() => removeIntervention(int.id)}
                                  className="text-red-600 hover:text-red-700 p-2"
                                >
                                  <Trash2 className="h-5 w-5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {interventions.length === 0 && goals.length > 0 && (
                          <div className="text-center py-8 text-gray-500">
                            <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>No interventions added yet.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Summary Tab */}
                  {activeTab === 'summary' && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-6">Care Plan Summary</h2>
                      {diagnoses.map(dx => {
                        const dxGoals = goals.filter(g => g.diagnosisId === dx.id);
                        return (
                          <div key={dx.id} className="mb-6 p-4 rounded-lg border">
                            <div className={`-mx-4 -mt-4 px-4 py-2 mb-4 rounded-t-lg ${
                              dx.priority === 'high' ? 'bg-red-100' :
                              dx.priority === 'medium' ? 'bg-yellow-100' : 'bg-green-100'
                            }`}>
                              <h3 className="font-bold">{dx.diagnosis}</h3>
                              <p className="text-sm text-gray-600">R/T {dx.relatedTo} AEB {dx.evidencedBy}</p>
                            </div>
                            {dxGoals.map(goal => {
                              const goalInts = interventions.filter(i => i.goalId === goal.id);
                              return (
                                <div key={goal.id} className="ml-4 mb-4">
                                  <div className="flex items-center space-x-2 mb-2">
                                    <ArrowRight className="h-4 w-4 text-teal-500" />
                                    <span className="font-medium">{goal.description}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(goal.status)}`}>
                                      {goal.status}
                                    </span>
                                  </div>
                                  <div className="ml-6 space-y-1">
                                    {goalInts.map(int => (
                                      <div key={int.id} className="flex items-center text-sm text-gray-600">
                                        <CheckCircle2 className="h-4 w-4 mr-2 text-teal-400" />
                                        {int.description} ({int.frequency})
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      {diagnoses.length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                          <ClipboardList className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>No care plan data to display.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Save Button */}
                <div className="p-4 border-t bg-gray-50 flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={isSubmitting || diagnoses.length === 0}
                    className="bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 disabled:opacity-50 flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Care Plan
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <ClipboardList className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-bold text-gray-700 mb-2">Select a Patient</h2>
                <p className="text-gray-500">Choose a patient from the list to create or edit their care plan.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
