import React, { useState, useEffect } from 'react';
import {
  Watch,
  Smartphone,
  Heart,
  Footprints,
  Flame,
  Moon,
  Activity,
  Droplet,
  Link,
  Unlink,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle,
  AlertCircle,
  Settings,
  Clock,
  Bluetooth,
  Zap
} from 'lucide-react';

/**
 * WearablesPage
 * 
 * Page for syncing and viewing data from wearable health devices.
 * Integrates with Apple Health / Google Fit / Fitbit / Garmin.
 */

type DeviceType = 'apple-watch' | 'fitbit' | 'garmin' | 'samsung' | 'google-fit' | 'oura';
type MetricType = 'heart-rate' | 'steps' | 'calories' | 'sleep' | 'spo2' | 'hrv' | 'stress';
type SyncStatus = 'connected' | 'disconnected' | 'syncing' | 'error';
type TrendDirection = 'up' | 'down' | 'stable';

interface Device {
  id: string;
  name: string;
  type: DeviceType;
  model: string;
  status: SyncStatus;
  lastSync: Date | null;
  batteryLevel?: number;
}

interface HealthMetric {
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

interface ActivityRing {
  name: string;
  current: number;
  goal: number;
  color: string;
}

const WearablesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'devices' | 'settings'>('dashboard');
  const [devices, setDevices] = useState<Device[]>([]);
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<HealthMetric | null>(null);
  const [activityRings, setActivityRings] = useState<ActivityRing[]>([]);

  useEffect(() => {
    // Sample connected devices
    setDevices([
      {
        id: 'd1',
        name: 'Apple Watch',
        type: 'apple-watch',
        model: 'Series 9 GPS',
        status: 'connected',
        lastSync: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
        batteryLevel: 78
      },
      {
        id: 'd2',
        name: 'Oura Ring',
        type: 'oura',
        model: 'Generation 3',
        status: 'connected',
        lastSync: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        batteryLevel: 45
      }
    ]);

    // Sample health metrics
    setMetrics([
      {
        type: 'heart-rate',
        name: 'Heart Rate',
        value: 72,
        unit: 'bpm',
        trend: 'stable',
        trendPercent: 2,
        icon: <Heart className="w-5 h-5" />,
        color: 'text-red-500',
        history: [
          { date: 'Mon', value: 68 }, { date: 'Tue', value: 71 },
          { date: 'Wed', value: 69 }, { date: 'Thu', value: 74 },
          { date: 'Fri', value: 70 }, { date: 'Sat', value: 72 },
          { date: 'Sun', value: 72 }
        ]
      },
      {
        type: 'steps',
        name: 'Steps',
        value: 8432,
        unit: 'steps',
        trend: 'up',
        trendPercent: 12,
        goal: 10000,
        icon: <Footprints className="w-5 h-5" />,
        color: 'text-blue-500',
        history: [
          { date: 'Mon', value: 7234 }, { date: 'Tue', value: 9102 },
          { date: 'Wed', value: 6543 }, { date: 'Thu', value: 10234 },
          { date: 'Fri', value: 8901 }, { date: 'Sat', value: 11234 },
          { date: 'Sun', value: 8432 }
        ]
      },
      {
        type: 'calories',
        name: 'Active Calories',
        value: 423,
        unit: 'kcal',
        trend: 'up',
        trendPercent: 8,
        goal: 600,
        icon: <Flame className="w-5 h-5" />,
        color: 'text-orange-500',
        history: [
          { date: 'Mon', value: 380 }, { date: 'Tue', value: 445 },
          { date: 'Wed', value: 320 }, { date: 'Thu', value: 512 },
          { date: 'Fri', value: 467 }, { date: 'Sat', value: 534 },
          { date: 'Sun', value: 423 }
        ]
      },
      {
        type: 'sleep',
        name: 'Sleep',
        value: 7.2,
        unit: 'hours',
        trend: 'down',
        trendPercent: 5,
        goal: 8,
        icon: <Moon className="w-5 h-5" />,
        color: 'text-indigo-500',
        history: [
          { date: 'Mon', value: 6.8 }, { date: 'Tue', value: 7.5 },
          { date: 'Wed', value: 8.1 }, { date: 'Thu', value: 6.5 },
          { date: 'Fri', value: 7.0 }, { date: 'Sat', value: 8.2 },
          { date: 'Sun', value: 7.2 }
        ]
      },
      {
        type: 'spo2',
        name: 'Blood Oxygen',
        value: 98,
        unit: '%',
        trend: 'stable',
        trendPercent: 0,
        icon: <Droplet className="w-5 h-5" />,
        color: 'text-cyan-500',
        history: [
          { date: 'Mon', value: 97 }, { date: 'Tue', value: 98 },
          { date: 'Wed', value: 98 }, { date: 'Thu', value: 97 },
          { date: 'Fri', value: 99 }, { date: 'Sat', value: 98 },
          { date: 'Sun', value: 98 }
        ]
      },
      {
        type: 'hrv',
        name: 'HRV',
        value: 45,
        unit: 'ms',
        trend: 'up',
        trendPercent: 15,
        icon: <Activity className="w-5 h-5" />,
        color: 'text-purple-500',
        history: [
          { date: 'Mon', value: 38 }, { date: 'Tue', value: 42 },
          { date: 'Wed', value: 40 }, { date: 'Thu', value: 44 },
          { date: 'Fri', value: 43 }, { date: 'Sat', value: 48 },
          { date: 'Sun', value: 45 }
        ]
      }
    ]);

    setActivityRings([
      { name: 'Move', current: 423, goal: 600, color: 'rgb(239, 68, 68)' },
      { name: 'Exercise', current: 28, goal: 30, color: 'rgb(34, 197, 94)' },
      { name: 'Stand', current: 10, goal: 12, color: 'rgb(59, 130, 246)' }
    ]);
  }, []);

  const handleSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setDevices(prev => prev.map(d => ({
        ...d,
        lastSync: new Date()
      })));
    }, 2000);
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
    if (!date) return 'Never';
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  const getTrendIcon = (trend: TrendDirection) => {
    switch (trend) {
      case 'up': return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'down': return <TrendingDown className="w-4 h-4 text-red-500" />;
      case 'stable': return <Minus className="w-4 h-4 text-gray-400" />;
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
          className="text-gray-200"
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
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-500 to-cyan-500 text-white p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Watch className="w-8 h-8" />
            <h1 className="text-2xl font-bold">My Wearables</h1>
          </div>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="p-2 bg-white/20 rounded-full hover:bg-white/30"
          >
            <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="text-teal-100">{devices.filter(d => d.status === 'connected').length} device(s) connected</p>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="flex">
          {(['dashboard', 'devices', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'text-teal-600 border-b-2 border-teal-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            {/* Activity Rings */}
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Today's Activity</h3>
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
                      <span className="text-sm text-gray-600">
                        {ring.name}: {ring.current}/{ring.goal}
                        {ring.name === 'Move' ? ' kcal' : ring.name === 'Exercise' ? ' min' : ' hrs'}
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
                  className="bg-white rounded-lg shadow p-4 text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className={metric.color}>{metric.icon}</div>
                    {getTrendIcon(metric.trend)}
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {metric.type === 'sleep' ? metric.value.toFixed(1) : metric.value.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500">{metric.unit}</p>
                  <p className="text-sm text-gray-600 mt-1">{metric.name}</p>
                  {metric.goal && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
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
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">{selectedMetric.name} - 7 Day Trend</h3>
                  <button onClick={() => setSelectedMetric(null)} className="text-gray-400">
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
                        <span className="text-xs text-gray-500 mt-1">{h.date}</span>
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
            <div className="bg-white rounded-lg shadow divide-y">
              <div className="p-4">
                <h3 className="font-semibold text-gray-900">Connected Devices</h3>
              </div>
              {devices.map(device => (
                <div key={device.id} className="p-4">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full ${
                      device.status === 'connected' ? 'bg-teal-100 text-teal-600' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {getDeviceIcon(device.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-gray-900">{device.name}</h4>
                        {device.status === 'connected' && (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{device.model}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
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
                    <button className="p-2 text-gray-400 hover:text-gray-600">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Device */}
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Add Device</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { name: 'Apple Health', icon: <Heart className="w-6 h-6" />, color: 'bg-red-100 text-red-600' },
                  { name: 'Google Fit', icon: <Activity className="w-6 h-6" />, color: 'bg-blue-100 text-blue-600' },
                  { name: 'Fitbit', icon: <Watch className="w-6 h-6" />, color: 'bg-teal-100 text-teal-600' },
                  { name: 'Garmin', icon: <Watch className="w-6 h-6" />, color: 'bg-purple-100 text-purple-600' },
                  { name: 'Samsung Health', icon: <Heart className="w-6 h-6" />, color: 'bg-indigo-100 text-indigo-600' },
                  { name: 'Oura Ring', icon: <Moon className="w-6 h-6" />, color: 'bg-gray-100 text-gray-600' }
                ].map(platform => (
                  <button
                    key={platform.name}
                    className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-teal-300 hover:bg-teal-50 transition-all"
                  >
                    <div className={`p-2 rounded-full ${platform.color}`}>
                      {platform.icon}
                    </div>
                    <span className="text-sm font-medium text-gray-700">{platform.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Bluetooth Scan */}
            <button className="w-full bg-white rounded-lg shadow p-4 flex items-center justify-center gap-2 text-teal-600 font-medium hover:bg-teal-50">
              <Bluetooth className="w-5 h-5" />
              Scan for Bluetooth Devices
            </button>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            {/* Sync Settings */}
            <div className="bg-white rounded-lg shadow divide-y">
              <div className="p-4">
                <h3 className="font-semibold text-gray-900">Sync Settings</h3>
              </div>
              {[
                { label: 'Auto-sync when connected', enabled: true },
                { label: 'Background sync', enabled: true },
                { label: 'Sync over cellular data', enabled: false },
                { label: 'Sync sleep data', enabled: true },
                { label: 'Sync workout data', enabled: true },
                { label: 'Sync heart rate data', enabled: true }
              ].map((setting, idx) => (
                <div key={idx} className="p-4 flex items-center justify-between">
                  <span className="text-gray-700">{setting.label}</span>
                  <button
                    className={`w-12 h-6 rounded-full transition-colors ${
                      setting.enabled ? 'bg-teal-500' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        setting.enabled ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>

            {/* Data Sharing */}
            <div className="bg-white rounded-lg shadow divide-y">
              <div className="p-4">
                <h3 className="font-semibold text-gray-900">Data Sharing</h3>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-700">Share with Healthcare Provider</span>
                  <button className="w-12 h-6 rounded-full bg-teal-500">
                    <div className="w-5 h-5 bg-white rounded-full shadow translate-x-6" />
                  </button>
                </div>
                <p className="text-sm text-gray-500">
                  Allow your doctor to view your wearable health data during appointments.
                </p>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-700">Emergency Access</span>
                  <button className="w-12 h-6 rounded-full bg-teal-500">
                    <div className="w-5 h-5 bg-white rounded-full shadow translate-x-6" />
                  </button>
                </div>
                <p className="text-sm text-gray-500">
                  Share vital signs with emergency responders in case of emergency.
                </p>
              </div>
            </div>

            {/* Disconnect */}
            <div className="bg-white rounded-lg shadow p-4">
              <button className="w-full flex items-center justify-center gap-2 text-red-600 font-medium">
                <Unlink className="w-5 h-5" />
                Disconnect All Devices
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WearablesPage;
