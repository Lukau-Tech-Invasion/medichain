import React, { useState, useEffect } from 'react';
import { createAppointment } from '../../../shared/src/api/endpoints';
import { useToastActions } from '../components/Toast';
import PatientSelect from '../components/PatientSelect';
import { useAuthStore } from '../store/authStore';
import { apiUrl } from '@medichain/shared';
import { Calendar, Clock, CheckCircle, XCircle, Plus, Loader2 } from 'lucide-react';

interface Appointment {
  appointment_id: string;
  patient_id: string;
  patient_name?: string;
  provider_id: string;
  appointment_type: string;
  preferred_date: string;
  preferred_time: string;
  reason: string;
  status: string;
  created_at?: number;
}

export default function AppointmentSchedulerPage() {
  const { showSuccess, showError } = useToastActions();
  const { user } = useAuthStore();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    patient_id: '',
    provider_id: '',
    appointment_type: 'consultation',
    preferred_date: '',
    preferred_time: '',
    reason: '',
  });

  useEffect(() => {
    fetchAppointments();
  }, [user]);

  const fetchAppointments = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const providerId = user.walletAddress;
      const res = await fetch(apiUrl(`/api/appointments/provider/${providerId}`), {
        headers: {
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });
      const data = await res.json();
      setAppointments(data.appointments || data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAppointment(formData);
      showSuccess('Appointment booked!');
      setShowForm(false);
      setFormData({ patient_id: '', provider_id: '', appointment_type: 'consultation', preferred_date: '', preferred_time: '', reason: '' });
      fetchAppointments();
    } catch (err) {
      console.error(err);
      showError('Error booking appointment');
    }
  };

  const handleCancel = async (appointmentId: string) => {
    if (!user) return;
    setActionLoading(appointmentId + '-cancel');
    try {
      const res = await fetch(apiUrl(`/api/appointments/${appointmentId}/cancel`), {
        method: 'POST',
        headers: { 'X-User-Id': user.walletAddress, 'X-Provider-Role': user.role },
      });
      if (res.ok) {
        showSuccess('Appointment cancelled');
        fetchAppointments();
      } else {
        showError('Failed to cancel appointment');
      }
    } catch (e) {
      showError('Error cancelling appointment');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCheckIn = async (appointmentId: string) => {
    if (!user) return;
    setActionLoading(appointmentId + '-checkin');
    try {
      const res = await fetch(apiUrl(`/api/appointments/${appointmentId}/check-in`), {
        method: 'POST',
        headers: { 'X-User-Id': user.walletAddress, 'X-Provider-Role': user.role },
      });
      if (res.ok) {
        showSuccess('Patient checked in');
        fetchAppointments();
      } else {
        showError('Failed to check in');
      }
    } catch (e) {
      showError('Error checking in');
    } finally {
      setActionLoading(null);
    }
  };

  const statusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'scheduled': return 'bg-blue-100 text-blue-700';
      case 'completed': return 'bg-green-100 text-green-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      case 'checked_in': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold dark:text-white">Appointments</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          <Plus size={16} />
          {showForm ? 'Hide Form' : 'New Appointment'}
        </button>
      </div>

      {/* Appointments List */}
      <div className="bg-white rounded-xl shadow mb-6">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Calendar size={18} />
            Provider Appointments
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto animate-spin text-blue-500 mb-2" size={32} />
            <p className="text-gray-500">Loading appointments...</p>
          </div>
        ) : appointments.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Calendar className="mx-auto mb-2 text-gray-300" size={40} />
            <p>No appointments found</p>
          </div>
        ) : (
          <div className="divide-y">
            {appointments.map((appt) => (
              <div key={appt.appointment_id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">
                      {appt.patient_name || appt.patient_id}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(appt.status)}`}>
                      {appt.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1"><Calendar size={13} />{appt.preferred_date}</span>
                    <span className="flex items-center gap-1"><Clock size={13} />{appt.preferred_time}</span>
                    <span>{appt.appointment_type}</span>
                  </div>
                  {appt.reason && <p className="text-xs text-gray-400 mt-1">{appt.reason}</p>}
                </div>
                <div className="flex gap-2 ml-4">
                  {appt.status?.toLowerCase() === 'scheduled' && (
                    <>
                      <button
                        onClick={() => handleCheckIn(appt.appointment_id)}
                        disabled={actionLoading === appt.appointment_id + '-checkin'}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        <CheckCircle size={14} />
                        Check In
                      </button>
                      <button
                        onClick={() => handleCancel(appt.appointment_id)}
                        disabled={actionLoading === appt.appointment_id + '-cancel'}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-100 text-red-700 text-sm rounded hover:bg-red-200 disabled:opacity-50"
                      >
                        <XCircle size={14} />
                        Cancel
                      </button>
                    </>
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
          <h2 className="font-semibold text-gray-900 mb-4">Schedule New Appointment</h2>
          <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
            <PatientSelect
              id="patient_id"
              label="Patient"
              value={formData.patient_id}
              onChange={(patientId) => setFormData({...formData, patient_id: patientId})}
              required
            />
            <div>
              <label htmlFor="provider_id" className="block text-sm font-medium">Provider ID</label>
              <input
                id="provider_id"
                type="text"
                value={formData.provider_id}
                onChange={e => setFormData({...formData, provider_id: e.target.value})}
                className="w-full border p-2 rounded"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="preferred_date" className="block text-sm font-medium">Date</label>
                <input
                  id="preferred_date"
                  type="date"
                  value={formData.preferred_date}
                  onChange={e => setFormData({...formData, preferred_date: e.target.value})}
                  className="w-full border p-2 rounded"
                  required
                />
              </div>
              <div>
                <label htmlFor="preferred_time" className="block text-sm font-medium">Time</label>
                <input
                  id="preferred_time"
                  type="time"
                  value={formData.preferred_time}
                  onChange={e => setFormData({...formData, preferred_time: e.target.value})}
                  className="w-full border p-2 rounded"
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="reason" className="block text-sm font-medium">Reason</label>
              <textarea
                id="reason"
                value={formData.reason}
                onChange={e => setFormData({...formData, reason: e.target.value})}
                className="w-full border p-2 rounded"
                rows={3}
                required
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                Book Appointment
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="border px-4 py-2 rounded hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
