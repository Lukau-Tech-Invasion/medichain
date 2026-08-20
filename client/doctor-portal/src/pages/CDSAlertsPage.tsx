import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { listCdsAlerts, apiUrl, useTranslation } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import {
  Bell,
  AlertTriangle,
  Plus,
  Search,
  Trash2,
  Power,
  PowerOff,
  Filter,
  Copy,
  Download,
  Shield,
  Activity,
  FileText,
  Clock,
  User,
  Code,
  ChevronDown,
  ChevronUp,
  Save,
  X,
} from 'lucide-react';

/**
 * CDSAlertsPage - Part 1
 * 
 * Clinical Decision Support (CDS) rule configuration system
 * Allows admins and clinical leads to create, manage, and monitor CDS alert rules
 */

// Type Aliases
type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type AlertCategory = 'medication' | 'allergy' | 'vital_signs' | 'lab_results' | 'diagnosis' | 'procedure' | 'clinical_pathway';
type AlertStatus = 'active' | 'inactive' | 'testing' | 'draft';
type TriggerType = 'threshold' | 'pattern' | 'time_based' | 'interaction' | 'contraindication';
type ActionType = 'alert' | 'block' | 'recommend' | 'notify' | 'escalate';

// Interfaces
interface Condition {
  conditionId: string;
  field: string; // e.g., 'blood_pressure_systolic', 'heart_rate', 'medication', 'allergy'
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'greater_or_equal' | 'less_or_equal' | 'contains' | 'not_contains' | 'in_range' | 'out_of_range';
  value: string | number;
  secondValue?: number; // For range operators
  logicalOperator?: 'AND' | 'OR'; // How this condition combines with the next
}

interface Action {
  actionId: string;
  type: ActionType;
  message: string;
  severity: AlertSeverity;
  notifyRoles?: string[]; // Roles to notify (e.g., ['doctor', 'nurse', 'pharmacist'])
  blockAction?: boolean; // Whether to block the action that triggered this
  suggestedAction?: string; // Recommended alternative action
  escalateTo?: string; // User ID or role to escalate to
}

interface CDSRule {
  ruleId: string;
  name: string;
  category: AlertCategory;
  description: string;
  severity: AlertSeverity;
  triggerType: TriggerType;
  conditions: Condition[];
  actions: Action[];
  status: AlertStatus;
  priority: number; // 1-10, higher = more important
  createdBy: string;
  createdAt: string;
  lastModified: string;
  lastTriggered?: string;
  triggerCount: number;
  isEnabled: boolean;
  testMode: boolean; // If true, log but don't actually trigger
  targetRoles?: string[]; // Who can see this alert
  evidenceLevel?: string; // Level of evidence supporting this rule (A, B, C)
  references?: string[]; // Medical literature references
}

const CDSAlertsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  // State Management
  const [rules, setRules] = useState<CDSRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'create' | 'analytics'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AlertCategory | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AlertStatus | 'all'>('all');
  const [_selectedRule, _setSelectedRule] = useState<CDSRule | null>(null);
  const [_showEditModal, _setShowEditModal] = useState(false);
  const [_showDetailsModal, _setShowDetailsModal] = useState(false);
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

  // New Rule Form State
  const [newRule, setNewRule] = useState<Partial<CDSRule>>({
    name: '',
    category: 'medication',
    description: '',
    severity: 'medium',
    triggerType: 'threshold',
    conditions: [],
    actions: [],
    status: 'draft',
    priority: 5,
    isEnabled: false,
    testMode: true,
    targetRoles: ['doctor', 'nurse'],
    evidenceLevel: 'B',
    references: [],
  });

  const [newCondition, setNewCondition] = useState<Partial<Condition>>({
    field: '',
    operator: 'equals',
    value: '',
    logicalOperator: 'AND',
  });

  const [newAction, setNewAction] = useState<Partial<Action>>({
    type: 'alert',
    message: '',
    severity: 'medium',
    notifyRoles: ['doctor'],
    blockAction: false,
  });

  // Fetch CDS rules from API
  const fetchRules = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await listCdsAlerts();
      if (response.success && Array.isArray(response.items)) {
        setRules(response.items as CDSRule[]);
      }
    } catch (err) {
      console.error('Error fetching CDS rules:', err);
      setError(t('docCDS.errorLoadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load CDS rules on mount
  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Handler Functions
  const { showSuccess, showError, showWarning } = useToastActions();

  const handleCreateRule = () => {
    if (!newRule.name || !newRule.description || !newRule.conditions?.length || !newRule.actions?.length) {
      showError(t('docCDS.errorRequiredFieldsRule'));
      return;
    }

    const ruleId = `CDS-${String(rules.length + 1).padStart(3, '0')}`;
    const rule: CDSRule = {
      ruleId,
      name: newRule.name,
      category: newRule.category || 'medication',
      description: newRule.description,
      severity: newRule.severity || 'medium',
      triggerType: newRule.triggerType || 'threshold',
      conditions: newRule.conditions || [],
      actions: newRule.actions || [],
      status: newRule.status || 'draft',
      priority: newRule.priority || 5,
      createdBy: user?.userId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      triggerCount: 0,
      isEnabled: newRule.isEnabled || false,
      testMode: newRule.testMode !== undefined ? newRule.testMode : true,
      targetRoles: newRule.targetRoles || ['doctor'],
      evidenceLevel: newRule.evidenceLevel || undefined,
      references: newRule.references || [],
    };

    setRules([...rules, rule]);
    setNewRule({
      name: '',
      category: 'medication',
      description: '',
      severity: 'medium',
      triggerType: 'threshold',
      conditions: [],
      actions: [],
      status: 'draft',
      priority: 5,
      isEnabled: false,
      testMode: true,
      targetRoles: ['doctor', 'nurse'],
      evidenceLevel: 'B',
      references: [],
    });
    setActiveTab('all');
    showSuccess(t('docCDS.successRuleCreated', { name: rule.name }));
  };

  const handleAddCondition = () => {
    if (!newCondition.field || !newCondition.operator || newCondition.value === undefined || newCondition.value === '') {
      showError(t('docCDS.errorRequiredCondition'));
      return;
    }

    const conditionId = `COND-NEW-${(newRule.conditions?.length || 0) + 1}`;
    const condition: Condition = {
      conditionId,
      field: newCondition.field!,
      operator: newCondition.operator!,
      value: newCondition.value!,
      secondValue: newCondition.secondValue,
      logicalOperator: newCondition.logicalOperator || 'AND',
    };

    setNewRule({
      ...newRule,
      conditions: [...(newRule.conditions || []), condition],
    });

    setNewCondition({
      field: '',
      operator: 'equals',
      value: '',
      logicalOperator: 'AND',
    });
  };

  const handleRemoveCondition = (conditionId: string) => {
    setNewRule({
      ...newRule,
      conditions: newRule.conditions?.filter(c => c.conditionId !== conditionId) || [],
    });
  };

  const handleAddAction = () => {
    if (!newAction.message) {
      showError(t('docCDS.errorRequiredActionMessage'));
      return;
    }

    const actionId = `ACT-NEW-${(newRule.actions?.length || 0) + 1}`;
    const action: Action = {
      actionId,
      type: newAction.type || 'alert',
      message: newAction.message,
      severity: newAction.severity || 'medium',
      notifyRoles: newAction.notifyRoles || ['doctor'],
      blockAction: newAction.blockAction || false,
      suggestedAction: newAction.suggestedAction,
      escalateTo: newAction.escalateTo,
    };

    setNewRule({
      ...newRule,
      actions: [...(newRule.actions || []), action],
    });

    setNewAction({
      type: 'alert',
      message: '',
      severity: 'medium',
      notifyRoles: ['doctor'],
      blockAction: false,
    });
  };

  const handleRemoveAction = (actionId: string) => {
    setNewRule({
      ...newRule,
      actions: newRule.actions?.filter(a => a.actionId !== actionId) || [],
    });
  };

  const handleToggleRule = async (ruleId: string) => {
    setRules(rules.map(r =>
      r.ruleId === ruleId
        ? { ...r, isEnabled: !r.isEnabled, lastModified: new Date().toISOString() }
        : r
    ));
    // Also call the API to respond/update the alert status
    if (user) {
      try {
        const rule = rules.find(r => r.ruleId === ruleId);
        await fetch(apiUrl(`/api/cds/alerts/${ruleId}/respond`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
          body: JSON.stringify({
            action: rule?.isEnabled ? 'deactivate' : 'activate',
            responded_by: user.userId,
            responded_at: new Date().toISOString(),
          }),
        });
      } catch (e) {
        console.error('Failed to respond to CDS alert:', e);
      }
    }
  };

  const handleDuplicateRule = (rule: CDSRule) => {
    const newRuleId = `CDS-${String(rules.length + 1).padStart(3, '0')}`;
    const duplicatedRule: CDSRule = {
      ...rule,
      ruleId: newRuleId,
      name: `${rule.name} (Copy)`,
      status: 'draft',
      isEnabled: false,
      testMode: true,
      createdBy: user?.userId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      triggerCount: 0,
      lastTriggered: undefined,
    };
    setRules([...rules, duplicatedRule]);
    showSuccess(t('docCDS.successRuleDuplicated', { name: duplicatedRule.name }));
  };

  const handleDeleteRule = (ruleId: string) => {
    if (confirm(t('docCDS.confirmDeleteRule'))) {
      setRules(rules.filter(r => r.ruleId !== ruleId));
    }
  };

  const handleExportRule = (rule: CDSRule) => {
    const dataStr = JSON.stringify(rule, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${rule.ruleId}_${rule.name.replace(/\s+/g, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const toggleRuleExpansion = (ruleId: string) => {
    setExpandedRules(prev => {
      const newSet = new Set(prev);
      if (newSet.has(ruleId)) {
        newSet.delete(ruleId);
      } else {
        newSet.add(ruleId);
      }
      return newSet;
    });
  };

  // Helper Functions
  const _getCategoryIcon = (category: AlertCategory) => {
    const icons = {
      medication: <Shield className="w-5 h-5" />,
      allergy: <AlertTriangle className="w-5 h-5" />,
      vital_signs: <Activity className="w-5 h-5" />,
      lab_results: <FileText className="w-5 h-5" />,
      diagnosis: <FileText className="w-5 h-5" />,
      procedure: <Activity className="w-5 h-5" />,
      clinical_pathway: <FileText className="w-5 h-5" />,
    };
    return icons[category];
  };

  const getSeverityBadge = (severity: AlertSeverity) => {
    const badges = {
      critical: 'bg-critical-subtle text-critical-subtle-fg',
      high: 'bg-orange-100 text-orange-800',
      medium: 'bg-caution-subtle text-caution-subtle-fg',
      low: 'bg-notice-subtle text-notice-subtle-fg',
      info: 'bg-surface-sunken text-content-secondary',
    };
    return badges[severity];
  };

  const getStatusBadge = (status: AlertStatus) => {
    const badges = {
      active: 'bg-ok-subtle text-ok-subtle-fg',
      inactive: 'bg-surface-sunken text-content-secondary',
      testing: 'bg-purple-100 text-purple-800',
      draft: 'bg-caution-subtle text-caution-subtle-fg',
    };
    return badges[status];
  };

  const getCategoryBadge = (category: AlertCategory) => {
    const badges = {
      medication: 'bg-notice-subtle text-notice-subtle-fg',
      allergy: 'bg-critical-subtle text-critical-subtle-fg',
      vital_signs: 'bg-ok-subtle text-ok-subtle-fg',
      lab_results: 'bg-purple-100 text-purple-800',
      diagnosis: 'bg-indigo-100 text-indigo-800',
      procedure: 'bg-pink-100 text-pink-800',
      clinical_pathway: 'bg-teal-100 text-teal-800',
    };
    return badges[category];
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const getOperatorLabel = (operator: Condition['operator']) => {
    return t(`docCDS.op_${operator}`);
  };

  // Filtered Rules
  const filteredRules = rules.filter(rule => {
    const matchesSearch =
      searchTerm === '' ||
      rule.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rule.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rule.ruleId.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = categoryFilter === 'all' || rule.category === categoryFilter;
    const matchesSeverity = severityFilter === 'all' || rule.severity === severityFilter;
    const matchesStatus = statusFilter === 'all' || rule.status === statusFilter;

    return matchesSearch && matchesCategory && matchesSeverity && matchesStatus;
  });

  // ===== PART 1 COMPLETE =====
  // Part 2 will add the complete UI implementation

  return (
    <div className="p-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-lg shadow-lg p-6 mb-6 text-white">
        <div className="flex items-center gap-4">
          <Bell className="w-12 h-12" />
          <div>
            <h1 className="text-3xl font-bold">{t('docCDS.title')}</h1>
            <p className="text-red-100 mt-1">{t('docCDS.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'all'
              ? 'border-b-2 border-red-600 text-critical-subtle-fg'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docCDS.tabAllRules', { count: rules.length })}
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'create'
              ? 'border-b-2 border-red-600 text-critical-subtle-fg'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docCDS.tabCreateRule')}
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'analytics'
              ? 'border-b-2 border-red-600 text-critical-subtle-fg'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docCDS.tabAnalytics')}
        </button>
      </div>

      {/* All Rules Tab */}
      {activeTab === 'all' && (
        <div>
          {/* Filters */}
          <div className="bg-surface rounded-lg shadow p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Search */}
              <div className="md:col-span-2 relative">
                <label htmlFor="cds-search" className="sr-only">{t('docCDS.searchRulesSr')}</label>
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                <input
                  id="cds-search"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('docCDS.searchPh')}
                  className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              {/* Category Filter */}
              <div>
                <label htmlFor="cds-category-filter" className="sr-only">{t('docCDS.filterCategorySr')}</label>
                <select
                  id="cds-category-filter"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as AlertCategory | 'all')}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="all">{t('docCDS.filterAllCategories')}</option>
                  <option value="medication">{t('docCDS.category_medication')}</option>
                  <option value="allergy">{t('docCDS.category_allergy')}</option>
                  <option value="vital_signs">{t('docCDS.category_vital_signs')}</option>
                  <option value="lab_results">{t('docCDS.category_lab_results')}</option>
                  <option value="diagnosis">{t('docCDS.category_diagnosis')}</option>
                  <option value="procedure">{t('docCDS.category_procedure')}</option>
                  <option value="clinical_pathway">{t('docCDS.category_clinical_pathway')}</option>
                </select>
              </div>

              {/* Severity Filter */}
              <div>
                <label htmlFor="cds-severity-filter" className="sr-only">{t('docCDS.filterSeveritySr')}</label>
                <select
                  id="cds-severity-filter"
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as AlertSeverity | 'all')}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="all">{t('docCDS.filterAllSeverities')}</option>
                  <option value="critical">{t('docCDS.severity_critical')}</option>
                  <option value="high">{t('docCDS.severity_high')}</option>
                  <option value="medium">{t('docCDS.severity_medium')}</option>
                  <option value="low">{t('docCDS.severity_low')}</option>
                  <option value="info">{t('docCDS.severity_info')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
              {/* Status Filter */}
              <div>
                <label htmlFor="cds-status-filter" className="sr-only">{t('docCDS.filterStatusSr')}</label>
                <select
                  id="cds-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AlertStatus | 'all')}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="all">{t('docCDS.filterAllStatuses')}</option>
                  <option value="active">{t('docCDS.status_active')}</option>
                  <option value="inactive">{t('docCDS.status_inactive')}</option>
                  <option value="testing">{t('docCDS.status_testing')}</option>
                  <option value="draft">{t('docCDS.status_draft')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Rules List */}
          {filteredRules.length > 0 ? (
            <div className="space-y-4">
              {filteredRules.map(rule => {
                const isExpanded = expandedRules.has(rule.ruleId);
                return (
                  <div key={rule.ruleId} className="bg-surface rounded-lg shadow border border-border hover:shadow-md transition-shadow">
                    {/* Rule Header */}
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-xl font-bold text-content">{rule.name}</h3>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getSeverityBadge(rule.severity)}`}>
                              {t(`docCDS.severity_${rule.severity}`).toUpperCase()}
                            </span>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(rule.status)}`}>
                              {t(`docCDS.status_${rule.status}`)}
                            </span>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getCategoryBadge(rule.category)}`}>
                              {t(`docCDS.category_${rule.category}`)}
                            </span>
                            {!rule.isEnabled && (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-surface-sunken text-content-secondary">
                                {t('docCDS.disabledBadge')}
                              </span>
                            )}
                            {rule.testMode && (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                                {t('docCDS.testModeBadge')}
                              </span>
                            )}
                          </div>
                          <p className="text-content-muted text-sm mb-3">{rule.description}</p>
                          <div className="flex items-center gap-4 text-sm text-content-muted">
                            <span className="flex items-center gap-1">
                              <Code className="w-4 h-4" />
                              {rule.ruleId}
                            </span>
                            <span className="flex items-center gap-1">
                              <Activity className="w-4 h-4" />
                              {t('docCDS.priorityLine', { value: rule.priority })}
                            </span>
                            <span className="flex items-center gap-1">
                              <Bell className="w-4 h-4" />
                              {t('docCDS.triggeredLine', { count: rule.triggerCount })}
                            </span>
                            {rule.lastTriggered && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {t('docCDS.lastLine', { date: formatDate(rule.lastTriggered) })}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => toggleRuleExpansion(rule.ruleId)}
                            className="p-2 text-content-muted hover:bg-surface-sunken rounded-lg transition-colors"
                            title={isExpanded ? t('docCDS.collapseTitle') : t('docCDS.expandTitle')}
                          >
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                          <button
                            onClick={() => handleToggleRule(rule.ruleId)}
                            className={`p-2 rounded-lg transition-colors ${
                              rule.isEnabled
                                ? 'text-ok-subtle-fg hover:bg-ok-subtle'
                                : 'text-content-muted hover:bg-surface-sunken'
                            }`}
                            title={rule.isEnabled ? t('docCDS.disableRuleTitle') : t('docCDS.enableRuleTitle')}
                          >
                            {rule.isEnabled ? <Power className="w-5 h-5" /> : <PowerOff className="w-5 h-5" />}
                          </button>
                          <button
                            onClick={() => handleDuplicateRule(rule)}
                            className="p-2 text-ok-subtle-fg hover:bg-ok-subtle rounded-lg transition-colors"
                            title={t('docCDS.duplicateRuleTitle')}
                          >
                            <Copy className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleExportRule(rule)}
                            className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                            title={t('docCDS.exportRuleTitle')}
                          >
                            <Download className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.ruleId)}
                            className="p-2 text-critical-subtle-fg hover:bg-critical-subtle rounded-lg transition-colors"
                            title={t('docCDS.deleteRuleTitle')}
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="mt-6 space-y-4 border-t pt-4">
                          {/* Conditions */}
                          <div className="bg-notice-subtle border border-notice rounded-lg p-4">
                            <h4 className="font-semibold text-notice-subtle-fg mb-3 flex items-center gap-2">
                              <Filter className="w-4 h-4" />
                              {t('docCDS.conditionsCount', { count: rule.conditions.length })}
                            </h4>
                            <div className="space-y-2">
                              {rule.conditions.map((condition, idx) => (
                                <div key={condition.conditionId} className="flex items-center gap-2 text-sm">
                                  <span className="bg-blue-200 text-notice-subtle-fg px-2 py-1 rounded font-medium">
                                    {condition.field}
                                  </span>
                                  <span className="text-notice-subtle-fg font-mono">{getOperatorLabel(condition.operator)}</span>
                                  <span className="bg-surface text-notice-subtle-fg px-2 py-1 rounded border border-notice">
                                    {condition.value}
                                    {condition.secondValue !== undefined && ` - ${condition.secondValue}`}
                                  </span>
                                  {idx < rule.conditions.length - 1 && condition.logicalOperator && (
                                    <span className="text-notice-subtle-fg font-semibold">{condition.logicalOperator}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                            <h4 className="font-semibold text-orange-900 mb-3 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4" />
                              {t('docCDS.actionsCount', { count: rule.actions.length })}
                            </h4>
                            <div className="space-y-3">
                              {rule.actions.map(action => (
                                <div key={action.actionId} className="bg-surface border border-orange-300 rounded p-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                                      action.type === 'block' ? 'bg-critical-subtle text-critical-subtle-fg' :
                                      action.type === 'alert' ? 'bg-orange-100 text-orange-800' :
                                      action.type === 'notify' ? 'bg-notice-subtle text-notice-subtle-fg' :
                                      action.type === 'recommend' ? 'bg-ok-subtle text-ok-subtle-fg' :
                                      'bg-purple-100 text-purple-800'
                                    }`}>
                                      {t(`docCDS.actionType_${action.type}`).toUpperCase()}
                                    </span>
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getSeverityBadge(action.severity)}`}>
                                      {t(`docCDS.severity_${action.severity}`)}
                                    </span>
                                    {action.blockAction && (
                                      <span className="px-2 py-1 text-xs font-medium rounded bg-critical-subtle text-critical-subtle-fg">
                                        {t('docCDS.blockingBadge')}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-content-secondary mb-2">{action.message}</p>
                                  {action.suggestedAction && (
                                    <div className="text-sm text-ok-subtle-fg bg-ok-subtle p-2 rounded mt-2">
                                      <span className="font-medium">{t('docCDS.suggestedLabel')}</span> {action.suggestedAction}
                                    </div>
                                  )}
                                  {action.notifyRoles && action.notifyRoles.length > 0 && (
                                    <div className="text-xs text-content-muted mt-2 flex items-center gap-1">
                                      <User className="w-3 h-3" />
                                      {t('docCDS.notifyLine', { roles: action.notifyRoles.join(', ') })}
                                    </div>
                                  )}
                                  {action.escalateTo && (
                                    <div className="text-xs text-critical-subtle-fg mt-2 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3" />
                                      {t('docCDS.escalateLine', { value: action.escalateTo })}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Metadata */}
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="bg-surface-sunken rounded p-3">
                              <div className="flex items-center gap-2 text-content-muted mb-1">
                                <User className="w-4 h-4" />
                                {t('docCDS.createdByLabel')}
                              </div>
                              <div className="font-medium text-content">{rule.createdBy}</div>
                              <div className="text-xs text-content-muted mt-1">{formatDate(rule.createdAt)}</div>
                            </div>
                            <div className="bg-surface-sunken rounded p-3">
                              <div className="flex items-center gap-2 text-content-muted mb-1">
                                <Clock className="w-4 h-4" />
                                {t('docCDS.lastModifiedLabel')}
                              </div>
                              <div className="text-xs text-content-muted mt-1">{formatDate(rule.lastModified)}</div>
                            </div>
                          </div>

                          {/* Evidence & References */}
                          {(rule.evidenceLevel || (rule.references && rule.references.length > 0)) && (
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                              <h4 className="font-semibold text-purple-900 mb-2">{t('docCDS.evidenceBaseTitle')}</h4>
                              {rule.evidenceLevel && (
                                <div className="text-sm mb-2">
                                  <span className="font-medium text-purple-700">{t('docCDS.evidenceLevelLabel')}</span>{' '}
                                  <span className="bg-purple-200 text-purple-900 px-2 py-1 rounded">
                                    {rule.evidenceLevel}
                                  </span>
                                </div>
                              )}
                              {rule.references && rule.references.length > 0 && (
                                <div className="text-sm">
                                  <span className="font-medium text-purple-700">{t('docCDS.referencesLabel')}</span>
                                  <ul className="list-disc list-inside mt-1 text-content-secondary">
                                    {rule.references.map((ref, idx) => (
                                      <li key={idx}>{ref}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-surface rounded-lg shadow p-12 text-center">
              <Bell className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-content-secondary mb-2">{t('docCDS.noRulesTitle')}</h3>
              <p className="text-content-muted">{t('docCDS.noRulesHint')}</p>
            </div>
          )}
        </div>
      )}

      {/* Create New Rule Tab */}
      {activeTab === 'create' && (
        <div className="space-y-6">
          {/* Basic Information */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-content mb-4">{t('docCDS.basicInfoTitle')}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cds-rule-name" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docCDS.ruleNameLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="cds-rule-name"
                    type="text"
                    value={newRule.name || ''}
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    placeholder={t('docCDS.ruleNamePh')}
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label htmlFor="cds-category" className="block text-sm font-medium text-content-secondary mb-1">{t('docCDS.categoryLabel')}</label>
                  <select
                    id="cds-category"
                    value={newRule.category || 'medication'}
                    onChange={(e) => setNewRule({ ...newRule, category: e.target.value as AlertCategory })}
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="medication">{t('docCDS.category_medication')}</option>
                    <option value="allergy">{t('docCDS.category_allergy')}</option>
                    <option value="vital_signs">{t('docCDS.category_vital_signs')}</option>
                    <option value="lab_results">{t('docCDS.category_lab_results')}</option>
                    <option value="diagnosis">{t('docCDS.category_diagnosis')}</option>
                    <option value="procedure">{t('docCDS.category_procedure')}</option>
                    <option value="clinical_pathway">{t('docCDS.category_clinical_pathway')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="cds-severity" className="block text-sm font-medium text-content-secondary mb-1">{t('docCDS.severityLabel')}</label>
                  <select
                    id="cds-severity"
                    value={newRule.severity || 'medium'}
                    onChange={(e) => setNewRule({ ...newRule, severity: e.target.value as AlertSeverity })}
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="critical">{t('docCDS.severity_critical')}</option>
                    <option value="high">{t('docCDS.severity_high')}</option>
                    <option value="medium">{t('docCDS.severity_medium')}</option>
                    <option value="low">{t('docCDS.severity_low')}</option>
                    <option value="info">{t('docCDS.severity_info')}</option>
                  </select>
                </div>

                {/* Evidence level was initialised to 'B' with no control, so every
                    authored rule asserted moderate literature support it had not
                    been given. 'Unspecified' is the honest default: a rule with
                    no stated evidence should say so rather than claim a grade. */}
                <div>
                  <label htmlFor="cds-evidence-level" className="block text-sm font-medium text-content-secondary mb-1">{t('docCDS.evidenceLevelFieldLabel')}</label>
                  <select
                    id="cds-evidence-level"
                    value={newRule.evidenceLevel || ''}
                    onChange={(e) => setNewRule({ ...newRule, evidenceLevel: e.target.value })}
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="">{t('docCDS.evidence_unspecified')}</option>
                    <option value="A">{t('docCDS.evidence_a')}</option>
                    <option value="B">{t('docCDS.evidence_b')}</option>
                    <option value="C">{t('docCDS.evidence_c')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cds-trigger-type" className="block text-sm font-medium text-content-secondary mb-1">{t('docCDS.triggerTypeLabel')}</label>
                  <select
                    id="cds-trigger-type"
                    value={newRule.triggerType || 'threshold'}
                    onChange={(e) => setNewRule({ ...newRule, triggerType: e.target.value as TriggerType })}
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="threshold">{t('docCDS.trigger_threshold')}</option>
                    <option value="pattern">{t('docCDS.trigger_pattern')}</option>
                    <option value="time_based">{t('docCDS.trigger_time_based')}</option>
                    <option value="interaction">{t('docCDS.trigger_interaction')}</option>
                    <option value="contraindication">{t('docCDS.trigger_contraindication')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cds-priority" className="block text-sm font-medium text-content-secondary mb-1">{t('docCDS.priorityLabel')}</label>
                  <input
                    id="cds-priority"
                    type="number"
                    min="1"
                    max="10"
                    value={newRule.priority || 5}
                    onChange={(e) => setNewRule({ ...newRule, priority: parseInt(e.target.value) || 5 })}
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="cds-description" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docCDS.descriptionLabel')} <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="cds-description"
                  value={newRule.description || ''}
                  onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                  placeholder={t('docCDS.descriptionPh')}
                  rows={3}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              <div className="flex items-center gap-6">
                <label htmlFor="cds-is-enabled" className="flex items-center gap-2">
                  <input
                    id="cds-is-enabled"
                    type="checkbox"
                    checked={newRule.isEnabled || false}
                    onChange={(e) => setNewRule({ ...newRule, isEnabled: e.target.checked })}
                    className="rounded border-border-strong text-critical-subtle-fg focus:ring-red-500"
                  />
                  <span className="text-sm font-medium text-content-secondary">{t('docCDS.enableRuleLabel')}</span>
                </label>
                <label htmlFor="cds-test-mode" className="flex items-center gap-2">
                  <input
                    id="cds-test-mode"
                    type="checkbox"
                    checked={newRule.testMode !== undefined ? newRule.testMode : true}
                    onChange={(e) => setNewRule({ ...newRule, testMode: e.target.checked })}
                    className="rounded border-border-strong text-critical-subtle-fg focus:ring-red-500"
                  />
                  <span className="text-sm font-medium text-content-secondary">{t('docCDS.testModeLabel')}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-content mb-4 flex items-center gap-2">
              <Filter className="w-6 h-6 text-notice-subtle-fg" />
              {t('docCDS.conditionsTitle')} <span className="text-red-500">*</span>
            </h2>

            {/* Add Condition Form */}
            <div className="bg-notice-subtle border border-notice rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-notice-subtle-fg mb-3">{t('docCDS.addConditionTitle')}</h3>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <div>
                  <label htmlFor="cds-condition-field" className="sr-only">{t('docCDS.conditionFieldSr')}</label>
                  <input
                    id="cds-condition-field"
                    type="text"
                    value={newCondition.field || ''}
                    onChange={(e) => setNewCondition({ ...newCondition, field: e.target.value })}
                    placeholder={t('docCDS.conditionFieldPh')}
                    className="w-full px-3 py-2 border border-notice rounded focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="cds-condition-operator" className="sr-only">{t('docCDS.conditionOperatorSr')}</label>
                  <select
                    id="cds-condition-operator"
                    value={newCondition.operator || 'equals'}
                    onChange={(e) => setNewCondition({ ...newCondition, operator: e.target.value as Condition['operator'] })}
                    className="w-full px-3 py-2 border border-notice rounded focus:ring-2 focus:ring-blue-500"
                  >
                  <option value="equals">{t('docCDS.op_equals_full')}</option>
                  <option value="not_equals">{t('docCDS.op_not_equals_full')}</option>
                  <option value="greater_than">{t('docCDS.op_greater_than_full')}</option>
                  <option value="less_than">{t('docCDS.op_less_than_full')}</option>
                  <option value="greater_or_equal">{t('docCDS.op_greater_or_equal_full')}</option>
                  <option value="less_or_equal">{t('docCDS.op_less_or_equal_full')}</option>
                  <option value="contains">{t('docCDS.op_contains_full')}</option>
                  <option value="not_contains">{t('docCDS.op_not_contains_full')}</option>
                  <option value="in_range">{t('docCDS.op_in_range_full')}</option>
                  <option value="out_of_range">{t('docCDS.op_out_of_range_full')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cds-condition-value" className="sr-only">{t('docCDS.conditionValueSr')}</label>
                  <input
                    id="cds-condition-value"
                    type="text"
                    value={newCondition.value || ''}
                    onChange={(e) => setNewCondition({ ...newCondition, value: e.target.value })}
                    placeholder={t('docCDS.conditionValuePh')}
                    className="w-full px-3 py-2 border border-notice rounded focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="cds-condition-logical" className="sr-only">{t('docCDS.logicalOperatorSr')}</label>
                  <select
                    id="cds-condition-logical"
                    value={newCondition.logicalOperator || 'AND'}
                    onChange={(e) => setNewCondition({ ...newCondition, logicalOperator: e.target.value as 'AND' | 'OR' })}
                    className="w-full px-3 py-2 border border-notice rounded focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleAddCondition}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('docCDS.addConditionBtn')}
              </button>
            </div>

            {/* Current Conditions */}
            {newRule.conditions && newRule.conditions.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-content mb-2">{t('docCDS.currentConditionsTitle', { count: newRule.conditions.length })}</h3>
                {newRule.conditions.map((condition, idx) => (
                  <div key={condition.conditionId} className="flex items-center justify-between bg-surface-sunken border border-border rounded p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="bg-blue-200 text-notice-subtle-fg px-2 py-1 rounded font-medium">
                        {condition.field}
                      </span>
                      <span className="text-notice-subtle-fg font-mono">{getOperatorLabel(condition.operator)}</span>
                      <span className="bg-surface text-notice-subtle-fg px-2 py-1 rounded border border-notice">
                        {condition.value}
                      </span>
                      {newRule.conditions && idx < newRule.conditions.length - 1 && condition.logicalOperator && (
                        <span className="text-notice-subtle-fg font-semibold">{condition.logicalOperator}</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveCondition(condition.conditionId)}
                      className="p-1 text-critical-subtle-fg hover:bg-critical-subtle rounded transition-colors"
                      aria-label="Remove condition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-content mb-4 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-orange-600" />
              {t('docCDS.actionsTitle')} <span className="text-red-500">*</span>
            </h2>

            {/* Add Action Form */}
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-orange-900 mb-3">{t('docCDS.addActionTitle')}</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="cds-action-type" className="sr-only">{t('docCDS.actionTypeSr')}</label>
                    <select
                      id="cds-action-type"
                      value={newAction.type || 'alert'}
                      onChange={(e) => setNewAction({ ...newAction, type: e.target.value as ActionType })}
                      className="w-full px-3 py-2 border border-orange-300 rounded focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="alert">{t('docCDS.actionType_alert')}</option>
                      <option value="block">{t('docCDS.actionType_block')}</option>
                      <option value="recommend">{t('docCDS.actionType_recommend')}</option>
                      <option value="notify">{t('docCDS.actionType_notify')}</option>
                      <option value="escalate">{t('docCDS.actionType_escalate')}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cds-action-severity" className="sr-only">{t('docCDS.actionSeveritySr')}</label>
                    <select
                      id="cds-action-severity"
                      value={newAction.severity || 'medium'}
                      onChange={(e) => setNewAction({ ...newAction, severity: e.target.value as AlertSeverity })}
                      className="w-full px-3 py-2 border border-orange-300 rounded focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="critical">{t('docCDS.severity_critical')}</option>
                      <option value="high">{t('docCDS.severity_high')}</option>
                      <option value="medium">{t('docCDS.severity_medium')}</option>
                      <option value="low">{t('docCDS.severity_low')}</option>
                      <option value="info">{t('docCDS.severity_info')}</option>
                    </select>
                  </div>
                  <label htmlFor="cds-block-action" className="flex items-center gap-2 px-3 py-2">
                    <input
                      id="cds-block-action"
                      type="checkbox"
                      checked={newAction.blockAction || false}
                      onChange={(e) => setNewAction({ ...newAction, blockAction: e.target.checked })}
                      className="rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm font-medium text-orange-900">{t('docCDS.blockActionLabel')}</span>
                  </label>
                </div>
                <div>
                  <label htmlFor="cds-action-message" className="sr-only">{t('docCDS.alertMessageSr')}</label>
                  <textarea
                    id="cds-action-message"
                    value={newAction.message || ''}
                    onChange={(e) => setNewAction({ ...newAction, message: e.target.value })}
                    placeholder={t('docCDS.alertMessagePh')}
                    rows={2}
                    className="w-full px-3 py-2 border border-orange-300 rounded focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label htmlFor="cds-suggested-action" className="sr-only">{t('docCDS.suggestedActionSr')}</label>
                  <textarea
                    id="cds-suggested-action"
                    value={newAction.suggestedAction || ''}
                    onChange={(e) => setNewAction({ ...newAction, suggestedAction: e.target.value })}
                    placeholder={t('docCDS.suggestedActionPh')}
                    rows={2}
                    className="w-full px-3 py-2 border border-orange-300 rounded focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
              <button
                onClick={handleAddAction}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('docCDS.addActionBtn')}
              </button>
            </div>

            {/* Current Actions */}
            {newRule.actions && newRule.actions.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-content mb-2">{t('docCDS.currentActionsTitle', { count: newRule.actions.length })}</h3>
                {newRule.actions.map(action => (
                  <div key={action.actionId} className="bg-surface border border-orange-300 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${
                          action.type === 'block' ? 'bg-critical-subtle text-critical-subtle-fg' :
                          action.type === 'alert' ? 'bg-orange-100 text-orange-800' :
                          action.type === 'notify' ? 'bg-notice-subtle text-notice-subtle-fg' :
                          action.type === 'recommend' ? 'bg-ok-subtle text-ok-subtle-fg' :
                          'bg-purple-100 text-purple-800'
                        }`}>
                          {t(`docCDS.actionType_${action.type}`).toUpperCase()}
                        </span>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getSeverityBadge(action.severity)}`}>
                          {t(`docCDS.severity_${action.severity}`)}
                        </span>
                        {action.blockAction && (
                          <span className="px-2 py-1 text-xs font-medium rounded bg-critical-subtle text-critical-subtle-fg">
                            {t('docCDS.blockingBadge')}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveAction(action.actionId)}
                        className="p-1 text-critical-subtle-fg hover:bg-critical-subtle rounded transition-colors"
                        aria-label="Remove action"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-sm text-content-secondary">{action.message}</p>
                    {action.suggestedAction && (
                      <p className="text-sm text-ok-subtle-fg mt-2">{t('docCDS.suggestedPrefix', { value: action.suggestedAction })}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create Button */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setActiveTab('all');
                setNewRule({
                  name: '',
                  category: 'medication',
                  description: '',
                  severity: 'medium',
                  triggerType: 'threshold',
                  conditions: [],
                  actions: [],
                  status: 'draft',
                  priority: 5,
                  isEnabled: false,
                  testMode: true,
                  targetRoles: ['doctor', 'nurse'],
                  evidenceLevel: 'B',
                  references: [],
                });
              }}
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              {t('docCDS.cancelBtn')}
            </button>
            <button
              onClick={handleCreateRule}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <Save className="w-5 h-5" />
              {t('docCDS.createRuleBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-surface rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-content mb-2">{t('docCDS.totalRulesTitle')}</h3>
              <div className="text-3xl font-bold text-critical-subtle-fg">{rules.length}</div>
              <div className="text-sm text-content-muted mt-1">
                {t('docCDS.activeCount', { count: rules.filter(r => r.isEnabled).length })}
              </div>
            </div>
            <div className="bg-surface rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-content mb-2">{t('docCDS.totalTriggersTitle')}</h3>
              <div className="text-3xl font-bold text-orange-600">
                {rules.reduce((sum, r) => sum + r.triggerCount, 0)}
              </div>
              <div className="text-sm text-content-muted mt-1">{t('docCDS.acrossAllRules')}</div>
            </div>
            <div className="bg-surface rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-content mb-2">{t('docCDS.criticalRulesTitle')}</h3>
              <div className="text-3xl font-bold text-critical-subtle-fg">
                {rules.filter(r => r.severity === 'critical').length}
              </div>
              <div className="text-sm text-content-muted mt-1">{t('docCDS.highestPriority')}</div>
            </div>
          </div>

          <div className="bg-surface rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-content mb-4">{t('docCDS.rulesByCategoryTitle')}</h3>
            <div className="space-y-2">
              {(['medication', 'allergy', 'vital_signs', 'lab_results', 'diagnosis', 'procedure', 'clinical_pathway'] as AlertCategory[]).map(category => {
                const count = rules.filter(r => r.category === category).length;
                const percentage = rules.length > 0 ? (count / rules.length) * 100 : 0;
                return (
                  <div key={category}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-content-secondary capitalize">{t(`docCDS.category_${category}`)}</span>
                      <span className="text-content font-medium">{count} ({percentage.toFixed(0)}%)</span>
                    </div>
                    <div className="w-full bg-surface-sunken rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${getCategoryBadge(category).split(' ')[0].replace('bg-', 'bg-').replace('-100', '-500')}`}
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-surface rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-content mb-4">{t('docCDS.topTriggeredTitle')}</h3>
            <div className="space-y-3">
              {rules
                .sort((a, b) => b.triggerCount - a.triggerCount)
                .slice(0, 5)
                .map(rule => (
                  <div key={rule.ruleId} className="flex items-center justify-between p-3 bg-surface-sunken rounded">
                    <div>
                      <div className="font-medium text-content">{rule.name}</div>
                      <div className="text-sm text-content-muted">{rule.ruleId}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-critical-subtle-fg">{rule.triggerCount}</div>
                      <div className="text-xs text-content-muted">{t('docCDS.triggersLabel')}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CDSAlertsPage;
