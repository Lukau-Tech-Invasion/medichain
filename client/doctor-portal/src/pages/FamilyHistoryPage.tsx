import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, getFamilyHistory, createFamilyHistory, useTranslation } from '@medichain/shared';
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
  const { t } = useTranslation();
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
      setError(t('docFamilyHistory.errorLoadHistory'));
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
      showWarning(t('docFamilyHistory.warningRequiredFields'));
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
      const relationship = member.relationship
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
      const response = await createFamilyHistory({
        patient_id: member.patientId,
        family_members: [{
          relationship,
          living: member.vitalStatus === 'alive',
          current_age: member.currentAge,
          age_at_death: member.ageAtDeath,
          cause_of_death: member.causeOfDeath,
          conditions: member.conditions.map((condition) => ({
            condition: condition.conditionName,
            age_at_diagnosis: condition.ageOfOnset,
            notes: condition.notes,
          })),
        }],
        genetic_conditions: [],
        three_gen_complete: false,
        last_updated: Date.now(),
        updated_by: member.recordedBy,
      }) as { success?: boolean; error?: string };
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
        showSuccess(t('docFamilyHistory.memberAddedSuccess', { memberId: member.memberId }));
      } else {
        setError(response.error || t('docFamilyHistory.errorSaveMember'));
      }
    } catch (err) {
      console.error('Error saving family member:', err);
      setError(t('docFamilyHistory.errorSaveMemberGeneric'));
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
      cardiovascular: 'bg-critical-subtle text-critical-subtle-fg',
      cancer: 'bg-orange-100 text-orange-800',
      diabetes: 'bg-notice-subtle text-notice-subtle-fg',
      neurological: 'bg-purple-100 text-purple-800',
      psychiatric: 'bg-indigo-100 text-indigo-800',
      respiratory: 'bg-cyan-100 text-cyan-800',
      autoimmune: 'bg-caution-subtle text-caution-subtle-fg',
      genetic: 'bg-pink-100 text-pink-800',
      'blood-disorder': 'bg-critical-subtle text-critical-subtle-fg',
      'kidney-disease': 'bg-teal-100 text-teal-800',
      'liver-disease': 'bg-caution-subtle text-caution-subtle-fg',
      other: 'bg-surface-sunken text-content-secondary',
    };
    return colors[category];
  };

  const getRiskColor = (risk: 'low' | 'moderate' | 'high') => {
    const colors = {
      low: 'bg-ok-subtle text-ok-subtle-fg',
      moderate: 'bg-caution-subtle text-caution-subtle-fg',
      high: 'bg-critical-subtle text-critical-subtle-fg',
    };
    return colors[risk];
  };

  const formatRelationship = (rel: string) => {
    return t(`docFamilyHistory.relationship_${rel}`);
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-pink-600 to-rose-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">{t('docFamilyHistory.title')}</h1>
        <p className="text-pink-100">{t('docFamilyHistory.subtitle')}</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'overview' ? 'text-pink-700 border-b-2 border-pink-700' : 'text-content-muted hover:text-pink-700'
          }`}
        >
          {t('docFamilyHistory.tabMembers')}
        </button>
        <button
          onClick={() => setActiveTab('add-member')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'add-member' ? 'text-pink-700 border-b-2 border-pink-700' : 'text-content-muted hover:text-pink-700'
          }`}
        >
          {t('docFamilyHistory.tabAddMember')}
        </button>
        <button
          onClick={() => setActiveTab('risk-assessment')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'risk-assessment' ? 'text-pink-700 border-b-2 border-pink-700' : 'text-content-muted hover:text-pink-700'
          }`}
        >
          {t('docFamilyHistory.tabRiskAssessment')}
        </button>
        <button
          onClick={() => setActiveTab('pedigree')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'pedigree' ? 'text-pink-700 border-b-2 border-pink-700' : 'text-content-muted hover:text-pink-700'
          }`}
        >
          {t('docFamilyHistory.tabPedigree')}
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="family-patient-filter" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.patientFilterLabel')}</label>
                <select
                  id="family-patient-filter"
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="">{t('docFamilyHistory.allPatients')}</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="famhx-search" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.searchLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input
                    id="famhx-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docFamilyHistory.searchPlaceholder')}
                    className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="famhx-condition-category" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.conditionCategoryLabel')}</label>
                <select
                  id="famhx-condition-category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as ConditionCategory | 'all')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docFamilyHistory.allCategories')}</option>
                  <option value="cardiovascular">{t('docFamilyHistory.category_cardiovascular')}</option>
                  <option value="cancer">{t('docFamilyHistory.category_cancer')}</option>
                  <option value="diabetes">{t('docFamilyHistory.category_diabetes')}</option>
                  <option value="neurological">{t('docFamilyHistory.category_neurological')}</option>
                  <option value="psychiatric">{t('docFamilyHistory.category_psychiatric')}</option>
                  <option value="respiratory">{t('docFamilyHistory.category_respiratory')}</option>
                  <option value="autoimmune">{t('docFamilyHistory.category_autoimmune')}</option>
                  <option value="genetic">{t('docFamilyHistory.category_genetic')}</option>
                  <option value="blood-disorder">{t('docFamilyHistory.category_blood-disorder')}</option>
                  <option value="kidney-disease">{t('docFamilyHistory.category_kidney-disease')}</option>
                  <option value="liver-disease">{t('docFamilyHistory.category_liver-disease')}</option>
                  <option value="other">{t('docFamilyHistory.category_other')}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {filteredMembers.map((member) => (
              <div key={member.memberId} className="border border-border-strong rounded-lg shadow-sm bg-surface p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-content">{member.memberId}</h3>
                      <span className="px-3 py-1 bg-pink-100 text-pink-800 rounded-full text-sm font-semibold">
                        {formatRelationship(member.relationship)}
                      </span>
                      {member.vitalStatus === 'deceased' && (
                        <span className="px-3 py-1 bg-surface-sunken text-content-secondary rounded-full text-sm font-semibold">
                          {t('docFamilyHistory.deceasedBadge')}
                        </span>
                      )}
                      {member.consanguineous && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs font-semibold">
                          {t('docFamilyHistory.consanguineousBadge')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-content-muted">{t('docFamilyHistory.recordedOn', { date: formatDate(member.recordedAt) })}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 bg-pink-50 rounded-lg p-4">
                  <div>
                    <p className="text-sm text-pink-900 font-semibold mb-1">{t('docFamilyHistory.patientLabel')}</p>
                    <p className="font-semibold text-content">{member.patientName}</p>
                    <p className="text-sm text-content-muted">{member.patientId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-pink-900 font-semibold mb-1">{t('docFamilyHistory.familyMemberLabel')}</p>
                    <p className="font-semibold text-content">{member.name || t('docFamilyHistory.notSpecified')}</p>
                    <p className="text-sm text-content-muted">
                      {member.vitalStatus === 'alive' && member.currentAge && t('docFamilyHistory.ageLine', { age: member.currentAge })}
                      {member.vitalStatus === 'deceased' && member.ageAtDeath && t('docFamilyHistory.diedAtAge', { age: member.ageAtDeath })}
                      {member.vitalStatus === 'unknown' && t('docFamilyHistory.statusUnknown')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-pink-900 font-semibold mb-1">{t('docFamilyHistory.recordedByLabel')}</p>
                    <p className="text-sm text-content">{member.recordedBy}</p>
                  </div>
                </div>

                {member.vitalStatus === 'deceased' && member.causeOfDeath && (
                  <div className="bg-surface-sunken border border-border rounded-lg p-3 mb-4">
                    <p className="text-sm font-semibold text-content-secondary mb-1">{t('docFamilyHistory.causeOfDeathLabel')}</p>
                    <p className="text-sm text-content">{member.causeOfDeath}</p>
                  </div>
                )}

                {member.conditions.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.medicalConditionsCount', { count: member.conditions.length })}</p>
                    <div className="space-y-2">
                      {member.conditions.map((condition, idx) => (
                        <div key={idx} className="bg-surface-sunken border border-border rounded p-3">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <p className="font-semibold text-content">{condition.conditionName}</p>
                              {condition.ageOfOnset !== undefined && (
                                <p className="text-sm text-content-muted">{t('docFamilyHistory.ageOfOnsetYears', { age: condition.ageOfOnset })}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getCategoryColor(condition.category)}`}>
                                {getCategoryIcon(condition.category)}
                                {t(`docFamilyHistory.category_${condition.category}`).toUpperCase()}
                              </span>
                              {condition.severity && (
                                <span
                                  className={`px-2 py-1 rounded text-xs font-semibold ${
                                    condition.severity === 'severe'
                                      ? 'bg-critical-subtle text-critical-subtle-fg'
                                      : condition.severity === 'moderate'
                                      ? 'bg-caution-subtle text-caution-subtle-fg'
                                      : 'bg-ok-subtle text-ok-subtle-fg'
                                  }`}
                                >
                                  {t(`docFamilyHistory.severity_${condition.severity}`).toUpperCase()}
                                </span>
                              )}
                            </div>
                          </div>
                          {condition.notes && <p className="text-sm text-content-muted italic">{condition.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {member.notes && (
                  <div className="bg-notice-subtle border border-notice rounded-lg p-3">
                    <p className="text-sm font-semibold text-notice-subtle-fg mb-1">{t('docFamilyHistory.notesLabel')}</p>
                    <p className="text-sm text-notice-subtle-fg">{member.notes}</p>
                  </div>
                )}
              </div>
            ))}

            {filteredMembers.length === 0 && (
              <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
                <Users className="w-12 h-12 text-content-muted mx-auto mb-3" />
                <p className="text-content-muted">{t('docFamilyHistory.noMembersFound')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'add-member' && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            {t('docFamilyHistory.addFamilyMember')}
          </h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="famhx-patient" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docFamilyHistory.patientRequired')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="famhx-patient"
                  value={newMember.patientId}
                  onChange={(e) => setNewMember({ ...newMember, patientId: e.target.value })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="">{t('docFamilyHistory.selectPatientPlaceholder')}</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="famhx-relationship" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docFamilyHistory.relationshipRequired')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="famhx-relationship"
                  value={newMember.relationship}
                  onChange={(e) => setNewMember({ ...newMember, relationship: e.target.value as RelationshipType })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="mother">{t('docFamilyHistory.relationship_mother')}</option>
                  <option value="father">{t('docFamilyHistory.relationship_father')}</option>
                  <option value="sister">{t('docFamilyHistory.relationship_sister')}</option>
                  <option value="brother">{t('docFamilyHistory.relationship_brother')}</option>
                  <option value="daughter">{t('docFamilyHistory.relationship_daughter')}</option>
                  <option value="son">{t('docFamilyHistory.relationship_son')}</option>
                  <option value="half-sister">{t('docFamilyHistory.relationship_half-sister')}</option>
                  <option value="half-brother">{t('docFamilyHistory.relationship_half-brother')}</option>
                  <option value="maternal-grandmother">{t('docFamilyHistory.relationship_maternal-grandmother')}</option>
                  <option value="maternal-grandfather">{t('docFamilyHistory.relationship_maternal-grandfather')}</option>
                  <option value="paternal-grandmother">{t('docFamilyHistory.relationship_paternal-grandmother')}</option>
                  <option value="paternal-grandfather">{t('docFamilyHistory.relationship_paternal-grandfather')}</option>
                  <option value="maternal-aunt">{t('docFamilyHistory.relationship_maternal-aunt')}</option>
                  <option value="maternal-uncle">{t('docFamilyHistory.relationship_maternal-uncle')}</option>
                  <option value="paternal-aunt">{t('docFamilyHistory.relationship_paternal-aunt')}</option>
                  <option value="paternal-uncle">{t('docFamilyHistory.relationship_paternal-uncle')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="famhx-member-name" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.familyMemberNameLabel')}</label>
                <input
                  id="famhx-member-name"
                  type="text"
                  value={newMember.name}
                  onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                  placeholder={t('docFamilyHistory.familyMemberNamePh')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="famhx-vital-status" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docFamilyHistory.vitalStatusRequired')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="famhx-vital-status"
                  value={newMember.vitalStatus}
                  onChange={(e) => setNewMember({ ...newMember, vitalStatus: e.target.value as VitalStatus })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="alive">{t('docFamilyHistory.vitalStatus_alive')}</option>
                  <option value="deceased">{t('docFamilyHistory.vitalStatus_deceased')}</option>
                  <option value="unknown">{t('docFamilyHistory.vitalStatus_unknown')}</option>
                </select>
              </div>

              {newMember.vitalStatus === 'alive' && (
                <div>
                  <label htmlFor="famhx-current-age" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.currentAgeLabel')}</label>
                  <input
                    id="famhx-current-age"
                    type="number"
                    min="0"
                    max="120"
                    value={newMember.currentAge || ''}
                    onChange={(e) => setNewMember({ ...newMember, currentAge: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder={t('docFamilyHistory.yearsPlaceholder')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              )}

              {newMember.vitalStatus === 'deceased' && (
                <>
                  <div>
                    <label htmlFor="famhx-age-at-death" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.ageAtDeathLabel')}</label>
                    <input
                      id="famhx-age-at-death"
                      type="number"
                      min="0"
                      max="120"
                      value={newMember.ageAtDeath || ''}
                      onChange={(e) => setNewMember({ ...newMember, ageAtDeath: e.target.value ? parseInt(e.target.value) : undefined })}
                      placeholder={t('docFamilyHistory.yearsPlaceholder')}
                      className="w-full border border-border-strong rounded-lg px-3 py-2"
                    />
                  </div>
                  <div className="col-span-2">
                    <label htmlFor="famhx-cause-of-death" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.causeOfDeathLabel')}</label>
                    <input
                      id="famhx-cause-of-death"
                      type="text"
                      value={newMember.causeOfDeath}
                      onChange={(e) => setNewMember({ ...newMember, causeOfDeath: e.target.value })}
                      placeholder={t('docFamilyHistory.causeOfDeathPh')}
                      className="w-full border border-border-strong rounded-lg px-3 py-2"
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
                <label htmlFor="famhx-consanguineous" className="text-sm font-semibold text-content-secondary">{t('docFamilyHistory.consanguineousCheckbox')}</label>
              </div>

              <div className="col-span-2">
                <label htmlFor="famhx-general-notes" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.generalNotesLabel')}</label>
                <textarea
                  id="famhx-general-notes"
                  value={newMember.notes}
                  onChange={(e) => setNewMember({ ...newMember, notes: e.target.value })}
                  placeholder={t('docFamilyHistory.generalNotesPh')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-bold mb-4">{t('docFamilyHistory.medicalConditionsTitle')}</h3>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="col-span-2">
                  <label htmlFor="famhx-condition-name" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.conditionNameLabel')}</label>
                  <input
                    id="famhx-condition-name"
                    type="text"
                    value={newCondition.conditionName}
                    onChange={(e) => setNewCondition({ ...newCondition, conditionName: e.target.value })}
                    placeholder={t('docFamilyHistory.conditionNamePh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>

                <div>
                  <label htmlFor="famhx-category" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.categoryLabel')}</label>
                  <select
                    id="famhx-category"
                    value={newCondition.category}
                    onChange={(e) => setNewCondition({ ...newCondition, category: e.target.value as ConditionCategory })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  >
                    <option value="cardiovascular">{t('docFamilyHistory.category_cardiovascular')}</option>
                    <option value="cancer">{t('docFamilyHistory.category_cancer')}</option>
                    <option value="diabetes">{t('docFamilyHistory.category_diabetes')}</option>
                    <option value="neurological">{t('docFamilyHistory.category_neurological')}</option>
                    <option value="psychiatric">{t('docFamilyHistory.category_psychiatric')}</option>
                    <option value="respiratory">{t('docFamilyHistory.category_respiratory')}</option>
                    <option value="autoimmune">{t('docFamilyHistory.category_autoimmune')}</option>
                    <option value="genetic">{t('docFamilyHistory.category_genetic')}</option>
                    <option value="blood-disorder">{t('docFamilyHistory.category_blood-disorder')}</option>
                    <option value="kidney-disease">{t('docFamilyHistory.category_kidney-disease')}</option>
                    <option value="liver-disease">{t('docFamilyHistory.category_liver-disease')}</option>
                    <option value="other">{t('docFamilyHistory.category_other')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="famhx-age-of-onset" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.ageOfOnsetLabel')}</label>
                  <input
                    id="famhx-age-of-onset"
                    type="number"
                    min="0"
                    max="120"
                    value={newCondition.ageOfOnset || ''}
                    onChange={(e) => setNewCondition({ ...newCondition, ageOfOnset: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder={t('docFamilyHistory.yearsPlaceholder')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>

                <div>
                  <label htmlFor="famhx-severity" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.severityLabel')}</label>
                  <select
                    id="famhx-severity"
                    value={newCondition.severity}
                    onChange={(e) => setNewCondition({ ...newCondition, severity: e.target.value as 'mild' | 'moderate' | 'severe' })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  >
                    <option value="mild">{t('docFamilyHistory.severity_mild')}</option>
                    <option value="moderate">{t('docFamilyHistory.severity_moderate')}</option>
                    <option value="severe">{t('docFamilyHistory.severity_severe')}</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label htmlFor="famhx-condition-notes" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.conditionNotesLabel')}</label>
                  <textarea
                    id="famhx-condition-notes"
                    value={newCondition.notes}
                    onChange={(e) => setNewCondition({ ...newCondition, notes: e.target.value })}
                    placeholder={t('docFamilyHistory.conditionNotesPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    rows={2}
                  />
                </div>
              </div>

              <button
                onClick={handleAddCondition}
                className="w-full bg-pink-100 text-pink-700 px-4 py-2 rounded-lg hover:bg-pink-200 transition-colors font-semibold flex items-center justify-center gap-2 mb-4"
              >
                <Plus className="w-4 h-4" />
                {t('docFamilyHistory.addCondition')}
              </button>

              {memberConditions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.addedConditionsCount', { count: memberConditions.length })}</p>
                  {memberConditions.map((condition, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-surface-sunken border border-border rounded p-3">
                      <div className="flex-1">
                        <p className="font-semibold text-content">{condition.conditionName}</p>
                        <p className="text-sm text-content-muted">
                          {t('docFamilyHistory.conditionSummaryLine', { category: t(`docFamilyHistory.category_${condition.category}`), severity: t(`docFamilyHistory.severity_${condition.severity}`) })}
                          {condition.ageOfOnset !== undefined && t('docFamilyHistory.onsetYearsSuffix', { age: condition.ageOfOnset })}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveCondition(idx)}
                        className="text-critical-subtle-fg hover:text-critical-subtle-fg p-2"
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
            {t('docFamilyHistory.addFamilyMember')}
          </button>
        </div>
      )}

      {activeTab === 'risk-assessment' && (
        <div className="space-y-4">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <label htmlFor="famhx-risk-patient" className="block text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.selectPatientRiskLabel')}</label>
            <select
              id="famhx-risk-patient"
              value={selectedPatient}
              onChange={(e) => setSelectedPatient(e.target.value)}
              className="w-full border border-border-strong rounded-lg px-3 py-2"
            >
              <option value="">{t('docFamilyHistory.selectPatientPlaceholder')}</option>
              {patients.map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.full_name} ({p.patient_id})
                </option>
              ))}
            </select>
          </div>

          {selectedPatient && (
            <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
              <h3 className="text-xl font-bold mb-4">{t('docFamilyHistory.familialRiskAssessmentTitle')}</h3>
              <p className="text-content-muted mb-6">
                {t('docFamilyHistory.basedOnHistoryFor', { name: patients.find((p) => p.patient_id === selectedPatient)?.full_name || '' })}
              </p>

              <div className="space-y-4">
                {calculateRiskAssessment(selectedPatient).map((assessment, idx) => (
                  <div key={idx} className="border border-border-strong rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${getCategoryColor(assessment.category)}`}>
                          {getCategoryIcon(assessment.category)}
                        </div>
                        <div>
                          <h4 className="font-bold text-content">{t(`docFamilyHistory.category_${assessment.category}`)}</h4>
                          <p className="text-sm text-content-muted">{t('docFamilyHistory.affectedRelativesCount', { count: assessment.affectedRelatives })}</p>
                        </div>
                      </div>
                      <span className={`px-4 py-2 rounded-full text-sm font-bold ${getRiskColor(assessment.riskLevel)}`}>
                        {t('docFamilyHistory.riskBadge', { level: t(`docFamilyHistory.riskLevel_${assessment.riskLevel}`) })}
                      </span>
                    </div>

                    <div className="bg-surface-sunken rounded-lg p-3 mb-3">
                      <p className="text-sm font-semibold text-content-secondary mb-2">{t('docFamilyHistory.conditionsLabel')}</p>
                      <ul className="text-sm text-content space-y-1">
                        {assessment.conditions.map((condition, cidx) => (
                          <li key={cidx}>• {condition}</li>
                        ))}
                      </ul>
                    </div>

                    {assessment.riskLevel === 'high' && (
                      <div className="bg-critical-subtle border border-critical rounded-lg p-3">
                        <p className="text-sm font-semibold text-critical-subtle-fg mb-1 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          {t('docFamilyHistory.recommendationsLabel')}
                        </p>
                        <p className="text-sm text-critical-subtle-fg">
                          {t('docFamilyHistory.highRiskRecommendation')}
                        </p>
                      </div>
                    )}
                    {assessment.riskLevel === 'moderate' && (
                      <div className="bg-caution-subtle border border-caution rounded-lg p-3">
                        <p className="text-sm font-semibold text-caution-subtle-fg mb-1 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          {t('docFamilyHistory.recommendationsLabel')}
                        </p>
                        <p className="text-sm text-caution-subtle-fg">
                          {t('docFamilyHistory.moderateRiskRecommendation')}
                        </p>
                      </div>
                    )}
                  </div>
                ))}

                {calculateRiskAssessment(selectedPatient).length === 0 && (
                  <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                    <p className="text-content-muted">{t('docFamilyHistory.noRiskIdentified')}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {!selectedPatient && (
            <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
              <User className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">{t('docFamilyHistory.selectPatientForRisk')}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'pedigree' && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold mb-4">{t('docFamilyHistory.pedigreeChartTitle')}</h2>
          {selectedPatient ? (
            <PedigreeChart
              familyMembers={patientFamilyMembers}
              patientName={patients.find(p => p.patient_id === selectedPatient)?.full_name || t('docFamilyHistory.patientFallback')}
              className="min-h-[500px]"
            />
          ) : (
            <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
              <Users className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">{t('docFamilyHistory.selectPatientForPedigree')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FamilyHistoryPage;
