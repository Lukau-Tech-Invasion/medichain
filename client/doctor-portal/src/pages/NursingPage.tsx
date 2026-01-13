import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { apiUrl } from '@medichain/shared';
import { 
  Pill, Droplets, ClipboardList, Plus, Save, Clock, 
  AlertCircle, CheckCircle, User, Calendar, Loader2,
  TrendingUp, TrendingDown, Minus
} from 'lucide-react';

// Types for Medication Administration Record
interface MedicationDose {
  scheduled_time: string;
  administered_time?: string;
  administered_by?: string;
  status: 'pending' | 'given' | 'held' | 'refused' | 'not_given';
  notes?: string;
}

interface MedicationEntry {
  medication_name: string;
  dose: string;
  route: string;
  frequency: string;
  doses: MedicationDose[];
}

interface MAR {
  mar_id: string;
  patient_id: string;
  patient_name: string;
  date: string;
  medications: MedicationEntry[];
  created_by: string;
  created_at: string;
}

// Types for Intake/Output Record
interface FluidEntry {
  time: string;
  type: string;
  amount_ml: number;
  route?: string;
  notes?: string;
  recorded_by: string;
}

interface IntakeOutputRecord {
  io_id: string;
  patient_id: string;
  patient_name: string;
  date: string;
  shift: 'day' | 'evening' | 'night';
  intake: FluidEntry[];
  output: FluidEntry[];
  total_intake: number;
  total_output: number;
  fluid_balance: number;
  recorded_by: string;
}

// Types for Nursing Care Plan
interface NursingDiagnosis {
  diagnosis: string;
  related_to: string;
  evidenced_by: string[];
}

interface NursingIntervention {
  intervention: string;
  frequency: string;
  rationale: string;
  status: 'active' | 'completed' | 'discontinued';
}

interface NursingOutcome {
  outcome: string;
  target_date: string;
  indicators: string[];
  status: 'not_met' | 'partially_met' | 'met';
}

interface NursingCarePlan {
  plan_id: string;
  patient_id: string;
  patient_name: string;
  diagnoses: NursingDiagnosis[];
  interventions: NursingIntervention[];
  outcomes: NursingOutcome[];
  created_by: string;
  created_at: string;
  last_updated: string;
}

type TabType = 'mar' | 'io' | 'careplan';

function NursingPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('mar');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Data states
  const [marRecords, setMarRecords] = useState<MAR[]>([]);
  const [ioRecords, setIoRecords] = useState<IntakeOutputRecord[]>([]);
  const [carePlans, setCarePlans] = useState<NursingCarePlan[]>([]);
  
  // Selected patient for new entries
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([]);

  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch data on mount
  useEffect(() => {
    if (isAuthenticated && user) {
      fetchData();
      fetchPatients();
    }
  }, [isAuthenticated, user]);

  const fetchPatients = async () => {
    if (!user) return;
    try {
      const response = await fetch(apiUrl('/api/patients/list'), {
        headers: { 
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setPatients(data.patients.map((p: { patient_id: string; full_name: string }) => ({
          id: p.patient_id,
          name: p.full_name,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch patients:', err);
    }
  };

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = { 
        'X-User-Id': user.walletAddress,
        'X-Provider-Role': user.role,
      };
      
      const [marRes, ioRes, planRes] = await Promise.all([
        fetch(apiUrl('/api/nursing/mar'), { headers }),
        fetch(apiUrl('/api/nursing/intake-output'), { headers }),
        fetch(apiUrl('/api/nursing/care-plans'), { headers }),
      ]);

      if (marRes.ok) {
        const data = await marRes.json();
        setMarRecords(data.records || []);
      }
      if (ioRes.ok) {
        const data = await ioRes.json();
        setIoRecords(data.records || []);
      }
      if (planRes.ok) {
        const data = await planRes.json();
        setCarePlans(data.plans || []);
      }
      setError(null);
    } catch (err) {
      setError('Failed to fetch nursing data. Ensure API is running.');
    } finally {
      setLoading(false);
    }
  };

  // MAR: Administer medication
  const administerMedication = async (marId: string, medIndex: number, doseIndex: number) => {
    if (!user) return;
    setSaving(true);
    try {
      const response = await fetch(apiUrl('/api/nursing/mar/administer'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({
          mar_id: marId,
          medication_index: medIndex,
          dose_index: doseIndex,
          administered_time: new Date().toISOString(),
          status: 'given',
        }),
      });

      if (response.ok) {
        setSuccess('Medication administered successfully');
        fetchData();
      } else {
        setError('Failed to record medication administration');
      }
    } catch (err) {
      setError('API connection failed');
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  // I/O: Record intake or output
  const [newFluidEntry, setNewFluidEntry] = useState({
    type: 'intake',
    fluidType: 'Oral',
    amount: 0,
    notes: '',
  });

  const recordFluid = async () => {
    if (!user) return;
    if (!selectedPatient || newFluidEntry.amount <= 0) {
      setError('Select patient and enter valid amount');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(apiUrl('/api/nursing/intake-output/record'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({
          patient_id: selectedPatient,
          entry_type: newFluidEntry.type,
          fluid_type: newFluidEntry.fluidType,
          amount_ml: newFluidEntry.amount,
          notes: newFluidEntry.notes,
          time: new Date().toISOString(),
        }),
      });

      if (response.ok) {
        setSuccess('Fluid entry recorded');
        setNewFluidEntry({ type: 'intake', fluidType: 'Oral', amount: 0, notes: '' });
        fetchData();
      } else {
        setError('Failed to record fluid entry');
      }
    } catch (err) {
      setError('API connection failed');
    } finally {
      setSaving(false);
      setTimeout(() => { setSuccess(null); setError(null); }, 3000);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'given': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'held': return 'bg-orange-100 text-orange-800';
      case 'refused': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getBalanceIcon = (balance: number) => {
    if (balance > 500) return <TrendingUp className="text-green-500" size={20} />;
    if (balance < -500) return <TrendingDown className="text-red-500" size={20} />;
    return <Minus className="text-gray-500" size={20} />;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Nursing Documentation</h1>
        <p className="text-gray-500">MAR, Intake/Output, and Care Plans</p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="text-red-500" size={20} />
          <span className="text-red-700">{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle className="text-green-500" size={20} />
          <span className="text-green-700">{success}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('mar')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === 'mar' 
              ? 'bg-primary-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Pill size={20} />
          Medication Administration
        </button>
        <button
          onClick={() => setActiveTab('io')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === 'io' 
              ? 'bg-primary-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Droplets size={20} />
          Intake/Output
        </button>
        <button
          onClick={() => setActiveTab('careplan')}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === 'careplan' 
              ? 'bg-primary-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <ClipboardList size={20} />
          Care Plans
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary-500" size={48} />
        </div>
      ) : (
        <>
          {/* MAR Tab */}
          {activeTab === 'mar' && (
            <div className="space-y-6">
              {marRecords.length === 0 ? (
                <div className="bg-white rounded-xl shadow p-8 text-center">
                  <Pill className="mx-auto mb-4 text-gray-300" size={48} />
                  <p className="text-gray-500">No medication records found</p>
                  <p className="text-sm text-gray-400">Records will appear when medications are ordered</p>
                </div>
              ) : (
                marRecords.map((mar) => (
                  <div key={mar.mar_id} className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                      <div>
                        <h3 className="font-semibold text-gray-900">{mar.patient_name}</h3>
                        <p className="text-sm text-gray-500">
                          <Calendar className="inline mr-1" size={14} />
                          {mar.date}
                        </p>
                      </div>
                      <span className="text-sm text-gray-400">MAR ID: {mar.mar_id}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                          <tr>
                            <th className="px-4 py-3 text-left">Medication</th>
                            <th className="px-4 py-3 text-left">Dose</th>
                            <th className="px-4 py-3 text-left">Route</th>
                            <th className="px-4 py-3 text-left">Frequency</th>
                            <th className="px-4 py-3 text-center">Scheduled</th>
                            <th className="px-4 py-3 text-center">Status</th>
                            <th className="px-4 py-3 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {mar.medications.map((med, medIdx) => (
                            med.doses.map((dose, doseIdx) => (
                              <tr key={`${medIdx}-${doseIdx}`} className="hover:bg-gray-50">
                                {doseIdx === 0 && (
                                  <>
                                    <td className="px-4 py-3 font-medium" rowSpan={med.doses.length}>
                                      {med.medication_name}
                                    </td>
                                    <td className="px-4 py-3" rowSpan={med.doses.length}>{med.dose}</td>
                                    <td className="px-4 py-3" rowSpan={med.doses.length}>{med.route}</td>
                                    <td className="px-4 py-3" rowSpan={med.doses.length}>{med.frequency}</td>
                                  </>
                                )}
                                <td className="px-4 py-3 text-center">
                                  <Clock className="inline mr-1" size={14} />
                                  {dose.scheduled_time}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(dose.status)}`}>
                                    {dose.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {dose.status === 'pending' && (
                                    <button
                                      onClick={() => administerMedication(mar.mar_id, medIdx, doseIdx)}
                                      disabled={saving}
                                      className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                                    >
                                      Give
                                    </button>
                                  )}
                                  {dose.status === 'given' && dose.administered_by && (
                                    <span className="text-xs text-gray-500">
                                      <User className="inline mr-1" size={12} />
                                      {dose.administered_by}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Intake/Output Tab */}
          {activeTab === 'io' && (
            <div className="space-y-6">
              {/* Quick Entry Form */}
              <div className="bg-white rounded-xl shadow p-6">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Plus size={20} />
                  Quick Entry
                </h3>
                <div className="grid grid-cols-5 gap-4">
                  <select
                    value={selectedPatient}
                    onChange={(e) => setSelectedPatient(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg"
                  >
                    <option value="">Select Patient</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <select
                    value={newFluidEntry.type}
                    onChange={(e) => setNewFluidEntry({ ...newFluidEntry, type: e.target.value })}
                    className="px-3 py-2 border border-gray-200 rounded-lg"
                  >
                    <option value="intake">Intake</option>
                    <option value="output">Output</option>
                  </select>
                  <select
                    value={newFluidEntry.fluidType}
                    onChange={(e) => setNewFluidEntry({ ...newFluidEntry, fluidType: e.target.value })}
                    className="px-3 py-2 border border-gray-200 rounded-lg"
                  >
                    {newFluidEntry.type === 'intake' ? (
                      <>
                        <option value="Oral">Oral</option>
                        <option value="IV">IV Fluids</option>
                        <option value="NG Tube">NG Tube</option>
                        <option value="Blood Products">Blood Products</option>
                      </>
                    ) : (
                      <>
                        <option value="Urine">Urine</option>
                        <option value="Emesis">Emesis</option>
                        <option value="Stool">Stool</option>
                        <option value="Drainage">Drainage</option>
                        <option value="Blood Loss">Blood Loss</option>
                      </>
                    )}
                  </select>
                  <input
                    type="number"
                    value={newFluidEntry.amount}
                    onChange={(e) => setNewFluidEntry({ ...newFluidEntry, amount: parseInt(e.target.value) || 0 })}
                    placeholder="Amount (mL)"
                    className="px-3 py-2 border border-gray-200 rounded-lg"
                  />
                  <button
                    onClick={recordFluid}
                    disabled={saving}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    Record
                  </button>
                </div>
              </div>

              {/* I/O Records */}
              {ioRecords.length === 0 ? (
                <div className="bg-white rounded-xl shadow p-8 text-center">
                  <Droplets className="mx-auto mb-4 text-gray-300" size={48} />
                  <p className="text-gray-500">No intake/output records found</p>
                </div>
              ) : (
                ioRecords.map((record) => (
                  <div key={record.io_id} className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                      <div>
                        <h3 className="font-semibold text-gray-900">{record.patient_name}</h3>
                        <p className="text-sm text-gray-500">
                          {record.date} - {record.shift.charAt(0).toUpperCase() + record.shift.slice(1)} Shift
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm text-gray-500">Balance</p>
                          <div className="flex items-center gap-1">
                            {getBalanceIcon(record.fluid_balance)}
                            <span className={`font-bold ${
                              record.fluid_balance > 0 ? 'text-green-600' : 
                              record.fluid_balance < 0 ? 'text-red-600' : 'text-gray-600'
                            }`}>
                              {record.fluid_balance > 0 ? '+' : ''}{record.fluid_balance} mL
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 divide-x">
                      {/* Intake */}
                      <div className="p-4">
                        <h4 className="font-medium text-green-700 mb-3 flex items-center gap-2">
                          <TrendingUp size={16} />
                          Intake: {record.total_intake} mL
                        </h4>
                        <div className="space-y-2">
                          {record.intake.map((entry, idx) => (
                            <div key={idx} className="flex justify-between text-sm">
                              <span>{entry.time.split('T')[1]?.substring(0, 5)} - {entry.type}</span>
                              <span className="font-medium">{entry.amount_ml} mL</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Output */}
                      <div className="p-4">
                        <h4 className="font-medium text-red-700 mb-3 flex items-center gap-2">
                          <TrendingDown size={16} />
                          Output: {record.total_output} mL
                        </h4>
                        <div className="space-y-2">
                          {record.output.map((entry, idx) => (
                            <div key={idx} className="flex justify-between text-sm">
                              <span>{entry.time.split('T')[1]?.substring(0, 5)} - {entry.type}</span>
                              <span className="font-medium">{entry.amount_ml} mL</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Care Plans Tab */}
          {activeTab === 'careplan' && (
            <div className="space-y-6">
              {carePlans.length === 0 ? (
                <div className="bg-white rounded-xl shadow p-8 text-center">
                  <ClipboardList className="mx-auto mb-4 text-gray-300" size={48} />
                  <p className="text-gray-500">No care plans found</p>
                </div>
              ) : (
                carePlans.map((plan) => (
                  <div key={plan.plan_id} className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="p-4 bg-gray-50 border-b">
                      <h3 className="font-semibold text-gray-900">{plan.patient_name}</h3>
                      <p className="text-sm text-gray-500">Last updated: {plan.last_updated}</p>
                    </div>
                    <div className="p-4 space-y-4">
                      {/* Diagnoses */}
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Nursing Diagnoses</h4>
                        {plan.diagnoses.map((dx, idx) => (
                          <div key={idx} className="ml-4 p-3 bg-blue-50 rounded-lg mb-2">
                            <p className="font-medium text-blue-900">{dx.diagnosis}</p>
                            <p className="text-sm text-blue-700">Related to: {dx.related_to}</p>
                            <p className="text-sm text-blue-600">
                              AEB: {dx.evidenced_by.join(', ')}
                            </p>
                          </div>
                        ))}
                      </div>
                      {/* Interventions */}
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Interventions</h4>
                        <div className="ml-4 space-y-2">
                          {plan.interventions.map((int, idx) => (
                            <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                              <div>
                                <p className="text-sm">{int.intervention}</p>
                                <p className="text-xs text-gray-500">{int.frequency}</p>
                              </div>
                              <span className={`px-2 py-1 rounded text-xs ${
                                int.status === 'active' ? 'bg-green-100 text-green-700' :
                                int.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {int.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Outcomes */}
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Expected Outcomes</h4>
                        <div className="ml-4 space-y-2">
                          {plan.outcomes.map((out, idx) => (
                            <div key={idx} className="p-2 bg-gray-50 rounded">
                              <div className="flex justify-between items-start">
                                <p className="text-sm">{out.outcome}</p>
                                <span className={`px-2 py-1 rounded text-xs ${
                                  out.status === 'met' ? 'bg-green-100 text-green-700' :
                                  out.status === 'partially_met' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {out.status.replace('_', ' ')}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500">Target: {out.target_date}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default NursingPage;
