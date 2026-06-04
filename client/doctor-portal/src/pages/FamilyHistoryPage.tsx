import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, getFamilyHistory, createFamilyHistory } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import PedigreeChart from '../components/PedigreeChart';
import {
  Users,
  Heart,
  AlertTriangle,
  Plus,
  Search,
  User,
  Activity,
  Droplet,
  Brain,
  Eye,
  Zap,
  FileText,
  XCircle,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

type RelationshipType =
  | 'mother'
  | 'father'
  | 'sister'
  | 'brother'
  | 'maternal-grandmother'
  | 'maternal-grandfather'
  | 'paternal-grandmother'
  | 'paternal-grandfather'
  | 'maternal-aunt'
  | 'maternal-uncle'
  | 'paternal-aunt'
  | 'paternal-uncle'
  | 'daughter'
  | 'son'
  | 'half-sister'
  | 'half-brother';

type ConditionCategory =
  | 'cardiovascular'
  | 'cancer'
  | 'diabetes'
  | 'neurological'
  | 'psychiatric'
  | 'respiratory'
  | 'autoimmune'
  | 'genetic'
  | 'blood-disorder'
  | 'kidney-disease'
  | 'liver-disease'
  | 'other';

type VitalStatus = 'alive' | 'deceased' | 'unknown';

interface FamilyCondition {
  conditionName: string;
  category: ConditionCategory;
  ageOfOnset?: number;
  severity?: 'mild' | 'moderate' | 'severe';
  notes?: string;
}

interface FamilyMember {
  memberId: string;
  patientId: string;
  patientName: string;
  relationship: RelationshipType;
  name?: string;
  vitalStatus: VitalStatus;
  ageAtDeath?: number;
  causeOfDeath?: string;
  currentAge?: number;
  conditions: FamilyCondition[];
  consanguineous?: boolean;
  notes?: string;
  recordedBy: string;
  recordedAt: string;
}

interface RiskAssessment {
  category: ConditionCategory;
  riskLevel: 'low' | 'moderate' | 'high';
  affectedRelatives: number;
  conditions: string[];
  recommendations?: string;
}

const FamilyHistoryPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'add-member' | 'risk-assessment' | 'pedigree'>('overview');
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ConditionCategory | 'all'>('all');

  const [newMember, setNewMember] = useState({
    patientId: '',
    relationship: 'mother' as RelationshipType,
    name: '',
    vitalStatus: 'alive' as VitalStatus,
    currentAge: undefined as number | undefined,
    ageAtDeath: undefined as number | undefined,
    causeOfDeath: '',
    consanguineous: false,
    notes: '',
  });

  const [newCondition, setNewCondition] = useState({
    conditionName: '',
    category: 'cardiovascular' as ConditionCategory,
    ageOfOnset: undefined as number | undefined,
    severity: 'moderate' as 'mild' | 'moderate' | 'severe',
    notes: '',
  });

  const [memberConditions, setMemberConditions] = useState<FamilyCondition[]>([]);

  useEffect(() => {
    const loadData = async () => {
      const patientData = await getPatients();
      setPatients(patientData);
    };
    loadData();
  }, []);

  // Fetch family history for selected patient
  const fetchFamilyHistory = useCallback(async (patientId: string) => {
    if (!patientId) {
      setFamilyMembers([]);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const response = await getFamilyHistory(patientId);
      if (response && typeof response === 'object') {
        const data = response as { success?: boolean; members?: FamilyMember[]; items?: FamilyMember[] };
        if (data.success && Array.isArray(data.members)) {
          setFamilyMembers(data.members);
        } else if (data.success && Array.isArray(data.items)) {
          setFamilyMembers(data.items as FamilyMember[]);
        } else if (Array.isArray(response)) {
          setFamilyMembers(response as FamilyMember[]);
        }
      }
    } catch (err) {
      console.error('Error fetching family history:', err);
      setError('Failed to load family history');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load family history when patient is selected
  useEffect(() => {
    if (selectedPatient) {
      fetchFamilyHistory(selectedPatient);
    } else {
      setFamilyMembers([]);
    }
  }, [selectedPatient, fetchFamilyHistory]);

  const handleAddMember = async () => {
    if (!newMember.patientId || !newMember.relationship) {
      showWarning('Please fill in required fields');
      return;
    }

    const patient = patients.find((p) => p.patient_id === newMember.patientId);
    if (!patient) return;

    const member: FamilyMember = {
      memberId: `FM-${String(familyMembers.length + 1).padStart(3, '0')}`,
      patientId: patient.patient_id,
      patientName: patient.full_name,
      relationship: newMember.relationship,
      name: newMember.name || undefined,
      vitalStatus: newMember.vitalStatus,
      currentAge: newMember.vitalStatus === 'alive' ? newMember.currentAge : undefined,
      ageAtDeath: newMember.vitalStatus === 'deceased' ? newMember.ageAtDeath : undefined,
      causeOfDeath: newMember.vitalStatus === 'deceased' ? newMember.causeOfDeath : undefined,
      conditions: memberConditions,
      consanguineous: newMember.consanguineous,
      notes: newMember.notes || undefined,
      recordedBy: user?.userId || 'USER-001',
      recordedAt: new Date().toISOString(),
    };

    try {
      setIsLoading(true);
      setError(null);
      const response = await createFamilyHistory(member) as { success?: boolean; error?: string };
      if (response.success !== false) {
        setFamilyMembers([member, ...familyMembers]);
        setNewMember({
          patientId: '',
          relationship: 'mother',
          name: '',
          vitalStatus: 'alive',
          currentAge: undefined,
          ageAtDeath: undefined,
          causeOfDeath: '',
          consanguineous: false,
          notes: '',
        });
        setMemberConditions([]);
        setActiveTab('overview');
        showSuccess(`Family member ${member.memberId} added successfully`);
      } else {
        setError(response.error || 'Failed to save family member');
      }
    } catch (err) {
      console.error('Error saving family member:', err);
      setError('An error occurred while saving the family member');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddCondition = () => {
    if (!newCondition.conditionName) {
      showWarning('Please enter a condition name');
      return;
    }

    const condition: FamilyCondition = {
      conditionName: newCondition.conditionName,
      category: newCondition.category,
      ageOfOnset: newCondition.ageOfOnset,
      severity: newCondition.severity,
      notes: newCondition.notes || undefined,
    };

    setMemberConditions([...memberConditions, condition]);
    setNewCondition({
      conditionName: '',
      category: 'cardiovascular',
      ageOfOnset: undefined,
      severity: 'moderate',
      notes: '',
    });
  };

  const handleRemoveCondition = (index: number) => {
    setMemberConditions(memberConditions.filter((_, i) => i !== index));
  };

  const calculateRiskAssessment = (patientId: string): RiskAssessment[] => {
    const patientMembers = familyMembers.filter((m) => m.patientId === patientId);
    const categoryMap = new Map<ConditionCategory, { conditions: Set<string>; count: number }>();

    patientMembers.forEach((member) => {
      member.conditions.forEach((condition) => {
        if (!categoryMap.has(condition.category)) {
          categoryMap.set(condition.category, { conditions: new Set(), count: 0 });
        }
        const entry = categoryMap.get(condition.category)!;
        entry.conditions.add(condition.conditionName);
        entry.count++;
      });
    });

    const assessments: RiskAssessment[] = [];
    categoryMap.forEach((value, category) => {
      let riskLevel: 'low' | 'moderate' | 'high' = 'low';
      if (value.count >= 3) riskLevel = 'high';
      else if (value.count >= 2) riskLevel = 'moderate';

      assessments.push({
        category,
        riskLevel,
        affectedRelatives: value.count,
        conditions: Array.from(value.conditions),
      });
    });

    return assessments.sort((a, b) => {
      const riskOrder = { high: 3, moderate: 2, low: 1 };
      return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
    });
  };

  const filteredMembers = familyMembers.filter((m) => {
    const matchesSearch =
      m.memberId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.relationship.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory =
      categoryFilter === 'all' || m.conditions.some((c) => c.category === categoryFilter);

    const matchesPatient = !selectedPatient || m.patientId === selectedPatient;

    return matchesSearch && matchesCategory && matchesPatient;
  });

  // Family members filtered only by selected patient (for pedigree chart)
  const patientFamilyMembers = selectedPatient
    ? familyMembers.filter((m) => m.patientId === selectedPatient)
    : [];

  const getCategoryIcon = (category: ConditionCategory) => {
    const icons = {
      cardiovascular: <Heart className="w-4 h-4" />,
      cancer: <AlertTriangle className="w-4 h-4" />,
      diabetes: <Droplet className="w-4 h-4" />,
      neurological: <Brain className="w-4 h-4" />,
      psychiatric: <Brain className="w-4 h-4" />,
      respiratory: <Activity className="w-4 h-4" />,
      autoimmune: <Zap className="w-4 h-4" />,
      genetic: <Eye className="w-4 h-4" />,
      'blood-disorder': <Droplet className="w-4 h-4" />,
      'kidney-disease': <Activity className="w-4 h-4" />,
      'liver-disease': <Activity className="w-4 h-4" />,
      other: <FileText className="w-4 h-4" />,
    };
    return icons[category];
  };

  const getCategoryColor = (category: ConditionCategory) => {
    const colors = {
      cardiovascular: 'bg-red-100 text-red-800',
      cancer: 'bg-orange-100 text-orange-800',
      diabetes: 'bg-blue-100 text-blue-800',
      neurological: 'bg-purple-100 text-purple-800',
      psychiatric: 'bg-indigo-100 text-indigo-800',
      respiratory: 'bg-cyan-100 text-cyan-800',
      autoimmune: 'bg-yellow-100 text-yellow-800',
      genetic: 'bg-pink-100 text-pink-800',
      'blood-disorder': 'bg-red-100 text-red-800',
      'kidney-disease': 'bg-teal-100 text-teal-800',
      'liver-disease': 'bg-amber-100 text-amber-800',
      other: 'bg-gray-100 text-gray-800',
    };
    return colors[category];
  };

  const getRiskColor = (risk: 'low' | 'moderate' | 'high') => {
    const colors = {
      low: 'bg-green-100 text-green-800',
      moderate: 'bg-yellow-100 text-yellow-800',
      high: 'bg-red-100 text-red-800',
    };
    return colors[risk];
  };

  const formatRelationship = (rel: string) => {
    return rel
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-pink-600 to-rose-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">Family History</h1>
        <p className="text-pink-100">Genetic and familial medical history documentation</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'overview' ? 'text-pink-700 border-b-2 border-pink-700' : 'text-gray-600 hover:text-pink-700'
          }`}
        >
          Family Members
        </button>
        <button
          onClick={() => setActiveTab('add-member')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'add-member' ? 'text-pink-700 border-b-2 border-pink-700' : 'text-gray-600 hover:text-pink-700'
          }`}
        >
          Add Family Member
        </button>
        <button
          onClick={() => setActiveTab('risk-assessment')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'risk-assessment' ? 'text-pink-700 border-b-2 border-pink-700' : 'text-gray-600 hover:text-pink-700'
          }`}
        >
          Risk Assessment
        </button>
        <button
          onClick={() => setActiveTab('pedigree')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'pedigree' ? 'text-pink-700 border-b-2 border-pink-700' : 'text-gray-600 hover:text-pink-700'
          }`}
        >
          Pedigree Chart
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="family-patient-filter" className="block text-sm font-semibold text-gray-700 mb-2">Patient Filter</label>
                <select
                  id="family-patient-filter"
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">All Patients</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="famhx-search" className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    id="famhx-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search members..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="famhx-condition-category" className="block text-sm font-semibold text-gray-700 mb-2">Condition Category</label>
                <select
                  id="famhx-condition-category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as ConditionCategory | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Categories</option>
                  <option value="cardiovascular">Cardiovascular</option>
                  <option value="cancer">Cancer</option>
                  <option value="diabetes">Diabetes</option>
                  <option value="neurological">Neurological</option>
                  <option value="psychiatric">Psychiatric</option>
                  <option value="respiratory">Respiratory</option>
                  <option value="autoimmune">Autoimmune</option>
                  <option value="genetic">Genetic</option>
                  <option value="blood-disorder">Blood Disorder</option>
                  <option value="kidney-disease">Kidney Disease</option>
                  <option value="liver-disease">Liver Disease</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {filteredMembers.map((member) => (
              <div key={member.memberId} className="border border-gray-300 rounded-lg shadow-sm bg-white p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{member.memberId}</h3>
                      <span className="px-3 py-1 bg-pink-100 text-pink-800 rounded-full text-sm font-semibold">
                        {formatRelationship(member.relationship)}
                      </span>
                      {member.vitalStatus === 'deceased' && (
                        <span className="px-3 py-1 bg-gray-200 text-gray-700 rounded-full text-sm font-semibold">
                          Deceased
                        </span>
                      )}
                      {member.consanguineous && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs font-semibold">
                          Consanguineous
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">Recorded {formatDate(member.recordedAt)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 bg-pink-50 rounded-lg p-4">
                  <div>
                    <p className="text-sm text-pink-900 font-semibold mb-1">Patient</p>
                    <p className="font-semibold text-gray-900">{member.patientName}</p>
                    <p className="text-sm text-gray-600">{member.patientId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-pink-900 font-semibold mb-1">Family Member</p>
                    <p className="font-semibold text-gray-900">{member.name || 'Not specified'}</p>
                    <p className="text-sm text-gray-600">
                      {member.vitalStatus === 'alive' && member.currentAge && `Age: ${member.currentAge}`}
                      {member.vitalStatus === 'deceased' && member.ageAtDeath && `Died at age ${member.ageAtDeath}`}
                      {member.vitalStatus === 'unknown' && 'Status unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-pink-900 font-semibold mb-1">Recorded By</p>
                    <p className="text-sm text-gray-900">{member.recordedBy}</p>
                  </div>
                </div>

                {member.vitalStatus === 'deceased' && member.causeOfDeath && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                    <p className="text-sm font-semibold text-gray-700 mb-1">Cause of Death</p>
                    <p className="text-sm text-gray-900">{member.causeOfDeath}</p>
                  </div>
                )}

                {member.conditions.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Medical Conditions ({member.conditions.length})</p>
                    <div className="space-y-2">
                      {member.conditions.map((condition, idx) => (
                        <div key={idx} className="bg-gray-50 border border-gray-200 rounded p-3">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900">{condition.conditionName}</p>
                              {condition.ageOfOnset !== undefined && (
                                <p className="text-sm text-gray-600">Age of onset: {condition.ageOfOnset} years</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getCategoryColor(condition.category)}`}>
                                {getCategoryIcon(condition.category)}
                                {condition.category.replace('-', ' ').toUpperCase()}
                              </span>
                              {condition.severity && (
                                <span
                                  className={`px-2 py-1 rounded text-xs font-semibold ${
                                    condition.severity === 'severe'
                                      ? 'bg-red-100 text-red-800'
                                      : condition.severity === 'moderate'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-green-100 text-green-800'
                                  }`}
                                >
                                  {condition.severity.toUpperCase()}
                                </span>
                              )}
                            </div>
                          </div>
                          {condition.notes && <p className="text-sm text-gray-600 italic">{condition.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {member.notes && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-blue-900 mb-1">Notes</p>
                    <p className="text-sm text-blue-800">{member.notes}</p>
                  </div>
                )}
              </div>
            ))}

            {filteredMembers.length === 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No family members found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'add-member' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add Family Member
          </h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="famhx-patient" className="block text-sm font-semibold text-gray-700 mb-2">
                  Patient <span className="text-red-600">*</span>
                </label>
                <select
                  id="famhx-patient"
                  value={newMember.patientId}
                  onChange={(e) => setNewMember({ ...newMember, patientId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">Select patient...</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="famhx-relationship" className="block text-sm font-semibold text-gray-700 mb-2">
                  Relationship <span className="text-red-600">*</span>
                </label>
                <select
                  id="famhx-relationship"
                  value={newMember.relationship}
                  onChange={(e) => setNewMember({ ...newMember, relationship: e.target.value as RelationshipType })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="mother">Mother</option>
                  <option value="father">Father</option>
                  <option value="sister">Sister</option>
                  <option value="brother">Brother</option>
                  <option value="daughter">Daughter</option>
                  <option value="son">Son</option>
                  <option value="half-sister">Half-Sister</option>
                  <option value="half-brother">Half-Brother</option>
                  <option value="maternal-grandmother">Maternal Grandmother</option>
                  <option value="maternal-grandfather">Maternal Grandfather</option>
                  <option value="paternal-grandmother">Paternal Grandmother</option>
                  <option value="paternal-grandfather">Paternal Grandfather</option>
                  <option value="maternal-aunt">Maternal Aunt</option>
                  <option value="maternal-uncle">Maternal Uncle</option>
                  <option value="paternal-aunt">Paternal Aunt</option>
                  <option value="paternal-uncle">Paternal Uncle</option>
                </select>
              </div>

              <div>
                <label htmlFor="famhx-member-name" className="block text-sm font-semibold text-gray-700 mb-2">Family Member Name</label>
                <input
                  id="famhx-member-name"
                  type="text"
                  value={newMember.name}
                  onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                  placeholder="e.g., John Smith"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="famhx-vital-status" className="block text-sm font-semibold text-gray-700 mb-2">
                  Vital Status <span className="text-red-600">*</span>
                </label>
                <select
                  id="famhx-vital-status"
                  value={newMember.vitalStatus}
                  onChange={(e) => setNewMember({ ...newMember, vitalStatus: e.target.value as VitalStatus })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="alive">Alive</option>
                  <option value="deceased">Deceased</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>

              {newMember.vitalStatus === 'alive' && (
                <div>
                  <label htmlFor="famhx-current-age" className="block text-sm font-semibold text-gray-700 mb-2">Current Age</label>
                  <input
                    id="famhx-current-age"
                    type="number"
                    min="0"
                    max="120"
                    value={newMember.currentAge || ''}
                    onChange={(e) => setNewMember({ ...newMember, currentAge: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Years"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              )}

              {newMember.vitalStatus === 'deceased' && (
                <>
                  <div>
                    <label htmlFor="famhx-age-at-death" className="block text-sm font-semibold text-gray-700 mb-2">Age at Death</label>
                    <input
                      id="famhx-age-at-death"
                      type="number"
                      min="0"
                      max="120"
                      value={newMember.ageAtDeath || ''}
                      onChange={(e) => setNewMember({ ...newMember, ageAtDeath: e.target.value ? parseInt(e.target.value) : undefined })}
                      placeholder="Years"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div className="col-span-2">
                    <label htmlFor="famhx-cause-of-death" className="block text-sm font-semibold text-gray-700 mb-2">Cause of Death</label>
                    <input
                      id="famhx-cause-of-death"
                      type="text"
                      value={newMember.causeOfDeath}
                      onChange={(e) => setNewMember({ ...newMember, causeOfDeath: e.target.value })}
                      placeholder="e.g., Myocardial infarction"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </>
              )}

              <div className="col-span-2 flex items-center gap-2">
                <input
                  id="famhx-consanguineous"
                  type="checkbox"
                  checked={newMember.consanguineous}
                  onChange={(e) => setNewMember({ ...newMember, consanguineous: e.target.checked })}
                  className="w-5 h-5"
                />
                <label htmlFor="famhx-consanguineous" className="text-sm font-semibold text-gray-700">Consanguineous relationship (blood relation between parents)</label>
              </div>

              <div className="col-span-2">
                <label htmlFor="famhx-general-notes" className="block text-sm font-semibold text-gray-700 mb-2">General Notes</label>
                <textarea
                  id="famhx-general-notes"
                  value={newMember.notes}
                  onChange={(e) => setNewMember({ ...newMember, notes: e.target.value })}
                  placeholder="Additional information about family member..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-bold mb-4">Medical Conditions</h3>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="col-span-2">
                  <label htmlFor="famhx-condition-name" className="block text-sm font-semibold text-gray-700 mb-2">Condition Name</label>
                  <input
                    id="famhx-condition-name"
                    type="text"
                    value={newCondition.conditionName}
                    onChange={(e) => setNewCondition({ ...newCondition, conditionName: e.target.value })}
                    placeholder="e.g., Hypertension"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>

                <div>
                  <label htmlFor="famhx-category" className="block text-sm font-semibold text-gray-700 mb-2">Category</label>
                  <select
                    id="famhx-category"
                    value={newCondition.category}
                    onChange={(e) => setNewCondition({ ...newCondition, category: e.target.value as ConditionCategory })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="cardiovascular">Cardiovascular</option>
                    <option value="cancer">Cancer</option>
                    <option value="diabetes">Diabetes</option>
                    <option value="neurological">Neurological</option>
                    <option value="psychiatric">Psychiatric</option>
                    <option value="respiratory">Respiratory</option>
                    <option value="autoimmune">Autoimmune</option>
                    <option value="genetic">Genetic</option>
                    <option value="blood-disorder">Blood Disorder</option>
                    <option value="kidney-disease">Kidney Disease</option>
                    <option value="liver-disease">Liver Disease</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="famhx-age-of-onset" className="block text-sm font-semibold text-gray-700 mb-2">Age of Onset</label>
                  <input
                    id="famhx-age-of-onset"
                    type="number"
                    min="0"
                    max="120"
                    value={newCondition.ageOfOnset || ''}
                    onChange={(e) => setNewCondition({ ...newCondition, ageOfOnset: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Years"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>

                <div>
                  <label htmlFor="famhx-severity" className="block text-sm font-semibold text-gray-700 mb-2">Severity</label>
                  <select
                    id="famhx-severity"
                    value={newCondition.severity}
                    onChange={(e) => setNewCondition({ ...newCondition, severity: e.target.value as 'mild' | 'moderate' | 'severe' })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="mild">Mild</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label htmlFor="famhx-condition-notes" className="block text-sm font-semibold text-gray-700 mb-2">Condition Notes</label>
                  <textarea
                    id="famhx-condition-notes"
                    value={newCondition.notes}
                    onChange={(e) => setNewCondition({ ...newCondition, notes: e.target.value })}
                    placeholder="Treatment, outcomes, etc."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    rows={2}
                  />
                </div>
              </div>

              <button
                onClick={handleAddCondition}
                className="w-full bg-pink-100 text-pink-700 px-4 py-2 rounded-lg hover:bg-pink-200 transition-colors font-semibold flex items-center justify-center gap-2 mb-4"
              >
                <Plus className="w-4 h-4" />
                Add Condition
              </button>

              {memberConditions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-700 mb-2">Added Conditions ({memberConditions.length})</p>
                  {memberConditions.map((condition, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded p-3">
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900">{condition.conditionName}</p>
                        <p className="text-sm text-gray-600">
                          {condition.category.replace('-', ' ')} • {condition.severity} severity
                          {condition.ageOfOnset !== undefined && ` • Onset: ${condition.ageOfOnset} years`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveCondition(idx)}
                        className="text-red-600 hover:text-red-800 p-2"
                      >
                        <XCircle className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleAddMember}
            className="w-full bg-pink-600 text-white px-6 py-3 rounded-lg hover:bg-pink-700 transition-colors font-semibold mt-6"
          >
            Add Family Member
          </button>
        </div>
      )}

      {activeTab === 'risk-assessment' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <label htmlFor="famhx-risk-patient" className="block text-sm font-semibold text-gray-700 mb-2">Select Patient for Risk Assessment</label>
            <select
              id="famhx-risk-patient"
              value={selectedPatient}
              onChange={(e) => setSelectedPatient(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="">Select patient...</option>
              {patients.map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.full_name} ({p.patient_id})
                </option>
              ))}
            </select>
          </div>

          {selectedPatient && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-xl font-bold mb-4">Familial Risk Assessment</h3>
              <p className="text-gray-600 mb-6">
                Based on family medical history for {patients.find((p) => p.patient_id === selectedPatient)?.full_name}
              </p>

              <div className="space-y-4">
                {calculateRiskAssessment(selectedPatient).map((assessment, idx) => (
                  <div key={idx} className="border border-gray-300 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${getCategoryColor(assessment.category)}`}>
                          {getCategoryIcon(assessment.category)}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-900 capitalize">{assessment.category.replace('-', ' ')}</h4>
                          <p className="text-sm text-gray-600">{assessment.affectedRelatives} affected relative(s)</p>
                        </div>
                      </div>
                      <span className={`px-4 py-2 rounded-full text-sm font-bold ${getRiskColor(assessment.riskLevel)}`}>
                        {assessment.riskLevel.toUpperCase()} RISK
                      </span>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-3 mb-3">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Conditions:</p>
                      <ul className="text-sm text-gray-900 space-y-1">
                        {assessment.conditions.map((condition, cidx) => (
                          <li key={cidx}>• {condition}</li>
                        ))}
                      </ul>
                    </div>

                    {assessment.riskLevel === 'high' && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <p className="text-sm font-semibold text-red-900 mb-1 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Recommendations
                        </p>
                        <p className="text-sm text-red-800">
                          Consider genetic counseling and enhanced screening protocols. Discuss preventive strategies and early detection methods.
                        </p>
                      </div>
                    )}
                    {assessment.riskLevel === 'moderate' && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <p className="text-sm font-semibold text-yellow-900 mb-1 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          Recommendations
                        </p>
                        <p className="text-sm text-yellow-800">
                          Monitor for early signs and symptoms. Consider age-appropriate screening and lifestyle modifications.
                        </p>
                      </div>
                    )}
                  </div>
                ))}

                {calculateRiskAssessment(selectedPatient).length === 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                    <p className="text-gray-600">No significant familial risk identified based on available history</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {!selectedPatient && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
              <User className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">Select a patient to generate risk assessment</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'pedigree' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-4">Pedigree Chart Visualization</h2>
          {selectedPatient ? (
            <PedigreeChart
              familyMembers={patientFamilyMembers}
              patientName={patients.find(p => p.patient_id === selectedPatient)?.full_name || 'Patient'}
              className="min-h-[500px]"
            />
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">Select a patient to view their family pedigree chart</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FamilyHistoryPage;
