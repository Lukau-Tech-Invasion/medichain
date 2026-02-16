import React, { useState } from 'react';
import { createAppointment } from '../../../shared/src/api/endpoints';
import { useToastActions } from '../components/Toast';
import PatientSelect from '../components/PatientSelect';

export default function AppointmentSchedulerPage() {
  const { showSuccess, showError } = useToastActions();
  const [formData, setFormData] = useState({
    patient_id: '',
    provider_id: '',
    appointment_type: 'consultation',
    preferred_date: '',
    preferred_time: '',
    reason: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAppointment(formData);
      showSuccess('Appointment booked!');
    } catch (err) {
      console.error(err);
      showError('Error booking appointment');
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 dark:text-white">Schedule Appointment</h1>
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
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Book Appointment
        </button>
      </form>
    </div>
  );
}
