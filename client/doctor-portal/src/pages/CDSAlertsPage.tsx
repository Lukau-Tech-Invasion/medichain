import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { listCdsAlerts } from '@medichain/shared';
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
      setError('Failed to load CDS rules');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load CDS rules on mount
  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Handler Functions
  const handleCreateRule = () => {
    if (!newRule.name || !newRule.description || !newRule.conditions?.length || !newRule.actions?.length) {
      alert('Please fill in all required fields: name, description, at least one condition, and at least one action.');
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
      evidenceLevel: newRule.evidenceLevel || 'C',
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
    alert(`Rule "${rule.name}" created successfully!`);
  };

  const handleAddCondition = () => {
    if (!newCondition.field || !newCondition.operator || newCondition.value === undefined || newCondition.value === '') {
      alert('Please fill in all condition fields: field, operator, and value.');
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
      alert('Please provide an action message.');
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

  const handleToggleRule = (ruleId: string) => {
    setRules(rules.map(r =>
      r.ruleId === ruleId
        ? { ...r, isEnabled: !r.isEnabled, lastModified: new Date().toISOString() }
        : r
    ));
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
    alert(`Rule duplicated as "${duplicatedRule.name}"`);
  };

  const handleDeleteRule = (ruleId: string) => {
    if (confirm('Are you sure you want to delete this rule?')) {
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
      critical: 'bg-red-100 text-red-800',
      high: 'bg-orange-100 text-orange-800',
      medium: 'bg-yellow-100 text-yellow-800',
      low: 'bg-blue-100 text-blue-800',
      info: 'bg-gray-100 text-gray-800',
    };
    return badges[severity];
  };

  const getStatusBadge = (status: AlertStatus) => {
    const badges = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      testing: 'bg-purple-100 text-purple-800',
      draft: 'bg-yellow-100 text-yellow-800',
    };
    return badges[status];
  };

  const getCategoryBadge = (category: AlertCategory) => {
    const badges = {
      medication: 'bg-blue-100 text-blue-800',
      allergy: 'bg-red-100 text-red-800',
      vital_signs: 'bg-green-100 text-green-800',
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
    const labels: Record<Condition['operator'], string> = {
      equals: '=',
      not_equals: '≠',
      greater_than: '>',
      less_than: '<',
      greater_or_equal: '≥',
      less_or_equal: '≤',
      contains: 'contains',
      not_contains: 'not contains',
      in_range: 'in range',
      out_of_range: 'out of range',
    };
    return labels[operator];
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
            <h1 className="text-3xl font-bold">CDS Alerts Configuration</h1>
            <p className="text-red-100 mt-1">Clinical Decision Support rule engine and alert management</p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'all'
              ? 'border-b-2 border-red-600 text-red-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          All Rules ({rules.length})
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'create'
              ? 'border-b-2 border-red-600 text-red-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Create New Rule
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'analytics'
              ? 'border-b-2 border-red-600 text-red-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Analytics
        </button>
      </div>

      {/* All Rules Tab */}
      {activeTab === 'all' && (
        <div>
          {/* Filters */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Search */}
              <div className="md:col-span-2 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by name, description, or rule ID..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              {/* Category Filter */}
              <div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as AlertCategory | 'all')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="all">All Categories</option>
                  <option value="medication">Medication</option>
                  <option value="allergy">Allergy</option>
                  <option value="vital_signs">Vital Signs</option>
                  <option value="lab_results">Lab Results</option>
                  <option value="diagnosis">Diagnosis</option>
                  <option value="procedure">Procedure</option>
                  <option value="clinical_pathway">Clinical Pathway</option>
                </select>
              </div>

              {/* Severity Filter */}
              <div>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as AlertSeverity | 'all')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="info">Info</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
              {/* Status Filter */}
              <div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AlertStatus | 'all')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="testing">Testing</option>
                  <option value="draft">Draft</option>
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
                  <div key={rule.ruleId} className="bg-white rounded-lg shadow border border-gray-200 hover:shadow-md transition-shadow">
                    {/* Rule Header */}
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-xl font-bold text-gray-900">{rule.name}</h3>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getSeverityBadge(rule.severity)}`}>
                              {rule.severity.toUpperCase()}
                            </span>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(rule.status)}`}>
                              {rule.status}
                            </span>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getCategoryBadge(rule.category)}`}>
                              {rule.category.replace('_', ' ')}
                            </span>
                            {!rule.isEnabled && (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-200 text-gray-700">
                                DISABLED
                              </span>
                            )}
                            {rule.testMode && (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                                TEST MODE
                              </span>
                            )}
                          </div>
                          <p className="text-gray-600 text-sm mb-3">{rule.description}</p>
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <Code className="w-4 h-4" />
                              {rule.ruleId}
                            </span>
                            <span className="flex items-center gap-1">
                              <Activity className="w-4 h-4" />
                              Priority: {rule.priority}/10
                            </span>
                            <span className="flex items-center gap-1">
                              <Bell className="w-4 h-4" />
                              Triggered: {rule.triggerCount} times
                            </span>
                            {rule.lastTriggered && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                Last: {formatDate(rule.lastTriggered)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => toggleRuleExpansion(rule.ruleId)}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                          <button
                            onClick={() => handleToggleRule(rule.ruleId)}
                            className={`p-2 rounded-lg transition-colors ${
                              rule.isEnabled
                                ? 'text-green-600 hover:bg-green-100'
                                : 'text-gray-400 hover:bg-gray-100'
                            }`}
                            title={rule.isEnabled ? 'Disable rule' : 'Enable rule'}
                          >
                            {rule.isEnabled ? <Power className="w-5 h-5" /> : <PowerOff className="w-5 h-5" />}
                          </button>
                          <button
                            onClick={() => handleDuplicateRule(rule)}
                            className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                            title="Duplicate rule"
                          >
                            <Copy className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleExportRule(rule)}
                            className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                            title="Export rule"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.ruleId)}
                            className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                            title="Delete rule"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="mt-6 space-y-4 border-t pt-4">
                          {/* Conditions */}
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                              <Filter className="w-4 h-4" />
                              Conditions ({rule.conditions.length})
                            </h4>
                            <div className="space-y-2">
                              {rule.conditions.map((condition, idx) => (
                                <div key={condition.conditionId} className="flex items-center gap-2 text-sm">
                                  <span className="bg-blue-200 text-blue-900 px-2 py-1 rounded font-medium">
                                    {condition.field}
                                  </span>
                                  <span className="text-blue-700 font-mono">{getOperatorLabel(condition.operator)}</span>
                                  <span className="bg-white text-blue-900 px-2 py-1 rounded border border-blue-300">
                                    {condition.value}
                                    {condition.secondValue !== undefined && ` - ${condition.secondValue}`}
                                  </span>
                                  {idx < rule.conditions.length - 1 && condition.logicalOperator && (
                                    <span className="text-blue-700 font-semibold">{condition.logicalOperator}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                            <h4 className="font-semibold text-orange-900 mb-3 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4" />
                              Actions ({rule.actions.length})
                            </h4>
                            <div className="space-y-3">
                              {rule.actions.map(action => (
                                <div key={action.actionId} className="bg-white border border-orange-300 rounded p-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                                      action.type === 'block' ? 'bg-red-100 text-red-800' :
                                      action.type === 'alert' ? 'bg-orange-100 text-orange-800' :
                                      action.type === 'notify' ? 'bg-blue-100 text-blue-800' :
                                      action.type === 'recommend' ? 'bg-green-100 text-green-800' :
                                      'bg-purple-100 text-purple-800'
                                    }`}>
                                      {action.type.toUpperCase()}
                                    </span>
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getSeverityBadge(action.severity)}`}>
                                      {action.severity}
                                    </span>
                                    {action.blockAction && (
                                      <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">
                                        BLOCKING
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-700 mb-2">{action.message}</p>
                                  {action.suggestedAction && (
                                    <div className="text-sm text-green-700 bg-green-50 p-2 rounded mt-2">
                                      <span className="font-medium">Suggested:</span> {action.suggestedAction}
                                    </div>
                                  )}
                                  {action.notifyRoles && action.notifyRoles.length > 0 && (
                                    <div className="text-xs text-gray-600 mt-2 flex items-center gap-1">
                                      <User className="w-3 h-3" />
                                      Notify: {action.notifyRoles.join(', ')}
                                    </div>
                                  )}
                                  {action.escalateTo && (
                                    <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3" />
                                      Escalate to: {action.escalateTo}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Metadata */}
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="bg-gray-50 rounded p-3">
                              <div className="flex items-center gap-2 text-gray-600 mb-1">
                                <User className="w-4 h-4" />
                                Created by
                              </div>
                              <div className="font-medium text-gray-900">{rule.createdBy}</div>
                              <div className="text-xs text-gray-500 mt-1">{formatDate(rule.createdAt)}</div>
                            </div>
                            <div className="bg-gray-50 rounded p-3">
                              <div className="flex items-center gap-2 text-gray-600 mb-1">
                                <Clock className="w-4 h-4" />
                                Last Modified
                              </div>
                              <div className="text-xs text-gray-500 mt-1">{formatDate(rule.lastModified)}</div>
                            </div>
                          </div>

                          {/* Evidence & References */}
                          {(rule.evidenceLevel || (rule.references && rule.references.length > 0)) && (
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                              <h4 className="font-semibold text-purple-900 mb-2">Evidence Base</h4>
                              {rule.evidenceLevel && (
                                <div className="text-sm mb-2">
                                  <span className="font-medium text-purple-700">Evidence Level:</span>{' '}
                                  <span className="bg-purple-200 text-purple-900 px-2 py-1 rounded">
                                    {rule.evidenceLevel}
                                  </span>
                                </div>
                              )}
                              {rule.references && rule.references.length > 0 && (
                                <div className="text-sm">
                                  <span className="font-medium text-purple-700">References:</span>
                                  <ul className="list-disc list-inside mt-1 text-gray-700">
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
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <Bell className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No rules found</h3>
              <p className="text-gray-500">Create a new rule or adjust your filters</p>
            </div>
          )}
        </div>
      )}

      {/* Create New Rule Tab */}
      {activeTab === 'create' && (
        <div className="space-y-6">
          {/* Basic Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Basic Information</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rule Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newRule.name || ''}
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    placeholder="e.g., Sepsis Early Warning"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={newRule.category || 'medication'}
                    onChange={(e) => setNewRule({ ...newRule, category: e.target.value as AlertCategory })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="medication">Medication</option>
                    <option value="allergy">Allergy</option>
                    <option value="vital_signs">Vital Signs</option>
                    <option value="lab_results">Lab Results</option>
                    <option value="diagnosis">Diagnosis</option>
                    <option value="procedure">Procedure</option>
                    <option value="clinical_pathway">Clinical Pathway</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                  <select
                    value={newRule.severity || 'medium'}
                    onChange={(e) => setNewRule({ ...newRule, severity: e.target.value as AlertSeverity })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Type</label>
                  <select
                    value={newRule.triggerType || 'threshold'}
                    onChange={(e) => setNewRule({ ...newRule, triggerType: e.target.value as TriggerType })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="threshold">Threshold</option>
                    <option value="pattern">Pattern</option>
                    <option value="time_based">Time Based</option>
                    <option value="interaction">Interaction</option>
                    <option value="contraindication">Contraindication</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority (1-10)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={newRule.priority || 5}
                    onChange={(e) => setNewRule({ ...newRule, priority: parseInt(e.target.value) || 5 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={newRule.description || ''}
                  onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                  placeholder="Detailed description of the rule and its purpose..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newRule.isEnabled || false}
                    onChange={(e) => setNewRule({ ...newRule, isEnabled: e.target.checked })}
                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Enable rule</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newRule.testMode !== undefined ? newRule.testMode : true}
                    onChange={(e) => setNewRule({ ...newRule, testMode: e.target.checked })}
                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Test mode (log only)</span>
                </label>
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Filter className="w-6 h-6 text-blue-600" />
              Conditions <span className="text-red-500">*</span>
            </h2>

            {/* Add Condition Form */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-blue-900 mb-3">Add Condition</h3>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <input
                  type="text"
                  value={newCondition.field || ''}
                  onChange={(e) => setNewCondition({ ...newCondition, field: e.target.value })}
                  placeholder="Field (e.g., blood_pressure_systolic)"
                  className="px-3 py-2 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={newCondition.operator || 'equals'}
                  onChange={(e) => setNewCondition({ ...newCondition, operator: e.target.value as Condition['operator'] })}
                  className="px-3 py-2 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                >
                  <option value="equals">Equals (=)</option>
                  <option value="not_equals">Not Equals (≠)</option>
                  <option value="greater_than">Greater Than (&gt;)</option>
                  <option value="less_than">Less Than (&lt;)</option>
                  <option value="greater_or_equal">Greater or Equal (≥)</option>
                  <option value="less_or_equal">Less or Equal (≤)</option>
                  <option value="contains">Contains</option>
                  <option value="not_contains">Not Contains</option>
                  <option value="in_range">In Range</option>
                  <option value="out_of_range">Out of Range</option>
                </select>
                <input
                  type="text"
                  value={newCondition.value || ''}
                  onChange={(e) => setNewCondition({ ...newCondition, value: e.target.value })}
                  placeholder="Value"
                  className="px-3 py-2 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={newCondition.logicalOperator || 'AND'}
                  onChange={(e) => setNewCondition({ ...newCondition, logicalOperator: e.target.value as 'AND' | 'OR' })}
                  className="px-3 py-2 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              </div>
              <button
                onClick={handleAddCondition}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Condition
              </button>
            </div>

            {/* Current Conditions */}
            {newRule.conditions && newRule.conditions.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900 mb-2">Current Conditions ({newRule.conditions.length})</h3>
                {newRule.conditions.map((condition, idx) => (
                  <div key={condition.conditionId} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="bg-blue-200 text-blue-900 px-2 py-1 rounded font-medium">
                        {condition.field}
                      </span>
                      <span className="text-blue-700 font-mono">{getOperatorLabel(condition.operator)}</span>
                      <span className="bg-white text-blue-900 px-2 py-1 rounded border border-blue-300">
                        {condition.value}
                      </span>
                      {newRule.conditions && idx < newRule.conditions.length - 1 && condition.logicalOperator && (
                        <span className="text-blue-700 font-semibold">{condition.logicalOperator}</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveCondition(condition.conditionId)}
                      className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-orange-600" />
              Actions <span className="text-red-500">*</span>
            </h2>

            {/* Add Action Form */}
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-orange-900 mb-3">Add Action</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <select
                    value={newAction.type || 'alert'}
                    onChange={(e) => setNewAction({ ...newAction, type: e.target.value as ActionType })}
                    className="px-3 py-2 border border-orange-300 rounded focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="alert">Alert</option>
                    <option value="block">Block</option>
                    <option value="recommend">Recommend</option>
                    <option value="notify">Notify</option>
                    <option value="escalate">Escalate</option>
                  </select>
                  <select
                    value={newAction.severity || 'medium'}
                    onChange={(e) => setNewAction({ ...newAction, severity: e.target.value as AlertSeverity })}
                    className="px-3 py-2 border border-orange-300 rounded focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                  <label className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={newAction.blockAction || false}
                      onChange={(e) => setNewAction({ ...newAction, blockAction: e.target.checked })}
                      className="rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm font-medium text-orange-900">Block action</span>
                  </label>
                </div>
                <textarea
                  value={newAction.message || ''}
                  onChange={(e) => setNewAction({ ...newAction, message: e.target.value })}
                  placeholder="Alert message to display (required)"
                  rows={2}
                  className="w-full px-3 py-2 border border-orange-300 rounded focus:ring-2 focus:ring-orange-500"
                />
                <textarea
                  value={newAction.suggestedAction || ''}
                  onChange={(e) => setNewAction({ ...newAction, suggestedAction: e.target.value })}
                  placeholder="Suggested action or alternative (optional)"
                  rows={2}
                  className="w-full px-3 py-2 border border-orange-300 rounded focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <button
                onClick={handleAddAction}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Action
              </button>
            </div>

            {/* Current Actions */}
            {newRule.actions && newRule.actions.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900 mb-2">Current Actions ({newRule.actions.length})</h3>
                {newRule.actions.map(action => (
                  <div key={action.actionId} className="bg-white border border-orange-300 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${
                          action.type === 'block' ? 'bg-red-100 text-red-800' :
                          action.type === 'alert' ? 'bg-orange-100 text-orange-800' :
                          action.type === 'notify' ? 'bg-blue-100 text-blue-800' :
                          action.type === 'recommend' ? 'bg-green-100 text-green-800' :
                          'bg-purple-100 text-purple-800'
                        }`}>
                          {action.type.toUpperCase()}
                        </span>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getSeverityBadge(action.severity)}`}>
                          {action.severity}
                        </span>
                        {action.blockAction && (
                          <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">
                            BLOCKING
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveAction(action.actionId)}
                        className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-sm text-gray-700">{action.message}</p>
                    {action.suggestedAction && (
                      <p className="text-sm text-green-700 mt-2">Suggested: {action.suggestedAction}</p>
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
              Cancel
            </button>
            <button
              onClick={handleCreateRule}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <Save className="w-5 h-5" />
              Create Rule
            </button>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Rules</h3>
              <div className="text-3xl font-bold text-red-600">{rules.length}</div>
              <div className="text-sm text-gray-600 mt-1">
                Active: {rules.filter(r => r.isEnabled).length}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Triggers</h3>
              <div className="text-3xl font-bold text-orange-600">
                {rules.reduce((sum, r) => sum + r.triggerCount, 0)}
              </div>
              <div className="text-sm text-gray-600 mt-1">Across all rules</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Critical Rules</h3>
              <div className="text-3xl font-bold text-red-600">
                {rules.filter(r => r.severity === 'critical').length}
              </div>
              <div className="text-sm text-gray-600 mt-1">Highest priority</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Rules by Category</h3>
            <div className="space-y-2">
              {(['medication', 'allergy', 'vital_signs', 'lab_results', 'diagnosis', 'procedure', 'clinical_pathway'] as AlertCategory[]).map(category => {
                const count = rules.filter(r => r.category === category).length;
                const percentage = rules.length > 0 ? (count / rules.length) * 100 : 0;
                return (
                  <div key={category}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700 capitalize">{category.replace('_', ' ')}</span>
                      <span className="text-gray-900 font-medium">{count} ({percentage.toFixed(0)}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
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

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Triggered Rules</h3>
            <div className="space-y-3">
              {rules
                .sort((a, b) => b.triggerCount - a.triggerCount)
                .slice(0, 5)
                .map(rule => (
                  <div key={rule.ruleId} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div>
                      <div className="font-medium text-gray-900">{rule.name}</div>
                      <div className="text-sm text-gray-600">{rule.ruleId}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-red-600">{rule.triggerCount}</div>
                      <div className="text-xs text-gray-500">triggers</div>
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
