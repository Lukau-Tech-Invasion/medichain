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
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle
} from 'lucide-react';
import {
  apiUrl,
  getApiClient,
  useTranslation,
  clickable,
  Input,
  Select,
  useValidatedForm,
  carePlanSchema,
} from '@medichain/shared';
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

interface CarePlanTemplate {
  id: string;
  name: string;
  diagnosis: string;
  priority: Priority;
  goals: string[];
  interventions: string[];
}

interface CarePlanApiRecord {
  id: string;
  patient_id: string;
  plan_name: string;
  care_level?: string | null;
  goals?: unknown;
  interventions?: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
  status?: string | null;
}

const planItems = (value: unknown, kind: 'goal' | 'intervention') =>
  Array.isArray(value)
    ? value.map((item, index) => {
      const row = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
      return {
        id: typeof row.id === 'string' ? row.id : `${kind}-${index + 1}`,
        description: typeof row.description === 'string' ? row.description : String(item),
        ...(kind === 'goal'
          ? { targetDate: new Date(typeof row.target_date === 'string' ? row.target_date : Date.now()), status: 'not-met' as GoalStatus }
          : { frequency: typeof row.frequency === 'string' ? row.frequency : '', completed: Boolean(row.completed) }),
      };
    })
    : [];

/** Map the repository's snake-case record to the portal's display model. */
export const mapNursingCarePlan = (plan: CarePlanApiRecord): CarePlan => ({
  id: plan.id,
  patientId: plan.patient_id,
  // The list API does not expose decrypted demographics. Patient id is an
  // honest fallback, unlike a plausible name invented by the browser.
  patientName: plan.patient_id,
  mrn: plan.patient_id,
  room: '',
  diagnosis: plan.plan_name,
  priority: (plan.care_level === 'high' || plan.care_level === 'low' ? plan.care_level : 'medium'),
  status: (plan.status === 'on-hold' || plan.status === 'completed' || plan.status === 'discontinued' ? plan.status : 'active'),
  goals: planItems(plan.goals, 'goal') as Goal[],
  interventions: planItems(plan.interventions, 'intervention') as Intervention[],
  createdBy: plan.created_by,
  createdAt: new Date(plan.created_at),
  updatedAt: new Date(plan.updated_at),
});

const NursingCarePlanPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'plans' | 'new' | 'templates'>('plans');
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The create tab had no state, no handler and a button with no onClick, so a
  // care plan could never be created. Its patient picker was also built from
  // existing plans, meaning a patient without one could never be chosen.
  const [patients, setPatients] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    patientId: '', diagnosis: '', priority: 'medium' as Priority, goals: '', interventions: '',
  });
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user?.walletAddress) return;
    fetch(apiUrl('/api/patients?limit=100'), {
      headers: { 'Content-Type': 'application/json', ...getApiClient().getSessionHeaders(user.walletAddress) },
    })
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(body => {
        const rows = (body.data || []) as Array<{ patient_id: string; full_name: string }>;
        setPatients(rows.map(r => ({ id: r.patient_id, name: r.full_name })));
      })
      .catch(() => setPatients([]));
  }, [user?.walletAddress]);

  const { errors, validate, validateField, clearField } = useValidatedForm(carePlanSchema);

  const createPlan = async () => {
    if (!user?.walletAddress) return;
    // Was a banner naming both fields at once. A banner cannot say which
    // control is wrong -- that association is the whole of WCAG 3.3.1 -- and it
    // reported two problems when the nurse had one. `validate` puts the message
    // on the field.
    if (!validate(form)) {
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(apiUrl('/api/emergency/care-plan'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'Idempotency-Key': getApiClient().getMutationHeaders()['Idempotency-Key'],
          'X-Provider-Role': user.role || 'Nurse',
        },
        body: JSON.stringify({
          patient_id: form.patientId,
          diagnosis: form.diagnosis.trim(),
          priority: form.priority,
          goals: form.goals.split('\n').map(value => value.trim()).filter(Boolean)
            .map((description, index) => ({ id: `goal-${index + 1}`, description })),
          interventions: form.interventions.split('\n').map(value => value.trim()).filter(Boolean)
            .map((description, index) => ({ id: `intervention-${index + 1}`, description })),
        }),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      setSaveMessage(t('docNursingCarePlan.savedOk'));
      setForm({ patientId: '', diagnosis: '', priority: 'medium', goals: '', interventions: '' });
    } catch (err) {
      console.error('Failed to create care plan:', err);
      setSaveMessage(t('docNursingCarePlan.errSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const fetchPlans = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        setError(null);
        
        const data = await getApiClient().get<CarePlanApiRecord[]>('/api/emergency/care-plan/list');
        setPlans((data || []).map(mapNursingCarePlan));
      } catch (err) {
        console.error('Error fetching care plans:', err);
        setError(err instanceof Error ? err.message : t('docNursingCarePlan.failLoad'));
        setPlans([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPlans();
  }, [user, t]);

  const getStatusBadge = (status: PlanStatus) => {
    const styles: Record<PlanStatus, { bg: string; text: string }> = {
      'active': { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg' },
      'on-hold': { bg: 'bg-caution-subtle', text: 'text-caution-subtle-fg' },
      'completed': { bg: 'bg-notice-subtle', text: 'text-notice-subtle-fg' },
      'discontinued': { bg: 'bg-surface-sunken', text: 'text-content-secondary' }
    };
    // Total, not partial. `status` is typed `PlanStatus` but it arrives from
    // the API, where `status` is a plain string column -- so an unrecognised or
    // absent value indexes to `undefined` and `s.bg` throws, taking the whole
    // application down through the ErrorBoundary above the router. See the
    // neutral-marker comment in ConsultPage, which is the same fix.
    const s = styles[status] ?? { bg: 'bg-surface-sunken', text: 'text-content-secondary' };
    const labels: Record<PlanStatus, string> = {
      'active': t('docNursingCarePlan.statusActive'),
      'on-hold': t('docNursingCarePlan.statusOnHold'),
      'completed': t('docNursingCarePlan.statusCompleted'),
      'discontinued': t('docNursingCarePlan.statusDiscontinued'),
    };
    // The raw value, when it is not one this screen knows: naming it is more
    // use to a nurse than a blank badge, and inventing a status would be worse
    // than either.
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>{labels[status] ?? (status || t('docNursingCarePlan.statusUnknown'))}</span>;
  };

  const priorityLabel = (priority: Priority): string => {
    switch (priority) {
      case 'high': return t('docNursingCarePlan.priorityHigh');
      case 'medium': return t('docNursingCarePlan.priorityMedium');
      case 'low': return t('docNursingCarePlan.priorityLow');
      // `priority` comes from the API's `care_level`, a nullable string
      // column, so the three literals the type promises are not guaranteed.
      default: return priority || t('docNursingCarePlan.priorityUnset');
    }
  };

  const getPriorityBadge = (priority: Priority) => {
    const styles: Record<Priority, { bg: string; text: string }> = {
      'high': { bg: 'bg-critical-subtle', text: 'text-critical-subtle-fg' },
      'medium': { bg: 'bg-surface-sunken', text: 'text-content-secondary' },
      'low': { bg: 'bg-surface-sunken', text: 'text-content-secondary' }
    };
    // This is the one that actually crashed. `care_level` is nullable, so a
    // care plan filed without a priority -- which the API permits -- rendered
    // `undefined.bg` and took the whole portal down. The ErrorBoundary sits
    // above the router, so the suite reported the failure against whichever
    // route was visited next.
    const s = styles[priority] ?? { bg: 'bg-surface-sunken', text: 'text-content-secondary' };
    return <span className={`px-2 py-1 rounded text-xs font-medium ${s.bg} ${s.text}`}>{priorityLabel(priority)}</span>;
  };

  const getGoalStatusBadge = (status: GoalStatus) => {
    const styles: Record<GoalStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'not-met': { bg: 'bg-critical-subtle', text: 'text-critical-subtle-fg', icon: <AlertTriangle className="w-3 h-3" /> },
      'partially-met': { bg: 'bg-caution-subtle', text: 'text-caution-subtle-fg', icon: <Clock className="w-3 h-3" /> },
      'met': { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg', icon: <CheckCircle className="w-3 h-3" /> }
    };
    const s = styles[status] ?? {
      bg: 'bg-surface-sunken',
      text: 'text-content-secondary',
      // No icon: an unrecognised goal status must not borrow the glyph of a
      // met or an unmet one.
      icon: null,
    };
    const labels: Record<GoalStatus, string> = {
      'not-met': t('docNursingCarePlan.goalNotMet'),
      'partially-met': t('docNursingCarePlan.goalPartiallyMet'),
      'met': t('docNursingCarePlan.goalMet'),
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {labels[status] ?? (status || t('docNursingCarePlan.statusUnknown'))}
      </span>
    );
  };

  const filteredPlans = plans.filter(p =>
    (p.patientName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    p.mrn.includes(searchQuery) ||
    (p.diagnosis?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const templates: CarePlanTemplate[] = [
    { id: 'T1', name: t('docNursingCarePlan.tpl1Name'), diagnosis: t('docNursingCarePlan.tpl1Dx'), priority: 'high', goals: [t('docNursingCarePlan.tplFallGoal')], interventions: [t('docNursingCarePlan.tplFallIntervention1'), t('docNursingCarePlan.tplFallIntervention2')] },
    { id: 'T2', name: t('docNursingCarePlan.tpl2Name'), diagnosis: t('docNursingCarePlan.tpl2Dx'), priority: 'medium', goals: [t('docNursingCarePlan.tplSkinGoal')], interventions: [t('docNursingCarePlan.tplSkinIntervention1'), t('docNursingCarePlan.tplSkinIntervention2')] },
    { id: 'T3', name: t('docNursingCarePlan.tpl3Name'), diagnosis: t('docNursingCarePlan.tpl3Dx'), priority: 'medium', goals: [t('docNursingCarePlan.tplPainGoal')], interventions: [t('docNursingCarePlan.tplPainIntervention1'), t('docNursingCarePlan.tplPainIntervention2')] },
    { id: 'T4', name: t('docNursingCarePlan.tpl4Name'), diagnosis: t('docNursingCarePlan.tpl4Dx'), priority: 'medium', goals: [t('docNursingCarePlan.tplInfectionGoal')], interventions: [t('docNursingCarePlan.tplInfectionIntervention1'), t('docNursingCarePlan.tplInfectionIntervention2')] },
    { id: 'T5', name: t('docNursingCarePlan.tpl5Name'), diagnosis: t('docNursingCarePlan.tpl5Dx'), priority: 'high', goals: [t('docNursingCarePlan.tplAspirationGoal')], interventions: [t('docNursingCarePlan.tplAspirationIntervention1'), t('docNursingCarePlan.tplAspirationIntervention2')] },
    { id: 'T6', name: t('docNursingCarePlan.tpl6Name'), diagnosis: t('docNursingCarePlan.tpl6Dx'), priority: 'medium', goals: [t('docNursingCarePlan.tplMobilityGoal')], interventions: [t('docNursingCarePlan.tplMobilityIntervention1'), t('docNursingCarePlan.tplMobilityIntervention2')] },
  ];

  const useTemplate = (template: CarePlanTemplate) => {
    setForm(current => ({
      ...current,
      diagnosis: template.diagnosis,
      priority: template.priority,
      goals: template.goals.join('\n'),
      interventions: template.interventions.join('\n'),
    }));
    clearField('diagnosis');
    setActiveTab('new');
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <ClipboardList className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docNursingCarePlan.title')}</h1>
        </div>
        <p className="text-purple-100">{t('docNursingCarePlan.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-content-secondary animate-spin mb-2" />
          <p className="text-content-muted">{t('docNursingCarePlan.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docNursingCarePlan.apiHint')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-content-secondary">{plans.filter(p => p.status === 'active').length}</p>
              <p className="text-xs text-content-muted">{t('docNursingCarePlan.activePlans')}</p>
            </div>
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-critical-subtle-fg">{plans.filter(p => p.priority === 'high').length}</p>
              <p className="text-xs text-content-muted">{t('docNursingCarePlan.highPriority')}</p>
            </div>
            <div className="bg-surface rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-ok-subtle-fg">
                {plans.reduce((acc, p) => acc + p.goals.filter(g => g.status === 'met').length, 0)}
              </p>
              <p className="text-xs text-content-muted">{t('docNursingCarePlan.goalsMet')}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-surface border-b">
            <div className="flex">
              {(['plans', 'new', 'templates'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium ${
                    activeTab === tab ? 'text-content-secondary border-b-2 border-purple-700' : 'text-content-muted'
                  }`}
                >
                  {tab === 'plans' ? t('docNursingCarePlan.tabPlans') : tab === 'new' ? t('docNursingCarePlan.tabNew') : t('docNursingCarePlan.tabTemplates')}
                </button>
              ))}
            </div>
          </div>

          {/* Plans List */}
          {activeTab === 'plans' && (
            <div className="p-4">
              <div className="relative mb-4">
                <label htmlFor="ncp-search" className="sr-only">{t('docNursingCarePlan.searchLabel')}</label>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
                <input
                  id="ncp-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('docNursingCarePlan.searchPlaceholder')}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg"
                />
              </div>

              <div className="space-y-3">
                {filteredPlans.map(plan => (
                  <div key={plan.id} className="bg-surface rounded-lg shadow border overflow-hidden">
                    <div
                      className="p-4 cursor-pointer"
                      {...clickable(() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id))}
                    >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{plan.patientName}</h3>
                        {getPriorityBadge(plan.priority)}
                      </div>
                      <p className="text-sm text-content-muted">{t('docNursingCarePlan.roomMrn', { room: plan.room, mrn: plan.mrn })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(plan.status)}
                      {expandedPlan === plan.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>

                  <div className="bg-surface-sunken rounded p-2 mb-2">
                    <p className="text-sm font-medium text-content-secondary">{plan.diagnosis}</p>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-content-muted">
                    <span><Target className="w-3 h-3 inline mr-1" />{t('docNursingCarePlan.goalsCount', { count: plan.goals.length })}</span>
                    <span><Activity className="w-3 h-3 inline mr-1" />{t('docNursingCarePlan.interventionsCount', { count: plan.interventions.length })}</span>
                    <span><User className="w-3 h-3 inline mr-1" />{plan.createdBy}</span>
                  </div>
                </div>

                {expandedPlan === plan.id && (
                  <div className="border-t p-4 bg-surface-sunken">
                    <div className="mb-4">
                      <h4 className="font-medium mb-2 flex items-center gap-2"><Target className="w-4 h-4" /> {t('docNursingCarePlan.goals')}</h4>
                      <div className="space-y-2">
                        {plan.goals.map(goal => (
                          <div key={goal.id} className="flex items-center justify-between bg-surface p-2 rounded border">
                            <span className="text-sm">{goal.description}</span>
                            {getGoalStatusBadge(goal.status)}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2 flex items-center gap-2"><Activity className="w-4 h-4" /> {t('docNursingCarePlan.interventions')}</h4>
                      <div className="space-y-2">
                        {plan.interventions.map(int => (
                          <div key={int.id} className="flex items-center justify-between bg-surface p-2 rounded border">
                            <div className="flex items-center gap-2">
                              <input type="checkbox" checked={int.completed} readOnly className="w-4 h-4" />
                              <span className={`text-sm ${int.completed ? 'line-through text-content-muted' : ''}`}>{int.description}</span>
                            </div>
                            <span className="text-xs text-content-muted">{int.frequency}</span>
                          </div>
                        ))}
                      </div>
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
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docNursingCarePlan.createCarePlan')}</h2>
            <div className="space-y-4">
              <Select
                id="ncp-patient"
                label={t('docNursingCarePlan.patientRequired')}
                value={form.patientId}
                onChange={(e) => {
                  clearField('patientId');
                  setForm(f => ({ ...f, patientId: e.target.value }));
                }}
                onBlur={() => validateField('patientId', form)}
                error={errors.patientId}
                required
                options={[
                  { value: '', label: t('docNursingCarePlan.selectPatient') },
                  ...patients.map(p => ({ value: p.id, label: `${p.name} - ${p.id}` })),
                ]}
              />
              <Input
                id="ncp-diagnosis"
                type="text"
                label={t('docNursingCarePlan.diagnosisRequired')}
                placeholder={t('docNursingCarePlan.diagnosisPlaceholder')}
                value={form.diagnosis}
                onChange={(e) => {
                  clearField('diagnosis');
                  setForm(f => ({ ...f, diagnosis: e.target.value }));
                }}
                onBlur={() => validateField('diagnosis', form)}
                error={errors.diagnosis}
                required
              />
              <div>
                <label htmlFor="ncp-goals" className="block text-sm font-medium mb-1">{t('docNursingCarePlan.goals')}</label>
                <textarea id="ncp-goals" value={form.goals} onChange={(e) => setForm(f => ({ ...f, goals: e.target.value }))}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2" rows={3}
                  placeholder={t('docNursingCarePlan.goalsPlaceholder')} />
              </div>
              <div>
                <label htmlFor="ncp-interventions" className="block text-sm font-medium mb-1">{t('docNursingCarePlan.interventions')}</label>
                <textarea id="ncp-interventions" value={form.interventions} onChange={(e) => setForm(f => ({ ...f, interventions: e.target.value }))}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2" rows={3}
                  placeholder={t('docNursingCarePlan.interventionsPlaceholder')} />
                <p className="mt-1 text-xs text-content-muted">{t('docNursingCarePlan.templateReviewHint')}</p>
              </div>
              <div role="group" aria-labelledby="ncp-priority-label">
                <label id="ncp-priority-label" className="block text-sm font-medium mb-1">{t('docNursingCarePlan.priorityRequired')}</label>
                <div className="flex gap-2">
                  {(['high', 'medium', 'low'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setForm(f => ({ ...f, priority: p }))}
                      aria-pressed={form.priority === p}
                      className={`flex-1 py-2 rounded-lg border capitalize ${form.priority === p ? 'ring-2 ring-offset-1 ring-purple-500 ' : ''}${p === 'high' ? 'bg-critical-subtle border-critical text-critical-subtle-fg' : p === 'medium' ? 'bg-surface-sunken border-orange-300 text-content-secondary' : 'bg-surface-sunken border-border-strong'}`}>
                      {priorityLabel(p)}
                    </button>
                  ))}
                </div>
              </div>
              {saveMessage && (
                <p className="text-sm text-center text-content-secondary" role="status">{saveMessage}</p>
              )}
              <button
                onClick={createPlan}
                disabled={saving}
                className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Plus className="w-5 h-5" /> {t('docNursingCarePlan.createCarePlan')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates */}
      {activeTab === 'templates' && (
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-4">{t('docNursingCarePlan.templatesTitle')}</h2>
          <div className="grid gap-3">
            {templates.map(tpl => (
              <div key={tpl.id} className="bg-surface rounded-lg shadow border p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{tpl.name}</h3>
                  <p className="text-sm text-content-muted">{tpl.diagnosis}</p>
                  <p className="text-xs text-content-muted">{t('docNursingCarePlan.goalsCount', { count: tpl.goals.length })} · {t('docNursingCarePlan.interventionsCount', { count: tpl.interventions.length })}</p>
                </div>
                <button type="button" onClick={() => useTemplate(tpl)} className="px-4 py-2 bg-surface-sunken text-content-secondary rounded-lg text-sm font-medium">{t('docNursingCarePlan.useTemplate')}</button>
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
