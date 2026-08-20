import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { apiUrl, useTranslation, RestrictedSection } from '@medichain/shared';
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

/** Counted operational indicators, from `/api/platform/analytics/operations`. */
interface OperationalMetrics {
  measured: {
    radiology_queue: number;
    lab_pending: number;
    lab_turnaround_median_minutes: number | null;
    unacknowledged_critical_values: number;
    patient_satisfaction_average: number | null;
    patient_satisfaction_responses: number;
  };
  /** Indicators this deployment has no model for. Named, never estimated. */
  unmeasured: string[];
}

/** One outstanding event on the activity table. */
interface RecentEvent {
  id: string;
  when: string;
  label: string;
  patientId: string;
}

/**
 * A single indicator row.
 *
 * `null` renders as "not available" rather than as `0` or a dash that could be
 * read as a measurement — the distinction this whole page previously lost.
 */
function MetricRow({
  label,
  value,
  hint,
  urgent,
}: {
  label: string;
  value: string | null;
  hint?: string;
  urgent?: boolean;
}) {
  // `text-gray-400` on `bg-gray-50` measures 2.43:1 — WCAG AA wants 4.5:1 for
  // normal text. It was used here for the unmeasured rows and the em dash, on
  // the theory that absent data should recede. Absent data should be *legible*
  // and unemphasised; those are not the same thing, and greying it to the point
  // of illegibility is how a reader mistakes "not measured" for "nothing here".
  // `gray-600` on `gray-50` measures 7.0:1 and still reads as secondary.
  const tone = value == null ? 'bg-surface-sunken' : urgent ? 'bg-critical-subtle' : 'bg-ok-subtle';
  const text = value == null ? 'text-content-muted' : urgent ? 'text-critical-subtle-fg' : 'text-ok-subtle-fg';
  // Urgency must not be carried by hue alone: red-on-pale-red is invisible to a
  // reader with deuteranopia or protanopia, and this row is the most
  // time-critical number on the page. The icon and the border give it two more
  // channels, so it survives being printed, dimmed, or seen by someone who does
  // not perceive the red at all.
  const edge = urgent ? 'border-l-4 border-red-700' : 'border-l-4 border-transparent';
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg ${tone} ${edge}`}>
      <span className="text-sm text-content-secondary">
        <span className="inline-flex items-center gap-1.5">
          {urgent && <AlertCircle className="w-4 h-4 text-critical-subtle-fg shrink-0" aria-hidden="true" />}
          {label}
        </span>
        {hint && <span className="block text-xs text-content-muted">{hint}</span>}
      </span>
      <span className={`text-lg font-bold ${text}`}>{value ?? '—'}</span>
    </div>
  );
}

/**
 * AnalyticsPage
 * 
 * Page for hospital operations analytics and dashboards.
 */
const AnalyticsPage: React.FC = () => {
  // This section is administrator-only server-side; without the gate below the
  // page received a correct 403 and then rendered nothing, which reads as a
  // fault rather than a permissions boundary.
  //
  // The gate must come *after* every hook. Returning early above them meant a
  // render as a non-administrator ran eight fewer hooks than a render as an
  // administrator, and React throws "Rendered fewer hooks than expected" the
  // moment the role changes without a remount — an identity-context switch or
  // a role refresh crashes the app rather than showing the notice.
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const isAdministrator = user?.role === 'Admin';
  const [selectedPeriod, setSelectedPeriod] = useState<MetricPeriod>('today');
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [departmentData, setDepartmentData] = useState<DepartmentMetrics[]>([]);
  const [patientFlow, setPatientFlow] = useState<PatientFlowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operations, setOperations] = useState<OperationalMetrics | null>(null);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);

  /**
   * Calendar periods, not trailing windows.
   *
   * This used to return `[N days ago, today]` for every option, which broke the
   * labels in two ways at once. "This Year" meant the last 365 days rather than
   * the calendar year, so on 20 August it silently excluded January-to-August of
   * the *previous* year's tail and, far worse, **every appointment scheduled
   * after today** — because `endDate` was always today. On a booking dashboard
   * that is the wrong half of the data: most appointments are in the future.
   * "This Year" reported 17 while 44 existed in the calendar year.
   *
   * Weeks start Monday, which is the working-week convention in the clinics
   * this is built for.
   */
  const getDateRange = (period: MetricPeriod): { startDate: string; endDate: string } => {
    const iso = (d: Date) => {
      // Local calendar date, not UTC: `toISOString()` shifts the day backwards
      // for any timezone east of UTC, so a clinic in SAST asking for "today"
      // would be handed yesterday for the first two hours of every morning.
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const now = new Date();

    switch (period) {
      case 'week': {
        const start = new Date(now);
        // getDay(): 0 = Sunday. Shift so Monday is the first day.
        const daysSinceMonday = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - daysSinceMonday);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return { startDate: iso(start), endDate: iso(end) };
      }
      case 'month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { startDate: iso(start), endDate: iso(end) };
      }
      case 'year': {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31);
        return { startDate: iso(start), endDate: iso(end) };
      }
      case 'today':
      default:
        return { startDate: iso(now), endDate: iso(now) };
    }
  };

  useEffect(() => {
    const fetchAnalytics = async () => {
      // Skip the fetch rather than skip the hook: a non-administrator would
      // otherwise spend a request to be told 403 on a screen they cannot see.
      if (!user?.walletAddress || !isAdministrator) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Calculate date range from selected period
        const { startDate, endDate } = getDateRange(selectedPeriod);
        
        // Fetch dashboard metrics from API with proper date parameters
        const response = await fetch(apiUrl(`/api/platform/analytics/dashboard?start_date=${startDate}&end_date=${endDate}`), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor'
          }
        });

        if (response.status === 403) {
          throw new Error('Analytics are available to administrators only.');
        }

        if (!response.ok) {
          throw new Error('Unable to load analytics right now.');
        }

        const data = await response.json();

        // The dashboard endpoint returns a flat `metrics` object. This block
        // used to read `data.patient_metrics.total_patients`,
        // `data.appointment_metrics`, `data.cds_metrics` and
        // `data.department_metrics` — four shapes the API has never sent. Every
        // lookup was `undefined`, every `|| 0` fallback fired, and the page
        // reported a hospital with 0 patients, 0 appointments and 0 alerts. A
        // wrong field name renders as a confident zero, not as an error, which
        // is why this survived: the tiles looked like working tiles.
        const dash = (data.metrics ?? {}) as Record<string, number | string | null>;

        // Appointment figures come from the endpoint that actually aggregates
        // them, scoped to the selected period.
        const apptResponse = await fetch(
          apiUrl(`/api/platform/analytics/appointments?start_date=${startDate}&end_date=${endDate}`),
          {
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': user.walletAddress,
              'X-Provider-Role': user.role || 'Doctor',
            },
          }
        );
        const appts = apptResponse.ok
          ? ((await apptResponse.json()) as Record<string, number | null>)
          : {};

        // Clinical-alert counts live on the quality endpoint.
        const qualityResponse = await fetch(apiUrl('/api/platform/analytics/quality'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor',
          },
        });
        const quality = qualityResponse.ok
          ? ((await qualityResponse.json()) as Record<string, number | null>)
          : {};

        const telehealthPct = appts.telehealth_percentage;

        setMetrics([
          {
            title: t('docAnalytics.metricTotalPatients'),
            value: Number(dash.total_patients ?? 0),
            change: t('docAnalytics.changeRecordsOnFile', {
              count: Number(dash.total_medical_records ?? 0),
            }),
            trend: 'stable',
            icon: <Users className="w-6 h-6" />,
            color: 'blue',
          },
          {
            title: t('docAnalytics.metricAppointments'),
            value: Number(appts.total_appointments ?? 0),
            change: t('docAnalytics.changeCompleted', {
              count: Number(appts.completed_appointments ?? 0),
            }),
            trend: 'stable',
            icon: <Clock className="w-6 h-6" />,
            color: 'green',
          },
          {
            // Null when no appointment falls in the period — "0% telehealth"
            // and "no appointments at all" are different facts.
            title: t('docAnalytics.metricTelehealthPct'),
            value:
              typeof telehealthPct === 'number' ? `${telehealthPct.toFixed(1)}%` : '—',
            change: t('docAnalytics.changeOfAppointments'),
            trend: 'stable',
            icon: <Activity className="w-6 h-6" />,
            color: 'purple',
          },
          {
            title: t('docAnalytics.metricCDSAlerts'),
            value: Number(quality.clinical_alerts_total ?? 0),
            change: t('docAnalytics.changeCritical', {
              count: Number(quality.critical_alerts ?? 0),
            }),
            trend: Number(quality.critical_alerts ?? 0) > 0 ? 'up' : 'stable',
            icon: <AlertCircle className="w-6 h-6" />,
            color: 'red',
          },
        ]);

        // Department performance (bed occupancy, average wait, staff on duty)
        // and hourly patient flow (admissions/discharges/transfers) have no
        // source in this deployment — there is no bed, roster or encounter-flow
        // model to aggregate. They stay empty on purpose and the panels say so,
        // for the same reason the operational panel below names what it cannot
        // measure instead of estimating it. Restoring them means building the
        // model first, not inventing a plausible series.
        setDepartmentData([]);
        setPatientFlow([]);

        // Operational indicators and the outstanding-events table. Fetched
        // separately because they are counted from stored records rather than
        // aggregated over the selected period, and a failure here must not
        // blank the metrics above.
        try {
          const opsResponse = await fetch(apiUrl('/api/platform/analytics/operations'), {
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': user.walletAddress,
            },
          });
          if (opsResponse.ok) {
            setOperations((await opsResponse.json()) as OperationalMetrics);
          }

          const criticalResponse = await fetch(apiUrl('/api/platform/list/critical-values'), {
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': user.walletAddress,
            },
          });
          if (criticalResponse.ok) {
            const rows = (await criticalResponse.json()) as Array<Record<string, unknown>>;
            setRecentEvents(
              (Array.isArray(rows) ? rows : [])
                .filter((row) => !row.acknowledged_at)
                .slice(0, 10)
                .map((row) => {
                  const at = (row.notified_at ?? row.created_at) as string | undefined;
                  const when = at ? new Date(at) : null;
                  return {
                    id: String(row.id ?? ''),
                    when: when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : '—',
                    label: `${row.test_name ?? 'Critical value'}: ${row.value ?? ''}${row.unit ? ` ${row.unit}` : ''}`,
                    patientId: String(row.patient_id ?? '—'),
                  };
                })
            );
          }
        } catch (opsError) {
          console.error('Error fetching operational metrics:', opsError);
        }

      } catch (err) {
        console.error('Error fetching analytics:', err);
        setError(err instanceof Error ? err.message : t('docAnalytics.errorTitle'));
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
        return { bg: 'bg-notice-subtle', text: 'text-notice-subtle-fg', border: 'border-notice' };
      case 'green':
        return { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg', border: 'border-ok' };
      case 'purple':
        return { bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-200' };
      case 'red':
        return { bg: 'bg-critical-subtle', text: 'text-critical-subtle-fg', border: 'border-critical' };
      default:
        return { bg: 'bg-surface-sunken', text: 'text-content-muted', border: 'border-border' };
    }
  };

  const getDepartmentName = (dept: DepartmentType) => {
    switch (dept) {
      case 'emergency':
        return t('docAnalytics.dept_emergency');
      case 'surgery':
        return t('docAnalytics.dept_surgery');
      case 'medicine':
        return t('docAnalytics.dept_medicine');
      case 'pediatrics':
        return t('docAnalytics.dept_pediatrics');
      case 'radiology':
        return t('docAnalytics.dept_radiology');
      case 'laboratory':
        return t('docAnalytics.dept_laboratory');
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
    if (occupancy >= 90) return { color: 'red', label: t('docAnalytics.occupancy_Critical') };
    if (occupancy >= 75) return { color: 'orange', label: t('docAnalytics.occupancy_High') };
    if (occupancy >= 50) return { color: 'green', label: t('docAnalytics.occupancy_Optimal') };
    return { color: 'blue', label: t('docAnalytics.occupancy_Low') };
  };

  // Every hook above has run by now, so this early return is safe: the hook
  // count is identical for an administrator and for anyone else.
  if (!isAdministrator) {
    return (
      <RestrictedSection
        title="Analytics"
        audience="administrators"
        currentRole={user?.role}
      />
    );
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          <span className="ml-2 text-content-muted">{t('docAnalytics.loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-critical-subtle border border-critical text-critical-subtle-fg px-4 py-3 rounded-lg">
          <p className="font-medium">{t('docAnalytics.errorTitle')}</p>
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
            <h1 className="text-3xl font-bold">{t('docAnalytics.title')}</h1>
            <p className="text-purple-50 mt-1">{t('docAnalytics.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setSelectedPeriod('today')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selectedPeriod === 'today'
              ? 'bg-purple-600 text-white'
              : 'bg-surface text-content-secondary border border-border-strong hover:bg-surface-sunken'
          }`}
        >
          {t('docAnalytics.periodToday')}
        </button>
        <button
          onClick={() => setSelectedPeriod('week')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selectedPeriod === 'week'
              ? 'bg-purple-600 text-white'
              : 'bg-surface text-content-secondary border border-border-strong hover:bg-surface-sunken'
          }`}
        >
          {t('docAnalytics.periodWeek')}
        </button>
        <button
          onClick={() => setSelectedPeriod('month')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selectedPeriod === 'month'
              ? 'bg-purple-600 text-white'
              : 'bg-surface text-content-secondary border border-border-strong hover:bg-surface-sunken'
          }`}
        >
          {t('docAnalytics.periodMonth')}
        </button>
        <button
          onClick={() => setSelectedPeriod('year')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selectedPeriod === 'year'
              ? 'bg-purple-600 text-white'
              : 'bg-surface text-content-secondary border border-border-strong hover:bg-surface-sunken'
          }`}
        >
          {t('docAnalytics.periodYear')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        {metrics.map((metric, idx) => {
          const colors = getColorClasses(metric.color);
          return (
            <div key={idx} className={`bg-surface rounded-lg shadow p-6 border ${colors.border}`}>
              <div className="flex items-center justify-between mb-4">
                <div className={`${colors.bg} ${colors.text} p-3 rounded-lg`}>
                  {metric.icon}
                </div>
                <div className={`flex items-center gap-1 ${metric.trend === 'up' ? 'text-ok-subtle-fg' : metric.trend === 'down' ? 'text-critical-subtle-fg' : 'text-content-muted'}`}>
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
              <div className="text-2xl font-bold text-content mb-1">{metric.value}</div>
              <div className="text-sm text-content-muted">{metric.title}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-surface rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-content mb-4 flex items-center gap-2">
            <Users className="w-6 h-6 text-purple-600" />
            {t('docAnalytics.departmentPerformance')}
          </h2>
          <div className="space-y-4">
            {departmentData.length === 0 && (
              <p className="text-sm text-content-muted">
                {t('docAnalytics.departmentNoSource')}
              </p>
            )}
            {departmentData.map((dept) => {
              const color = getDepartmentColor(dept.department);
              const colors = getColorClasses(color);
              const occupancyStatus = getOccupancyStatus(dept.bedOccupancy);
              
              return (
                <div key={dept.department} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`${colors.bg} ${colors.text} p-2 rounded`}>
                        <Activity className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-content">{getDepartmentName(dept.department)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-content-muted" />
                      <span className="text-sm text-content-muted">{t('docAnalytics.staffCount', { count: dept.staffOnDuty })}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-notice-subtle rounded p-2">
                      <div className="text-notice-subtle-fg font-medium">{t('docAnalytics.lblPatients')}</div>
                      <div className="text-notice-subtle-fg text-lg font-bold">{dept.patients}</div>
                    </div>
                    <div className="bg-ok-subtle rounded p-2">
                      <div className="text-ok-subtle-fg font-medium">{t('docAnalytics.lblWaitTime')}</div>
                      <div className="text-ok-subtle-fg text-lg font-bold">{t('docAnalytics.minutesSuffix', { count: dept.avgWaitTime })}</div>
                    </div>
                    {dept.bedOccupancy > 0 ? (
                      <div className={`bg-${occupancyStatus.color}-50 rounded p-2`}>
                        <div className={`text-${occupancyStatus.color}-700 font-medium`}>{t('docAnalytics.lblOccupancy')}</div>
                        <div className={`text-${occupancyStatus.color}-900 text-lg font-bold flex items-center gap-1`}>
                          {dept.bedOccupancy}%
                          <span className="text-xs font-normal">({occupancyStatus.label})</span>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-surface-sunken rounded p-2">
                        <div className="text-content-secondary font-medium">{t('docAnalytics.naLabel')}</div>
                        <div className="text-content text-lg font-bold">—</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-surface rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-content mb-4 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-purple-600" />
            {t('docAnalytics.patientFlowTitle')}
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-4 pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="text-sm text-content-secondary">{t('docAnalytics.legendAdmissions')}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-sm text-content-secondary">{t('docAnalytics.legendDischarges')}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                <span className="text-sm text-content-secondary">{t('docAnalytics.legendTransfers')}</span>
              </div>
            </div>
            
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {patientFlow.length === 0 && (
                <p className="text-sm text-content-muted pt-2">
                  {t('docAnalytics.patientFlowNoSource')}
                </p>
              )}
              {patientFlow.map((data) => {
                const maxValue = Math.max(
                  ...patientFlow.map(d => Math.max(d.admissions, d.discharges, d.transfers))
                );
                
                return (
                  <div key={data.hour} className="space-y-1">
                    <div className="text-xs font-medium text-content-muted">{data.hour}</div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="bg-surface-sunken rounded-full overflow-hidden h-2">
                          <div
                            className="bg-blue-500 h-full rounded-full"
                            style={{ width: `${(data.admissions / maxValue) * 100}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-content-muted mt-0.5">{data.admissions}</div>
                      </div>
                      <div className="flex-1">
                        <div className="bg-surface-sunken rounded-full overflow-hidden h-2">
                          <div
                            className="bg-green-500 h-full rounded-full"
                            style={{ width: `${(data.discharges / maxValue) * 100}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-content-muted mt-0.5">{data.discharges}</div>
                      </div>
                      <div className="flex-1">
                        <div className="bg-surface-sunken rounded-full overflow-hidden h-2">
                          <div
                            className="bg-orange-500 h-full rounded-full"
                            style={{ width: `${(data.transfers / maxValue) * 100}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-content-muted mt-0.5">{data.transfers}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Operational indicators.
          These three panels were twelve hardcoded literals — 94% satisfaction,
          a 32-minute ED wait, 112% ED overcapacity, "2 ventilators left" —
          rendered with the same confidence as the real figures beside them.
          Everything here is now counted from stored records, and anything this
          deployment cannot measure is named as unmeasured rather than
          estimated. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-surface rounded-lg shadow p-6">
          <h3 className="text-lg font-bold text-content mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-ok-subtle-fg" />
            {t('docAnalytics.measuredTitle')}
          </h3>
          <div className="space-y-3">
            <MetricRow
              label={t('docAnalytics.metric_patientSatisfaction')}
              value={
                operations?.measured?.patient_satisfaction_average != null
                  ? `${operations.measured!.patient_satisfaction_average!.toFixed(1)} / 5`
                  : null
              }
              hint={t('docAnalytics.responsesCount', {
                count: operations?.measured?.patient_satisfaction_responses ?? 0,
              })}
            />
            <MetricRow
              label={t('docAnalytics.metric_labTurnaround')}
              value={
                operations?.measured?.lab_turnaround_median_minutes != null
                  ? t('docAnalytics.minutesMedian', {
                      minutes: operations.measured!.lab_turnaround_median_minutes,
                    })
                  : null
              }
            />
            <MetricRow
              label={t('docAnalytics.metric_radiologyQueue')}
              value={operations?.measured ? String(operations.measured.radiology_queue) : null}
            />
            <MetricRow
              label={t('docAnalytics.metric_labPending')}
              value={operations?.measured ? String(operations.measured.lab_pending) : null}
            />
            <MetricRow
              label={t('docAnalytics.metric_unackCriticalValues')}
              value={operations?.measured ? String(operations.measured.unacknowledged_critical_values) : null}
              urgent={(operations?.measured?.unacknowledged_critical_values ?? 0) > 0}
            />
          </div>
        </div>

        <div className="bg-surface rounded-lg shadow p-6">
          <h3 className="text-lg font-bold text-content mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-content-muted" />
            {t('docAnalytics.unmeasuredTitle')}
          </h3>
          <p className="text-sm text-content-muted mb-3">{t('docAnalytics.unmeasuredHint')}</p>
          <ul className="space-y-2">
            {(operations?.unmeasured ?? []).map((key) => (
              <li key={key} className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                <span className="text-sm text-content-secondary">
                  {t(`docAnalytics.unmeasured_${key}`)}
                </span>
                <span className="text-sm text-content-muted">{t('docAnalytics.notMeasured')}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bg-surface rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-content mb-4 flex items-center gap-2">
          <Calendar className="w-6 h-6 text-purple-600" />
          {t('docAnalytics.recentActivityTitle')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-sunken">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase tracking-wider">{t('docAnalytics.colTime')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase tracking-wider">{t('docAnalytics.colEvent')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase tracking-wider">{t('docAnalytics.colDepartment')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase tracking-wider">{t('docAnalytics.colImpact')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase tracking-wider">{t('docAnalytics.colStatus')}</th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-border">
              {/* Five invented incidents used to live here — "Mass casualty
                  incident alert", "Ventilator shortage" — with fixed times, on
                  a screen an executive reads to decide where to send staff.
                  Replaced with the real unacknowledged critical values, which
                  are the actual outstanding events this system knows about. */}
              {recentEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-content-muted">
                    {t('docAnalytics.noRecentActivity')}
                  </td>
                </tr>
              ) : (
                recentEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-4 py-3 text-sm text-content">{event.when}</td>
                    <td className="px-4 py-3 text-sm text-content">{event.label}</td>
                    <td className="px-4 py-3 text-sm text-content-muted">{event.patientId}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-critical-subtle text-critical-subtle-fg">
                        {t('docAnalytics.impactHigh')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800">
                        {t('docAnalytics.statusUnacknowledged')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPage;
