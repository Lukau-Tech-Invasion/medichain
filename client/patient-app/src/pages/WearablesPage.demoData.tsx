/**
 * Sample wearable device/metric data for IS_DEMO mode only. Split into its
 * own module (dynamically imported from WearablesPage) so Rollup/esbuild can
 * tree-shake it out of production bundles — the `if (IS_DEMO)` check alone
 * can't prove that to the bundler when the data lives inline in the page
 * component. Kept as .tsx (not .ts) because the metric icons are JSX nodes.
 */
import { Heart, Footprints, Flame, Moon, Droplet, Activity } from 'lucide-react';
import type { Device, HealthMetric, ActivityRing } from './WearablesPage';

export function getDemoDevices(): Device[] {
  return [
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
  ];
}

export function getDemoMetrics(): HealthMetric[] {
  return [
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
  ];
}

export function getDemoActivityRings(): ActivityRing[] {
  return [
    { name: 'Move', current: 423, goal: 600, color: 'rgb(239, 68, 68)' },
    { name: 'Exercise', current: 28, goal: 30, color: 'rgb(34, 197, 94)' },
    { name: 'Stand', current: 10, goal: 12, color: 'rgb(59, 130, 246)' }
  ];
}
