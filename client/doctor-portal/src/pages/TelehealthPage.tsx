import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { apiUrl } from '@medichain/shared';
import { Video, Plus, ExternalLink, Square, Calendar, Clock, User, Loader2 } from 'lucide-react';

interface TelehealthSession {
  session_id: string;
  patient_id: string;
  provider_id: string;
  scheduled_start: number;
  duration_minutes: number;
  session_type: string;
  status: string;
  join_url?: string;
  ended_at?: number;
}

export default function TelehealthPage() {
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<TelehealthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [patientId, setPatientId] = useState('');

  const [formData, setFormData] = useState({
    patient_id: '',
    session_type: 'video_consultation',
    scheduled_start_date: '',
    scheduled_start_time: '',
    duration_minutes: 30,
  });

  useEffect(() => {
    if (patientId) {
      fetchSessions(patientId);
    } else {
      setLoading(false);
    }
  }, [patientId]);

  const fetchSessions = async (pid: string) => {
    if (!user || !pid) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/telehealth/patient/${pid}/sessions`), {
        headers: {
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    try {
      const scheduledStart = formData.scheduled_start_date && formData.scheduled_start_time
        ? Math.floor(new Date(`${formData.scheduled_start_date}T${formData.scheduled_start_time}`).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      const res = await fetch(apiUrl('/api/telehealth/sessions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({
          patient_id: formData.patient_id,
          provider_id: user.walletAddress,
          scheduled_start: scheduledStart,
          duration_minutes: formData.duration_minutes,
          session_type: formData.session_type,
        }),
      });

      if (res.ok) {
        setSuccess('Telehealth session created!');
        setShowForm(false);
        setFormData({ patient_id: '', session_type: 'video_consultation', scheduled_start_date: '', scheduled_start_time: '', duration_minutes: 30 });
        if (formData.patient_id) {
          fetchSessions(formData.patient_id);
        }
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create session');
      }
    } catch (e) {
      setError('Failed to connect to server');
    }
  };

  const handleEndSession = async (sessionId: string) => {
    if (!user) return;
    setActionLoading(sessionId);
    try {
      const res = await fetch(apiUrl(`/api/telehealth/sessions/${sessionId}/end`), {
        method: 'POST',
        headers: {
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });
      if (res.ok) {
        setSuccess('Session ended');
        setSessions(prev => prev.map(s => s.session_id === sessionId ? { ...s, status: 'ended' } : s));
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError('Failed to end session');
      }
    } catch (e) {
      setError('Error ending session');
    } finally {
      setActionLoading(null);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-700';
      case 'active': return 'bg-green-100 text-green-700';
      case 'ended': return 'bg-gray-100 text-gray-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Video className="text-blue-500" size={24} />
            Telehealth Sessions
          </h1>
          <p className="text-gray-500 text-sm mt-1">Manage virtual care appointments</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} />
          New Session
        </button>
      </div>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{success}</div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {/* Patient Selector */}
      <div className="bg-white rounded-xl shadow p-4 mb-6">
        <label htmlFor="telehealth-patient-id" className="block text-sm font-medium text-gray-700 mb-1">
          View Sessions for Patient ID
        </label>
        <div className="flex gap-2">
          <input
            id="telehealth-patient-id"
            type="text"
            value={patientId}
            onChange={e => setPatientId(e.target.value)}
            placeholder="Enter patient ID..."
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => fetchSessions(patientId)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
          >
            Search
          </button>
        </div>
      </div>

      {/* Sessions List */}
      <div className="bg-white rounded-xl shadow mb-6">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Calendar size={18} />
            Sessions
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto animate-spin text-blue-500 mb-2" size={32} />
            <p className="text-gray-500">Loading sessions...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Video className="mx-auto mb-2 text-gray-300" size={40} />
            <p>No telehealth sessions found</p>
            {!patientId && <p className="text-sm mt-1">Enter a patient ID above to search sessions</p>}
          </div>
        ) : (
          <div className="divide-y">
            {sessions.map((session) => (
              <div key={session.session_id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">{session.session_type}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(session.status)}`}>
                      {session.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <User size={13} />
                      Patient: {session.patient_id}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={13} />
                      {new Date(session.scheduled_start * 1000).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={13} />
                      {session.duration_minutes} min
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  {session.join_url && session.status !== 'ended' && session.status !== 'cancelled' && (
                    <a
                      href={session.join_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                    >
                      <ExternalLink size={14} />
                      Join
                    </a>
                  )}
                  {(session.status === 'active' || session.status === 'scheduled') && (
                    <button
                      onClick={() => handleEndSession(session.session_id)}
                      disabled={actionLoading === session.session_id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-100 text-red-700 text-sm rounded hover:bg-red-200 disabled:opacity-50"
                    >
                      {actionLoading === session.session_id ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                      End
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Schedule New Telehealth Session</h2>
          <form onSubmit={handleCreate} className="max-w-lg space-y-4">
            <div>
              <label htmlFor="telehealth-form-patient" className="block text-sm font-medium text-gray-700">Patient ID</label>
              <input
                id="telehealth-form-patient"
                type="text"
                value={formData.patient_id}
                onChange={e => setFormData({ ...formData, patient_id: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
            </div>
            <div>
              <label htmlFor="telehealth-session-type" className="block text-sm font-medium text-gray-700">Session Type</label>
              <select
                id="telehealth-session-type"
                value={formData.session_type}
                onChange={e => setFormData({ ...formData, session_type: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="video_consultation">Video Consultation</option>
                <option value="follow_up">Follow-up</option>
                <option value="mental_health">Mental Health</option>
                <option value="urgent_care">Urgent Care</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="telehealth-date" className="block text-sm font-medium text-gray-700">Date</label>
                <input
                  id="telehealth-date"
                  type="date"
                  value={formData.scheduled_start_date}
                  onChange={e => setFormData({ ...formData, scheduled_start_date: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label htmlFor="telehealth-time" className="block text-sm font-medium text-gray-700">Time</label>
                <input
                  id="telehealth-time"
                  type="time"
                  value={formData.scheduled_start_time}
                  onChange={e => setFormData({ ...formData, scheduled_start_time: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="telehealth-duration" className="block text-sm font-medium text-gray-700">Duration (minutes)</label>
              <input
                id="telehealth-duration"
                type="number"
                min={15}
                max={120}
                value={formData.duration_minutes}
                onChange={e => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) })}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                Schedule Session
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="border px-4 py-2 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
