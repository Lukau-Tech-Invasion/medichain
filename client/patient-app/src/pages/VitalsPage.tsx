import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPatientVitals, IS_DEMO, useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Activity,
  Heart,
  Thermometer,
  Wind,
  Droplet,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  Scale,
} from 'lucide-react';

interface VitalReading {
  reading_id?: string;
  id?: string;
  recorded_at?: string;
  created_at?: string;
  heart_rate?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  respiratory_rate?: number;
  oxygen_saturation?: number;
  temperature_celsius?: number;
  weight_kg?: number;
  pain_scale?: number;
  notes?: string;
}

/**
 * VitalsPage - Patient vital signs history and latest readings
 *
 * Features:
 * - Latest vitals shown prominently
 * - Trend indicators (up/down/stable) compared to previous reading
 * - Full vitals history list
 *
 * © 2025 Trustware. All rights reserved.
 */
export function VitalsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [readings, setReadings] = useState<VitalReading[]>([]);
  const [latest, setLatest] = useState<VitalReading | null>(null);
  const [previous, setPrevious] = useState<VitalReading | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadVitals();
    }
  }, [patient]);

  const loadVitals = async () => {
    if (!patient) return;
    setLoading(true);
    try {
      const data = await getPatientVitals(patient.healthId);
      const list: VitalReading[] = (data as { readings?: VitalReading[]; vitals?: VitalReading[] }).readings || (data as { readings?: VitalReading[]; vitals?: VitalReading[] }).vitals || (Array.isArray(data) ? data : []);
      
      if (list.length === 0 && IS_DEMO) {
        // Fallback to demo data only if IS_DEMO is true and API returned empty
        const demoData: VitalReading[] = [
          {
            id: 'demo-1',
            recorded_at: new Date().toISOString(),
            heart_rate: 72,
            systolic_bp: 120,
            diastolic_bp: 80,
            temperature_celsius: 36.6,
            oxygen_saturation: 98,
            respiratory_rate: 16,
            weight_kg: 70
          },
          {
            id: 'demo-2',
            recorded_at: new Date(Date.now() - 86400000).toISOString(),
            heart_rate: 75,
            systolic_bp: 125,
            diastolic_bp: 82,
            temperature_celsius: 36.8,
            oxygen_saturation: 97,
            respiratory_rate: 18,
            weight_kg: 70.5
          }
        ];
        setReadings(demoData);
        setLatest(demoData[0]);
        setPrevious(demoData[1]);
        setApiConnected(false);
      } else {
        setReadings(list);
        setApiConnected(true);
        if (list.length > 0) {
          setLatest(list[0]);
          setPrevious(list[1] || null);
        }
      }
    } catch (err) {
      console.error('Failed to load vitals:', err);
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const trend = (key: keyof VitalReading): 'up' | 'down' | 'stable' => {
    if (!latest || !previous) return 'stable';
    const l = latest[key] as number | undefined;
    const p = previous[key] as number | undefined;
    if (l == null || p == null) return 'stable';
    if (l > p) return 'up';
    if (l < p) return 'down';
    return 'stable';
  };

  const TrendIcon = ({ direction }: { direction: 'up' | 'down' | 'stable' }) => {
    if (direction === 'up') return <TrendingUp className="w-4 h-4 text-orange-500" />;
    if (direction === 'down') return <TrendingDown className="w-4 h-4 text-blue-500" />;
    return <Minus className="w-4 h-4 text-neutral-400" />;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{t('vitals.title')}</h1>
          <p className="text-neutral-500">{t('vitals.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.demo')}
          </span>
          <button
            onClick={loadVitals}
            className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Latest Vitals */}
      {latest ? (
        <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
          <h2 className="text-lg font-semibold mb-1">{t('vitals.latestReading')}</h2>
          <p className="text-white/70 text-sm mb-4">
            {formatDate(latest.recorded_at || latest.created_at)}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {latest.systolic_bp != null && latest.diastolic_bp != null && (
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <Heart className="w-4 h-4" />
                  <TrendIcon direction={trend('systolic_bp')} />
                </div>
                <p className="text-xl font-bold">{latest.systolic_bp}/{latest.diastolic_bp}</p>
                <p className="text-xs text-white/70">{t('vitals.bloodPressure')}</p>
              </div>
            )}
            {latest.heart_rate != null && (
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <Activity className="w-4 h-4" />
                  <TrendIcon direction={trend('heart_rate')} />
                </div>
                <p className="text-xl font-bold">{latest.heart_rate}</p>
                <p className="text-xs text-white/70">{t('vitals.heartRate')}</p>
              </div>
            )}
            {latest.temperature_celsius != null && (
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <Thermometer className="w-4 h-4" />
                  <TrendIcon direction={trend('temperature_celsius')} />
                </div>
                <p className="text-xl font-bold">{latest.temperature_celsius.toFixed(1)}°C</p>
                <p className="text-xs text-white/70">{t('vitals.temperature')}</p>
              </div>
            )}
            {latest.oxygen_saturation != null && (
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <Droplet className="w-4 h-4" />
                  <TrendIcon direction={trend('oxygen_saturation')} />
                </div>
                <p className="text-xl font-bold">{latest.oxygen_saturation}%</p>
                <p className="text-xs text-white/70">{t('vitals.spo2')}</p>
              </div>
            )}
            {latest.respiratory_rate != null && (
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <Wind className="w-4 h-4" />
                  <TrendIcon direction={trend('respiratory_rate')} />
                </div>
                <p className="text-xl font-bold">{latest.respiratory_rate}</p>
                <p className="text-xs text-white/70">{t('vitals.respRate')}</p>
              </div>
            )}
            {latest.weight_kg != null && (
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <Scale className="w-4 h-4" />
                  <TrendIcon direction={trend('weight_kg')} />
                </div>
                <p className="text-xl font-bold">{latest.weight_kg} kg</p>
                <p className="text-xs text-white/70">{t('vitals.weight')}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="patient-card text-center py-8">
          <Activity className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
          <p className="text-neutral-500">{t('vitals.noneRecorded')}</p>
        </div>
      )}

      {/* Vitals History */}
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 mb-3">{t('vitals.history')}</h2>
        {readings.length === 0 ? (
          <p className="text-neutral-500 text-sm">{t('vitals.noHistory')}</p>
        ) : (
          <div className="space-y-3">
            {readings.map((r, idx) => (
              <div key={r.reading_id || r.id || idx} className="patient-card">
                <p className="text-xs text-neutral-400 mb-2">{formatDate(r.recorded_at || r.created_at)}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                  {r.systolic_bp != null && r.diastolic_bp != null && (
                    <div className="flex items-center gap-1 text-neutral-700">
                      <Heart className="w-4 h-4 text-red-400" />
                      <span>{r.systolic_bp}/{r.diastolic_bp} mmHg</span>
                    </div>
                  )}
                  {r.heart_rate != null && (
                    <div className="flex items-center gap-1 text-neutral-700">
                      <Activity className="w-4 h-4 text-pink-400" />
                      <span>{r.heart_rate} bpm</span>
                    </div>
                  )}
                  {r.temperature_celsius != null && (
                    <div className="flex items-center gap-1 text-neutral-700">
                      <Thermometer className="w-4 h-4 text-orange-400" />
                      <span>{r.temperature_celsius.toFixed(1)}°C</span>
                    </div>
                  )}
                  {r.oxygen_saturation != null && (
                    <div className="flex items-center gap-1 text-neutral-700">
                      <Droplet className="w-4 h-4 text-blue-400" />
                      <span>{r.oxygen_saturation}% SpO2</span>
                    </div>
                  )}
                  {r.respiratory_rate != null && (
                    <div className="flex items-center gap-1 text-neutral-700">
                      <Wind className="w-4 h-4 text-teal-400" />
                      <span>{r.respiratory_rate} /min</span>
                    </div>
                  )}
                  {r.weight_kg != null && (
                    <div className="flex items-center gap-1 text-neutral-700">
                      <Scale className="w-4 h-4 text-purple-400" />
                      <span>{r.weight_kg} kg</span>
                    </div>
                  )}
                </div>
                {r.notes && (
                  <p className="text-xs text-neutral-400 mt-2 italic">{r.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
