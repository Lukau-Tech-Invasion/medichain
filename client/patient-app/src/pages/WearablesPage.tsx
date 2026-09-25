import React, { useState, useEffect, useCallback } from 'react';
import {
  Watch,
  Smartphone,
  Heart,
  Moon,
  Activity,
  Unlink,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle,
  Clock,
  Bluetooth,
  Zap,
  Loader2
} from 'lucide-react';
import {
  createWearableAlertRule,
  disconnectWearableDevice,
  getUserSettings,
  saveUserSettings,
  getApiErrorMessage,
  getSupportedWearables,
  getWearableAlerts,
  getWearableDevices,
  getWearableReadings,
  listWearableAlertRules,
  registerWearableDevice,
  useTranslation,
  confirmDialog,
  formatDateOnly,
} from '@medichain/shared';
import type {
  SupportedWearable,
  WearableAlert,
  WearableAlertRule,
} from '@medichain/shared';
import type { WearableDevice, WearableReading } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/**
 * WearablesPage
 * 
 * Page for syncing and viewing data from wearable health devices.
 * Integrates with Apple Health / Google Fit / Fitbit / Garmin.
 */

export type DeviceType = 'apple-watch' | 'fitbit' | 'garmin' | 'samsung' | 'google-fit' | 'oura';
export type MetricType = 'heart-rate' | 'steps' | 'calories' | 'sleep' | 'spo2' | 'hrv' | 'stress';
export type SyncStatus = 'connected' | 'disconnected' | 'syncing' | 'error';
export type TrendDirection = 'up' | 'down' | 'stable';

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  model: string;
  status: SyncStatus;
  lastSync: Date | null;
  batteryLevel?: number;
}

export interface HealthMetric {
  type: MetricType;
  name: string;
  value: number;
  unit: string;
  trend: TrendDirection;
  trendPercent: number;
  goal?: number;
  icon: React.ReactNode;
  color: string;
  history: { date: string; value: number }[];
}

export interface ActivityRing {
  name: string;
  current: number;
  goal: number;
  color: string;
}

const DISPLAY_TYPE_BY_MANUFACTURER: Record<string, DeviceType> = {
  apple: 'apple-watch',
  fitbit: 'fitbit',
  garmin: 'garmin',
  samsung: 'samsung',
  google: 'google-fit',
  oura: 'oura',
};

const displayTypeFor = (manufacturer?: string): DeviceType =>
  DISPLAY_TYPE_BY_MANUFACTURER[manufacturer?.toLowerCase() ?? ''] ?? 'google-fit';

const mapDevice = (device: WearableDevice): Device => ({
  id: device.device_id,
  name: `${device.manufacturer} ${device.model}`.trim(),
  type: displayTypeFor(device.manufacturer),
  model: device.model,
  status: device.connection_status === 'Connected' ? 'connected' : 'disconnected',
  lastSync: device.last_sync ? new Date(device.last_sync * 1000) : null,
  batteryLevel: device.battery_level ?? undefined,
});

const metricTypeFor = (dataType: string): MetricType | undefined => ({
  HeartRate: 'heart-rate', Steps: 'steps', Calories: 'calories', Sleep: 'sleep',
  SpO2: 'spo2', HRV: 'hrv', Stress: 'stress',
} as Record<string, MetricType>)[dataType];

const mapLatestMetrics = (readings: WearableReading[]): HealthMetric[] => {
  const latest = new Map<MetricType, WearableReading>();
  readings.forEach((reading) => {
    const type = metricTypeFor(reading.data_type);
    if (type && (!latest.has(type) || latest.get(type)!.recorded_at < reading.recorded_at)) {
      latest.set(type, reading);
    }
  });
  return [...latest.entries()].map(([type, reading]) => ({
    type, name: type, value: reading.value, unit: reading.unit, trend: 'stable', trendPercent: 0,
    icon: <Activity className="w-6 h-6" />, color: 'text-content-secondary',
    history: [{ date: formatDateOnly(reading.recorded_at * 1000), value: reading.value }],
  }));
};

/**
 * The platforms a patient can connect, and the manufacturer the API stores.
 *
 * `manufacturer` is separate from the label on purpose: "Apple Health" is what
 * a patient recognises, "Apple" is what `/api/wearables/supported` lists models
 * under, and the registration endpoint wants the latter.
 */
const ADD_DEVICE_PLATFORMS = [
  { name: 'Apple Health', manufacturer: 'Apple', apiDeviceType: 'smartwatch', icon: <Heart className="w-6 h-6" />, color: 'bg-critical-subtle text-critical-subtle-fg', type: 'apple-watch' },
  { name: 'Google Fit', manufacturer: 'Google', apiDeviceType: 'smartwatch', icon: <Activity className="w-6 h-6" />, color: 'bg-notice-subtle text-notice-subtle-fg', type: 'google-fit' },
  { name: 'Fitbit', manufacturer: 'Fitbit', apiDeviceType: 'fitness_band', icon: <Watch className="w-6 h-6" />, color: 'bg-surface-sunken text-content-secondary', type: 'fitbit' },
  { name: 'Garmin', manufacturer: 'Garmin', apiDeviceType: 'smartwatch', icon: <Watch className="w-6 h-6" />, color: 'bg-surface-sunken text-content-secondary', type: 'garmin' },
  { name: 'Samsung Health', manufacturer: 'Samsung', apiDeviceType: 'smartwatch', icon: <Heart className="w-6 h-6" />, color: 'bg-surface-sunken text-content-secondary', type: 'samsung' },
  { name: 'Oura Ring', manufacturer: 'Oura', apiDeviceType: 'fitness_band', icon: <Moon className="w-6 h-6" />, color: 'bg-surface-sunken text-content-muted', type: 'oura' },
];

const WearablesPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'devices' | 'settings'>('dashboard');

  // --- Adding a device has never worked --------------------------------------
  //
  // The buttons below sent `{device_type, device_name, patient_id}`.
  // `RegisterWearableRequest` requires `{device_type, manufacturer, model}`, so
  // every click was refused with
  // `400 missing field \`manufacturer\`` -- and the handler swallowed it into a
  // `console.warn`, so the button did nothing and said nothing. Connecting a
  // wearable was impossible from the product.
  //
  // The model is asked for rather than invented. It is not decoration: the
  // supported-wearables catalogue lists different data types per model, so
  // "Fitbit" alone does not say what this device can report. `/api/wearables/supported`
  // is the server's own list, which is why the models offered here are real
  // ones rather than a second copy that can drift.
  const [catalogue, setCatalogue] = useState<SupportedWearable[]>([]);
  const [pendingManufacturer, setPendingManufacturer] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [registerBusy, setRegisterBusy] = useState(false);

  useEffect(() => {
    getSupportedWearables()
      .then((body) => setCatalogue(body.supported_manufacturers ?? []))
      .catch(() => setCatalogue([]));
  }, []);

  const modelsFor = (manufacturer: string): string[] =>
    catalogue.find((entry) => entry.manufacturer.toLowerCase() === manufacturer.toLowerCase())
      ?.models ?? [];

  const registerDevice = async (deviceType: string, manufacturer: string) => {
    if (!pendingModel) {
      setRegisterError(t('wearables.registerNeedsModel'));
      return;
    }
    setRegisterError('');
    setRegisterBusy(true);
    try {
      await registerWearableDevice({
        device_type: deviceType,
        manufacturer,
        model: pendingModel,
      });
      setPendingManufacturer(null);
      setPendingModel('');
      loadWearableData();
    } catch (err) {
      // Said out loud. A button that fails silently is why this went unnoticed.
      setRegisterError(getApiErrorMessage(err, t('wearables.registerFailed')));
    } finally {
      setRegisterBusy(false);
    }
  };


  // --- Settings that are actually settings ------------------------------------
  //
  // The six sync toggles and two sharing toggles below rendered from literals
  // in a `.map()` array with no `onChange`, and "Disconnect all" had no
  // handler. They looked settable, nothing was stored, and nothing read them
  // back -- a patient turning off "sync over cellular" got the same result as
  // not touching it, with no way to tell.
  //
  // `GET`/`POST /api/settings` already persists this account's other UI
  // preferences, so these go there. The disconnect button now has an endpoint
  // to call: `POST /api/wearables/devices/{id}/disconnect` is new, because a
  // patient could connect a wearable and never stop it.
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const [prefsNotice, setPrefsNotice] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUserSettings<{ wearables?: Record<string, boolean> }>()
      .then((settings) => {
        if (!cancelled) setPrefs(settings.wearables ?? {});
      })
      .catch(() => {
        // Unreadable preferences are shown as their defaults; the alternative
        // is a screen of toggles in an unknown position, which is worse.
        if (!cancelled) setPrefsError(t('wearables.prefsLoadFailed'));
      })
      .finally(() => {
        if (!cancelled) setPrefsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const togglePref = async (key: string, fallback: boolean) => {
    const next = { ...prefs, [key]: !(prefs[key] ?? fallback) };
    setPrefs(next);
    setPrefsError('');
    try {
      // Merge rather than replace: this page owns `wearables` and must not
      // discard the notification or display preferences stored alongside it.
      const current = await getUserSettings<Record<string, unknown>>().catch(() => ({}));
      await saveUserSettings({ ...current, wearables: next });
    } catch (err) {
      // Put the toggle back. A switch that stays where the finger left it while
      // the server never heard is the failure this whole section existed as.
      setPrefs(prefs);
      setPrefsError(getApiErrorMessage(err, t('wearables.prefsSaveFailed')));
    }
  };

  const disconnectAll = async () => {
    if (devices.length === 0) return;
    setPrefsError('');
    setPrefsNotice('');
    setDisconnecting(true);
    const failed: string[] = [];
    for (const device of devices) {
      try {
        await disconnectWearableDevice(device.id);
      } catch {
        failed.push(device.name || device.id);
      }
    }
    setDisconnecting(false);
    if (failed.length > 0) {
      // Naming what did NOT disconnect: "some devices were disconnected" would
      // leave a patient believing a device stopped streaming when it did not.
      setPrefsError(t('wearables.disconnectPartial', { devices: failed.join(', ') }));
    } else {
      setPrefsNotice(t('wearables.disconnectAllDone'));
    }
    loadWearableData();
  };


  // --- Alerting ---------------------------------------------------------------
  //
  // A patient could connect a device and stream readings, and nothing could
  // ever alert them: no screen called `createWearableAlertRule`, nothing read
  // the saved rules back, and nothing showed the alerts they raised. The whole
  // alerting half of the feature existed only in Rust.
  //
  // That a rule could never be read back is also why nobody noticed the server
  // stored every rule as "above 0.0" -- true of every reading a wearable sends.
  const [alertRules, setAlertRules] = useState<WearableAlertRule[]>([]);
  const [alerts, setAlerts] = useState<WearableAlert[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  // An empty rule list and a failed read are opposite answers to "am I being
  // watched for this", and the first is the dangerous one to assert.
  const [alertsUnknown, setAlertsUnknown] = useState(false);
  const [ruleError, setRuleError] = useState('');
  const [ruleNotice, setRuleNotice] = useState('');
  const [ruleBusy, setRuleBusy] = useState(false);
  const [ruleDataType, setRuleDataType] = useState('HeartRate');
  const [ruleLow, setRuleLow] = useState('');
  const [ruleHigh, setRuleHigh] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState('Warning');

  const loadAlerting = useCallback(async () => {
    const [rules, raised] = await Promise.allSettled([
      listWearableAlertRules(),
      getWearableAlerts(),
    ]);
    if (rules.status === 'fulfilled') {
      setAlertRules(rules.value.rules ?? []);
      setAlertsUnknown(false);
    } else {
      setAlertsUnknown(true);
    }
    if (raised.status === 'fulfilled') setAlerts(raised.value.alerts ?? []);
    setAlertsLoaded(true);
  }, []);

  useEffect(() => {
    void loadAlerting();
  }, [loadAlerting]);

  const submitRule = async (event: React.FormEvent) => {
    event.preventDefault();
    setRuleError('');
    setRuleNotice('');
    // A rule with neither bound is refused by the server too. Saying so here
    // names the missing field instead of returning a generic failure.
    if (!ruleLow.trim() && !ruleHigh.trim()) {
      setRuleError(t('wearables.ruleNeedsABound'));
      return;
    }
    setRuleBusy(true);
    try {
      await createWearableAlertRule({
        device_id: devices[0]?.id ?? '',
        data_type: ruleDataType,
        // A field nobody filled is absent, not zero: `threshold_low: 0` would
        // mean "alert me below zero", which is a different rule entirely.
        threshold_low: ruleLow.trim() ? Number(ruleLow) : null,
        threshold_high: ruleHigh.trim() ? Number(ruleHigh) : null,
        severity: ruleSeverity,
      });
      setRuleNotice(t('wearables.ruleSaved'));
      setRuleLow('');
      setRuleHigh('');
      await loadAlerting();
    } catch (err) {
      setRuleError(getApiErrorMessage(err, t('wearables.ruleFailed')));
    } finally {
      setRuleBusy(false);
    }
  };

  /** What a stored rule actually watches, in the patient's words. */
  const describeRule = (rule: WearableAlertRule): string => {
    const dataType =
      typeof rule.data_type === 'string' ? rule.data_type : Object.values(rule.data_type)[0];
    if (rule.threshold_type === 'OutsideRange') {
      return t('wearables.ruleOutside', {
        type: dataType,
        low: String(rule.secondary_threshold ?? ''),
        high: String(rule.threshold_value),
      });
    }
    if (rule.threshold_type === 'Below') {
      return t('wearables.ruleBelow', { type: dataType, value: String(rule.threshold_value) });
    }
    return t('wearables.ruleAbove', { type: dataType, value: String(rule.threshold_value) });
  };

  const [devices, setDevices] = useState<Device[]>([]);
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<HealthMetric | null>(null);
  const [activityRings] = useState<ActivityRing[]>([]);
  const [loading, setLoading] = useState(true);
  const { patient } = usePatientAuthStore();

  const loadWearableData = useCallback(async () => {
    setLoading(true);
    
    // Try to load from API first
    if (patient?.healthId) {
      try {
        const deviceResponse = await getWearableDevices();
        const apiDevices = deviceResponse.devices;
        const readingResponses = await Promise.all(
          apiDevices.map((device) => getWearableReadings(device.device_id))
        );
        const apiReadings = readingResponses.flatMap((response) => response.readings);
        
        if (apiDevices.length > 0) {
          setDevices(apiDevices.map(mapDevice));
        }

        if (apiReadings.length > 0) {
          setMetrics(mapLatestMetrics(apiReadings));
        }

        setLoading(false);
        return;
      } catch (err) {
        console.warn('No wearable data from API:', err);
      }
    }

    setLoading(false);
  }, [patient?.healthId]);

  useEffect(() => {
    loadWearableData();
  }, [patient, loadWearableData]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      // There is no connected-provider ingestion endpoint yet. Refresh only
      // what the server has actually recorded; never stamp a fictional sync.
      await loadWearableData();
    } finally {
      setIsSyncing(false);
    }
  };

  const getDeviceIcon = (type: DeviceType) => {
    switch (type) {
      case 'apple-watch':
      case 'samsung':
      case 'garmin':
        return <Watch className="w-8 h-8" />;
      case 'oura':
        return <div className="w-8 h-8 rounded-full border-4 border-current" />;
      default:
        return <Smartphone className="w-8 h-8" />;
    }
  };

  const formatLastSync = (date: Date | null) => {
    if (!date) return t('wearables.never');
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t('wearables.minAgo', { mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t(hours > 1 ? 'wearables.hoursAgo' : 'wearables.hourAgo', { hours });
    return date.toLocaleDateString();
  };

  // Localized labels for enum/data values that also drive display logic.
  const tabLabel = (tab: 'dashboard' | 'devices' | 'settings'): string =>
    tab === 'dashboard' ? t('wearables.tabDashboard')
      : tab === 'devices' ? t('wearables.tabDevices')
        : t('wearables.tabSettings');

  const metricName = (m: HealthMetric): string => {
    switch (m.type) {
      case 'heart-rate': return t('wearables.metricHeartRate');
      case 'steps': return t('wearables.metricSteps');
      case 'calories': return t('wearables.metricCalories');
      case 'sleep': return t('wearables.metricSleep');
      case 'spo2': return t('wearables.metricSpo2');
      case 'hrv': return t('wearables.metricHrv');
      default: return m.name;
    }
  };

  const metricUnit = (m: HealthMetric): string => {
    switch (m.type) {
      case 'heart-rate': return t('wearables.uHeartRate');
      case 'steps': return t('wearables.uSteps');
      case 'calories': return t('wearables.uCalories');
      case 'sleep': return t('wearables.uSleep');
      case 'spo2': return t('wearables.uSpo2');
      case 'hrv': return t('wearables.uHrv');
      default: return m.unit;
    }
  };

  const ringLabel = (name: string): string => {
    switch (name) {
      case 'Move': return t('wearables.ringMove');
      case 'Exercise': return t('wearables.ringExercise');
      case 'Stand': return t('wearables.ringStand');
      default: return name;
    }
  };

  const dayLabel = (d: string): string => {
    const days: Record<string, string> = {
      Mon: t('wearables.dayMon'),
      Tue: t('wearables.dayTue'),
      Wed: t('wearables.dayWed'),
      Thu: t('wearables.dayThu'),
      Fri: t('wearables.dayFri'),
      Sat: t('wearables.daySat'),
      Sun: t('wearables.daySun'),
    };
    return days[d] || d;
  };

  const getTrendIcon = (trend: TrendDirection) => {
    switch (trend) {
      case 'up': return <TrendingUp className="w-4 h-4 text-ok" />;
      case 'down': return <TrendingDown className="w-4 h-4 text-critical" />;
      case 'stable': return <Minus className="w-4 h-4 text-content-muted" />;
    }
  };

  const renderActivityRing = (ring: ActivityRing, size: number, strokeWidth: number) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const progress = Math.min(ring.current / ring.goal, 1);
    const strokeDashoffset = circumference - progress * circumference;

    return (
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className="text-content-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ring.color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-500"
        />
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-surface-sunken pb-20">
      {/* Loading State */}
      {loading && (
        <div className="fixed inset-0 bg-surface/80 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-content-secondary animate-spin" />
            <span className="text-content-muted">{t('wearables.loading')}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-teal-700 to-cyan-800 text-white p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Watch className="w-8 h-8" />
            <h1 className="text-2xl font-bold">{t('wearables.title')}</h1>
          </div>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="p-2 bg-surface/20 rounded-full hover:bg-surface/30"
          >
            <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="text-white">{t('wearables.devicesConnected', { count: devices.filter(d => d.status === 'connected').length })}</p>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b sticky top-0 z-10">
        <div className="flex">
          {(['dashboard', 'devices', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-content-secondary border-b-2 border-teal-600'
                  : 'text-content-muted hover:text-content-secondary'
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            {/* Activity Rings */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h3 className="font-semibold text-content mb-4">{t('wearables.todaysActivity')}</h3>
              <div className="flex items-center justify-center gap-4">
                <div className="relative">
                  {activityRings.map((ring, idx) => (
                    <div
                      key={ring.name}
                      className="absolute"
                      style={{
                        top: idx * 8,
                        left: idx * 8
                      }}
                    >
                      {renderActivityRing(ring, 120 - idx * 16, 10)}
                    </div>
                  ))}
                  <div style={{ width: 120, height: 120 }} />
                </div>
                <div className="space-y-2">
                  {activityRings.map(ring => (
                    <div key={ring.name} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: ring.color }}
                      />
                      <span className="text-sm text-content-muted">
                        {ringLabel(ring.name)}: {ring.current}/{ring.goal}
                        {ring.name === 'Move' ? ` ${t('wearables.unitKcal')}` : ring.name === 'Exercise' ? ` ${t('wearables.unitMin')}` : ` ${t('wearables.unitHrs')}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Health Metrics Grid */}
            <div className="grid grid-cols-2 gap-3">
              {metrics.map(metric => (
                <button
                  key={metric.type}
                  onClick={() => setSelectedMetric(metric)}
                  className="bg-surface rounded-lg shadow p-4 text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className={metric.color}>{metric.icon}</div>
                    {getTrendIcon(metric.trend)}
                  </div>
                  <p className="text-2xl font-bold text-content">
                    {metric.type === 'sleep' ? metric.value.toFixed(1) : metric.value.toLocaleString()}
                  </p>
                  <p className="text-xs text-content-muted">{metricUnit(metric)}</p>
                  <p className="text-sm text-content-muted mt-1">{metricName(metric)}</p>
                  {metric.goal && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            metric.value >= metric.goal ? 'bg-green-500' : 'bg-teal-500'
                          }`}
                          style={{ width: `${Math.min((metric.value / metric.goal) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Weekly Trends */}
            {selectedMetric && (
              <div className="bg-surface rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-content">{t('wearables.trend7Day', { name: metricName(selectedMetric) })}</h3>
                  <button onClick={() => setSelectedMetric(null)} className="text-content-muted">
                    ×
                  </button>
                </div>
                <div className="flex items-end justify-between h-32 gap-1">
                  {selectedMetric.history.map((h, idx) => {
                    const max = Math.max(...selectedMetric.history.map(d => d.value));
                    const height = (h.value / max) * 100;
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center">
                        <div
                          className="w-full bg-teal-500 rounded-t transition-all"
                          style={{ height: `${height}%` }}
                        />
                        <span className="text-xs text-content-muted mt-1">{dayLabel(h.date)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Devices Tab */}
        {activeTab === 'devices' && (
          <div className="space-y-4">
            {/* Connected Devices */}
            <div className="bg-surface rounded-lg shadow divide-y">
              <div className="p-4">
                <h3 className="font-semibold text-content">{t('wearables.connectedDevices')}</h3>
              </div>
              {devices.map(device => (
                <div key={device.id} className="p-4">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full ${
                      device.status === 'connected' ? 'bg-surface-sunken text-content-secondary' : 'bg-surface-sunken text-content-muted'
                    }`}>
                      {getDeviceIcon(device.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-content">{device.name}</h4>
                        {device.status === 'connected' && (
                          <CheckCircle className="w-4 h-4 text-ok" />
                        )}
                      </div>
                      <p className="text-sm text-content-muted">{device.model}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-content-muted">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatLastSync(device.lastSync)}
                        </span>
                        {device.batteryLevel && (
                          <span className="flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {device.batteryLevel}%
                          </span>
                        )}
                      </div>
                    </div>
                    <button className="p-2 text-content-muted hover:text-content-muted" aria-label={`View ${device.name} details`}>
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Device */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h3 className="font-semibold text-content mb-4">{t('wearables.addDevice')}</h3>
              <div className="grid grid-cols-2 gap-3">
                {ADD_DEVICE_PLATFORMS.map(platform => (
                  <button
                    key={platform.name}
                    type="button"
                    onClick={() => {
                      setPendingManufacturer(
                        pendingManufacturer === platform.manufacturer ? null : platform.manufacturer
                      );
                      setPendingModel('');
                      setRegisterError('');
                    }}
                    aria-expanded={pendingManufacturer === platform.manufacturer}
                    className="flex items-center gap-3 p-3 border border-border rounded-lg hover:border-teal-300 hover:bg-surface-sunken transition-all min-h-[44px]"
                  >
                    <div className={`p-2 rounded-full ${platform.color}`}>
                      {platform.icon}
                    </div>
                    <span className="text-sm font-medium text-content-secondary">{platform.name}</span>
                  </button>
                ))}
              </div>

              {registerError && (
                <div role="alert" className="mt-3 bg-critical-subtle border border-critical rounded-lg p-3">
                  <p className="text-sm text-critical-subtle-fg">{registerError}</p>
                </div>
              )}

              {pendingManufacturer && (
                <div className="mt-3 border border-border rounded-lg p-3">
                  <label
                    htmlFor="wearable-model"
                    className="block text-sm font-medium text-content-secondary mb-1"
                  >
                    {t('wearables.registerModel', { manufacturer: pendingManufacturer })}
                  </label>
                  {modelsFor(pendingManufacturer).length > 0 ? (
                    <select
                      id="wearable-model"
                      value={pendingModel}
                      onChange={(e) => setPendingModel(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content min-h-[44px]"
                    >
                      <option value="">{t('wearables.registerModelPrompt')}</option>
                      {modelsFor(pendingManufacturer).map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    // The catalogue did not list this manufacturer. Typing the
                    // model is better than blocking the patient on a list the
                    // server has not been told about.
                    <input
                      id="wearable-model"
                      value={pendingModel}
                      onChange={(e) => setPendingModel(e.target.value)}
                      placeholder={t('wearables.registerModelPlaceholder')}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content min-h-[44px]"
                    />
                  )}
                  <button
                    type="button"
                    disabled={registerBusy}
                    onClick={() => {
                      const platform = ADD_DEVICE_PLATFORMS.find(
                        (p) => p.manufacturer === pendingManufacturer
                      );
                      if (platform) void registerDevice(platform.apiDeviceType, platform.manufacturer);
                    }}
                    className="mt-2 px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[44px]"
                  >
                    {registerBusy ? t('wearables.registering') : t('wearables.registerConnect')}
                  </button>
                </div>
              )}
            </div>

            {/* Bluetooth Scan */}
            <button className="w-full bg-surface rounded-lg shadow p-4 flex items-center justify-center gap-2 text-content-secondary font-medium hover:bg-surface-sunken">
              <Bluetooth className="w-5 h-5" />
              {t('wearables.scanBluetooth')}
            </button>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            {/* Alerting */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h3 className="font-semibold text-content mb-1">{t('wearables.alertsHeading')}</h3>
              <p className="text-sm text-content-muted mb-4">{t('wearables.alertsSubtitle')}</p>

              {ruleError && (
                <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
                  <p className="text-sm text-critical-subtle-fg">{ruleError}</p>
                </div>
              )}
              {ruleNotice && (
                <div role="status" className="mb-4 bg-ok-subtle border border-ok rounded-lg p-3">
                  <p className="text-sm text-ok-subtle-fg">{ruleNotice}</p>
                </div>
              )}

              <form onSubmit={submitRule} className="grid gap-3 sm:grid-cols-2 mb-4">
                <div>
                  <label htmlFor="rule-type" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('wearables.ruleType')}
                  </label>
                  <select
                    id="rule-type"
                    value={ruleDataType}
                    onChange={(e) => setRuleDataType(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content min-h-[44px]"
                  >
                    <option value="HeartRate">{t('wearables.typeHeartRate')}</option>
                    <option value="BloodPressure">{t('wearables.typeBloodPressure')}</option>
                    <option value="BloodGlucose">{t('wearables.typeBloodGlucose')}</option>
                    <option value="SpO2">{t('wearables.typeSpO2')}</option>
                    <option value="Weight">{t('wearables.typeWeight')}</option>
                    <option value="Steps">{t('wearables.typeSteps')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rule-severity" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('wearables.ruleSeverity')}
                  </label>
                  <select
                    id="rule-severity"
                    value={ruleSeverity}
                    onChange={(e) => setRuleSeverity(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content min-h-[44px]"
                  >
                    <option value="Info">{t('wearables.severityInfo')}</option>
                    <option value="Warning">{t('wearables.severityWarning')}</option>
                    <option value="Urgent">{t('wearables.severityUrgent')}</option>
                    <option value="Critical">{t('wearables.severityCritical')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rule-low" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('wearables.ruleLow')}
                  </label>
                  <input
                    id="rule-low"
                    type="number"
                    inputMode="decimal"
                    value={ruleLow}
                    onChange={(e) => setRuleLow(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content min-h-[44px]"
                  />
                </div>
                <div>
                  <label htmlFor="rule-high" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('wearables.ruleHigh')}
                  </label>
                  <input
                    id="rule-high"
                    type="number"
                    inputMode="decimal"
                    value={ruleHigh}
                    onChange={(e) => setRuleHigh(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-content min-h-[44px]"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={ruleBusy}
                    className="px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[44px]"
                  >
                    {ruleBusy ? t('wearables.ruleSaving') : t('wearables.ruleSave')}
                  </button>
                </div>
              </form>

              <h4 className="text-sm font-medium text-content mb-2">{t('wearables.rulesHeading')}</h4>
              {!alertsLoaded ? (
                <p className="text-sm text-content-muted">{t('wearables.alertsLoading')}</p>
              ) : alertsUnknown ? (
                <p className="text-sm text-content-muted">{t('wearables.rulesUnknown')}</p>
              ) : alertRules.length === 0 ? (
                <p className="text-sm text-content-muted">{t('wearables.rulesNone')}</p>
              ) : (
                <ul className="space-y-2 mb-4" data-testid="alert-rule-list">
                  {alertRules.map((rule) => (
                    <li key={rule.rule_id} className="border border-border rounded-lg p-3">
                      {/* Says which direction it watches. The stored rule used
                          to read "above 0.0" no matter what was asked for, and
                          nothing displayed it so nobody could tell. */}
                      <p className="text-sm text-content">{describeRule(rule)}</p>
                      <p className="text-xs text-content-muted">{rule.severity}</p>
                    </li>
                  ))}
                </ul>
              )}

              <h4 className="text-sm font-medium text-content mb-2">{t('wearables.raisedHeading')}</h4>
              {alerts.length === 0 ? (
                <p className="text-sm text-content-muted">{t('wearables.raisedNone')}</p>
              ) : (
                <ul className="space-y-2" data-testid="wearable-alert-list">
                  {alerts.map((alert, index) => (
                    <li
                      key={(alert as { alert_id?: string }).alert_id ?? index}
                      className="border border-border rounded-lg p-3"
                    >
                      <p className="text-sm text-content">
                        {(alert as { message?: string }).message ?? t('wearables.raisedUnnamed')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {prefsError && (
              <div role="alert" className="bg-critical-subtle border border-critical rounded-lg p-3">
                <p className="text-sm text-critical-subtle-fg">{prefsError}</p>
              </div>
            )}
            {prefsNotice && (
              <div role="status" className="bg-ok-subtle border border-ok rounded-lg p-3">
                <p className="text-sm text-ok-subtle-fg">{prefsNotice}</p>
              </div>
            )}

            {/* Sync Settings */}
            <div className="bg-surface rounded-lg shadow divide-y">
              <div className="p-4">
                <h3 className="font-semibold text-content">{t('wearables.syncSettings')}</h3>
              </div>
              {[
                { key: 'syncAuto', label: t('wearables.syncAuto'), fallback: true },
                { key: 'syncBackground', label: t('wearables.syncBackground'), fallback: true },
                { key: 'syncCellular', label: t('wearables.syncCellular'), fallback: false },
                { key: 'syncSleep', label: t('wearables.syncSleep'), fallback: true },
                { key: 'syncWorkout', label: t('wearables.syncWorkout'), fallback: true },
                { key: 'syncHeartRate', label: t('wearables.syncHeartRate'), fallback: true },
              ].map((setting) => {
                const on = prefs[setting.key] ?? setting.fallback;
                return (
                  <div key={setting.key} className="p-4 flex items-center justify-between">
                    <span className="text-content-secondary" id={`pref-${setting.key}`}>
                      {setting.label}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-labelledby={`pref-${setting.key}`}
                      disabled={!prefsLoaded}
                      onClick={() => void togglePref(setting.key, setting.fallback)}
                      className={`w-12 h-6 rounded-full transition-colors disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 ${
                        on ? 'bg-teal-500' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 bg-surface rounded-full shadow transition-transform ${
                          on ? 'translate-x-6' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Data Sharing */}
            <div className="bg-surface rounded-lg shadow divide-y">
              <div className="p-4">
                <h3 className="font-semibold text-content">{t('wearables.dataSharing')}</h3>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-content-secondary" id="pref-shareProvider">
                    {t('wearables.shareProvider')}
                  </span>
                  {/* Was hardcoded on with no handler. A sharing control that
                      cannot be turned off is worse than no control: it tells a
                      patient they have a choice they do not have. */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs.shareProvider ?? true}
                    aria-labelledby="pref-shareProvider"
                    disabled={!prefsLoaded}
                    onClick={() => void togglePref('shareProvider', true)}
                    className={`w-12 h-6 rounded-full transition-colors disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 ${
                      (prefs.shareProvider ?? true) ? 'bg-teal-500' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-surface rounded-full shadow transition-transform ${
                        (prefs.shareProvider ?? true) ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-sm text-content-muted">
                  {t('wearables.shareProviderDesc')}
                </p>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-content-secondary" id="pref-emergencyAccess">
                    {t('wearables.emergencyAccess')}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs.emergencyAccess ?? true}
                    aria-labelledby="pref-emergencyAccess"
                    disabled={!prefsLoaded}
                    onClick={() => void togglePref('emergencyAccess', true)}
                    className={`w-12 h-6 rounded-full transition-colors disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 ${
                      (prefs.emergencyAccess ?? true) ? 'bg-teal-500' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-surface rounded-full shadow transition-transform ${
                        (prefs.emergencyAccess ?? true) ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-sm text-content-muted">
                  {t('wearables.emergencyAccessDesc')}
                </p>
              </div>
            </div>

            {/* Disconnect */}
            <div className="bg-surface rounded-lg shadow p-4">
              <button
                type="button"
                disabled={disconnecting || devices.length === 0}
                onClick={async () => {
                  if (await confirmDialog({ message: t('wearables.disconnectAllConfirm'), destructive: true })) {
                    void disconnectAll();
                  }
                }}
                className="w-full flex items-center justify-center gap-2 text-critical-subtle-fg font-medium disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[44px]"
              >
                <Unlink className="w-5 h-5" />
                {disconnecting ? t('wearables.disconnecting') : t('wearables.disconnectAll')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WearablesPage;
