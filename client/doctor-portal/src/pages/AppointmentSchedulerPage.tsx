import React, { useState } from 'react';
import { createAppointment } from '../../../shared/src/api/endpoints';

export default function AppointmentSchedulerPage() {
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
      alert('Appointment booked!');
    } catch (err) {
      console.error(err);
      alert('Error booking appointment');
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Schedule Appointment</h1>
      <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
        <div>
          <label className="block text-sm font-medium">Patient ID</label>
          <input 
            type="text" 
            value={formData.patient_id}
            onChange={e => setFormData({...formData, patient_id: e.target.value})}
            className="w-full border p-2 rounded"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Provider ID</label>
          <input 
            type="text" 
            value={formData.provider_id}
            onChange={e => setFormData({...formData, provider_id: e.target.value})}
            className="w-full border p-2 rounded"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Date</label>
            <input 
              type="date" 
              value={formData.preferred_date}
              onChange={e => setFormData({...formData, preferred_date: e.target.value})}
              className="w-full border p-2 rounded"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Time</label>
            <input 
              type="time" 
              value={formData.preferred_time}
              onChange={e => setFormData({...formData, preferred_time: e.target.value})}
              className="w-full border p-2 rounded"
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Reason</label>
          <textarea 
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
