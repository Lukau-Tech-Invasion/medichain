import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Activity,
  Plus,
  Clock,
  TrendingUp,
  ThermometerSun,
  Heart,
  Brain,
  Bone,
  Eye,
  Wind,
  Loader2,
  Wifi,
  WifiOff,
  ChevronRight,
  Trash2,
  Zap,
  X,
} from 'lucide-react';

interface SymptomEntry {
  id: string;
  symptom: string;
  category: string;
  severity: 1 | 2 | 3 | 4 | 5;
  timestamp: string;
  duration?: string;
  notes?: string;
  triggers?: string[];
  relievedBy?: string[];
}

interface SymptomCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  symptoms: string[];
}

/**
 * SymptomTrackerPage - Track and monitor symptoms
 * 
 * Features:
 * - Log symptoms with severity
 * - Track symptom patterns
 * - Share with healthcare providers
 * - View symptom history
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function SymptomTrackerPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [entries, setEntries] = useState<SymptomEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState<Partial<SymptomEntry>>({
    severity: 3,
    timestamp: new Date().toISOString(),
  });

  const categories: SymptomCategory[] = [
    {
      id: 'pain',
      name: t('symptomTracker.catPain'),
      icon: <Bone className="w-5 h-5" />,
      symptoms: ['Headache', 'Back pain', 'Joint pain', 'Muscle pain', 'Chest pain', 'Abdominal pain'],
    },
    {
      id: 'respiratory',
      name: t('symptomTracker.catRespiratory'),
      icon: <Wind className="w-5 h-5" />,
      symptoms: ['Cough', 'Shortness of breath', 'Wheezing', 'Congestion', 'Sore throat'],
    },
    {
      id: 'cardiovascular',
      name: t('symptomTracker.catCardiovascular'),
      icon: <Heart className="w-5 h-5" />,
      symptoms: ['Palpitations', 'Rapid heartbeat', 'Dizziness', 'Fainting', 'Swelling'],
    },
    {
      id: 'neurological',
      name: t('symptomTracker.catNeurological'),
      icon: <Brain className="w-5 h-5" />,
      symptoms: ['Numbness', 'Tingling', 'Memory issues', 'Confusion', 'Tremors'],
    },
    {
      id: 'general',
      name: t('symptomTracker.catGeneral'),
      icon: <ThermometerSun className="w-5 h-5" />,
      symptoms: ['Fatigue', 'Fever', 'Chills', 'Night sweats', 'Weight change', 'Appetite change'],
    },
    {
      id: 'sensory',
      name: t('symptomTracker.catSensory'),
      icon: <Eye className="w-5 h-5" />,
      symptoms: ['Vision changes', 'Hearing changes', 'Ringing in ears', 'Sensitivity to light'],
    },
  ];

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadEntries();
    }
  }, [patient]);

  const loadEntries = async () => {
    if (!patient) return;
    
    setLoading(true);
    try {
      const patientId = patient.healthId;
      
      const response = await fetch(apiUrl(`/api/symptoms/history/${patientId}`), {
        headers: { 
          'X-User-Id': patient.walletAddress,
          'X-Health-Id': patient.healthId,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setApiConnected(true);
        setEntries(data.entries || []);
      } else {
        setApiConnected(false);
      }
    } catch {
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const addEntry = async () => {
    if (!newEntry.symptom || !newEntry.category) return;

    const entry: SymptomEntry = {
      id: `SYM-${Date.now()}`,
      symptom: newEntry.symptom,
      category: newEntry.category,
      severity: newEntry.severity as 1 | 2 | 3 | 4 | 5,
      timestamp: new Date().toISOString(),
      duration: newEntry.duration,
      notes: newEntry.notes,
      triggers: newEntry.triggers,
      relievedBy: newEntry.relievedBy,
    };

    setEntries(prev => [entry, ...prev]);
    setShowAddModal(false);
    setSelectedCategory(null);
    setNewEntry({ severity: 3, timestamp: new Date().toISOString() });

    // Log symptom to API
    if (patient) {
      try {
        await fetch(apiUrl('/api/symptoms/log'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': patient.walletAddress,
            'X-Health-Id': patient.healthId,
          },
          body: JSON.stringify({
            patient_id: patient.healthId,
            symptom: entry.symptom,
            severity: entry.severity,
            notes: entry.notes,
          }),
        });
      } catch (err) {
        console.warn('Failed to log symptom to API:', err);
      }
    }
  };

  const deleteEntry = (id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const getSeverityColor = (severity: number) => {
    switch (severity) {
      case 1: return 'bg-green-100 text-green-700';
      case 2: return 'bg-blue-100 text-blue-700';
      case 3: return 'bg-yellow-100 text-yellow-700';
      case 4: return 'bg-orange-100 text-orange-700';
      case 5: return 'bg-red-100 text-red-700';
      default: return 'bg-neutral-100 text-neutral-700';
    }
  };

  const getSeverityLabel = (severity: number) => {
    switch (severity) {
      case 1: return t('symptomTracker.sev1');
      case 2: return t('symptomTracker.sev2');
      case 3: return t('symptomTracker.sev3');
      case 4: return t('symptomTracker.sev4');
      case 5: return t('symptomTracker.sev5');
      default: return t('symptomTracker.sevUnknown');
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60 * 60 * 1000) {
      const mins = Math.floor(diff / (60 * 1000));
      return t('symptomTracker.minAgo', { count: mins });
    } else if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      return t('symptomTracker.hourAgo', { count: hours });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const getCategoryIcon = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    return category?.icon || <Activity className="w-5 h-5" />;
  };

  // Calculate statistics
  const todayEntries = entries.filter(e => {
    const date = new Date(e.timestamp);
    const today = new Date();
    return date.toDateString() === today.toDateString();
  });

  const weekEntries = entries.filter(e => {
    const date = new Date(e.timestamp);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return date >= weekAgo;
  });

  const averageSeverity = entries.length > 0
    ? (entries.reduce((sum, e) => sum + e.severity, 0) / entries.length).toFixed(1)
    : '0';

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
          <h1 className="text-2xl font-bold text-neutral-900">{t('symptomTracker.title')}</h1>
          <p className="text-neutral-500">{t('symptomTracker.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.demo')}
          </span>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-primary-600">{todayEntries.length}</div>
          <div className="text-xs text-neutral-500">{t('symptomTracker.statToday')}</div>
        </div>
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-primary-600">{weekEntries.length}</div>
          <div className="text-xs text-neutral-500">{t('symptomTracker.thisWeek')}</div>
        </div>
        <div className="patient-card text-center">
          <div className="text-2xl font-bold text-primary-600">{averageSeverity}</div>
          <div className="text-xs text-neutral-500">{t('symptomTracker.avgSeverity')}</div>
        </div>
      </div>

      {/* Add New Button */}
      <button
        onClick={() => setShowAddModal(true)}
        className="w-full bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-2xl p-6 flex items-center justify-center gap-3 hover:from-primary-600 hover:to-primary-700 transition-all"
      >
        <Plus className="w-6 h-6" />
        <span className="font-semibold text-lg">{t('symptomTracker.logNew')}</span>
      </button>

      {/* Recent Entries */}
      <div>
        <h2 className="font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-neutral-500" />
          {t('symptomTracker.recentEntries')}
        </h2>

        <div className="space-y-3">
          {entries.slice(0, 10).map(entry => (
            <div key={entry.id} className="patient-card">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center text-primary-600">
                    {getCategoryIcon(entry.category)}
                  </div>
                  <div>
                    <h3 className="font-medium text-neutral-900">{entry.symptom}</h3>
                    <p className="text-sm text-neutral-500">{formatTime(entry.timestamp)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getSeverityColor(entry.severity)}`}>
                    {getSeverityLabel(entry.severity)}
                  </span>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {entry.duration && (
                <p className="text-sm text-neutral-600 mb-2">
                  <span className="font-medium">{t('symptomTracker.durationLabel')}</span> {entry.duration}
                </p>
              )}

              {entry.notes && (
                <p className="text-sm text-neutral-500 mb-2">{entry.notes}</p>
              )}

              {entry.triggers && entry.triggers.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {entry.triggers.map((trigger, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-700 rounded text-xs">
                      <Zap className="w-3 h-3" aria-hidden="true" /> {trigger}
                    </span>
                  ))}
                </div>
              )}

              {entry.relievedBy && entry.relievedBy.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entry.relievedBy.map((relief, idx) => (
                    <span key={idx} className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs">
                      ✓ {relief}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {entries.length === 0 && (
            <div className="text-center py-12">
              <Activity className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">{t('symptomTracker.noneLogged')}</p>
              <p className="text-sm text-neutral-400">{t('symptomTracker.noneHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Insights */}
      {entries.length >= 3 && (
        <div className="patient-card">
          <h3 className="font-semibold text-neutral-900 mb-3 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary-500" />
            {t('symptomTracker.insights')}
          </h3>
          <div className="space-y-2 text-sm">
            <p className="text-neutral-600">
              • {t('symptomTracker.mostCommon')} <span className="font-medium">{
                Object.entries(entries.reduce((acc, e) => {
                  acc[e.symptom] = (acc[e.symptom] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>))
                  .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'
              }</span>
            </p>
            <p className="text-neutral-600">
              • {t('symptomTracker.totalEntries')} <span className="font-medium">{entries.length}</span>
            </p>
          </div>
          <button className="mt-3 text-primary-500 font-medium text-sm flex items-center gap-1">
            {t('symptomTracker.viewReport')} <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Add Symptom Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white p-4 border-b border-neutral-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-neutral-900">{t('symptomTracker.logSymptom')}</h2>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setSelectedCategory(null);
                    setNewEntry({ severity: 3, timestamp: new Date().toISOString() });
                  }}
                  className="p-2 hover:bg-neutral-100 rounded-lg text-neutral-500"
                  aria-label={t('common.close')}
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Category Selection */}
              {!selectedCategory ? (
                <div className="grid grid-cols-2 gap-3">
                  {categories.map(category => (
                    <button
                      key={category.id}
                      onClick={() => {
                        setSelectedCategory(category.id);
                        setNewEntry(prev => ({ ...prev, category: category.id }));
                      }}
                      className="p-4 border-2 border-neutral-200 rounded-xl hover:border-primary-300 transition-colors text-left"
                    >
                      <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 mb-2">
                        {category.icon}
                      </div>
                      <div className="font-medium text-neutral-900">{category.name}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {/* Symptom Selection */}
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      {t('symptomTracker.selectSymptom')}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {categories.find(c => c.id === selectedCategory)?.symptoms.map(symptom => (
                        <button
                          key={symptom}
                          onClick={() => setNewEntry(prev => ({ ...prev, symptom }))}
                          className={`p-3 border-2 rounded-lg text-sm font-medium transition-colors ${
                            newEntry.symptom === symptom
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-neutral-200 hover:border-primary-300'
                          }`}
                        >
                          {symptom}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Severity */}
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      {t('symptomTracker.severityLabel', { label: getSeverityLabel(newEntry.severity || 3) })}
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map(level => (
                        <button
                          key={level}
                          onClick={() => setNewEntry(prev => ({ ...prev, severity: level as 1|2|3|4|5 }))}
                          className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                            newEntry.severity === level
                              ? getSeverityColor(level)
                              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Duration */}
                  <div>
                    <label htmlFor="symptom-duration" className="block text-sm font-medium text-neutral-700 mb-2">
                      {t('symptomTracker.durationOptional')}
                    </label>
                    <input
                      id="symptom-duration"
                      type="text"
                      value={newEntry.duration || ''}
                      onChange={(e) => setNewEntry(prev => ({ ...prev, duration: e.target.value }))}
                      placeholder={t('symptomTracker.durationPlaceholder')}
                      className="w-full px-4 py-2 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label htmlFor="symptom-notes" className="block text-sm font-medium text-neutral-700 mb-2">
                      {t('symptomTracker.notesOptional')}
                    </label>
                    <textarea
                      id="symptom-notes"
                      value={newEntry.notes || ''}
                      onChange={(e) => setNewEntry(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder={t('symptomTracker.notesPlaceholder')}
                      rows={3}
                      className="w-full px-4 py-2 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className="flex-1 py-3 border border-neutral-300 text-neutral-700 rounded-lg font-medium hover:bg-neutral-50"
                    >
                      {t('common.back')}
                    </button>
                    <button
                      onClick={addEntry}
                      disabled={!newEntry.symptom}
                      className="flex-1 py-3 bg-primary-500 text-white rounded-lg font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('symptomTracker.saveEntry')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
