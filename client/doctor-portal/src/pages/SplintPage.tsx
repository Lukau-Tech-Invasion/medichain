import React, { useState, useEffect } from 'react';
import { Bone, AlertTriangle, User, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';

type ImmobilizationType = 'splint' | 'cast' | 'sling' | 'brace' | 'boot';
type Material = 'fiberglass' | 'plaster' | 'prefab' | 'aluminum' | 'soft';

interface SplintRecord {
  id: string;
  patientId: string;
  patientName: string;
  appliedBy: string;
  appliedAt: string;
  type: ImmobilizationType;
  material: Material;
  bodyPart: string;
  side: 'left' | 'right' | 'bilateral';
  indication: string;
  fractureSite: string;
  preApplicationNV: { intact: boolean; notes: string };
  postApplicationNV: { intact: boolean; notes: string };
  paddingAdequate: boolean;
  edgesSmooth: boolean;
  patientInstructions: boolean;
  weightBearing: 'non' | 'touch' | 'partial' | 'full';
  elevationInstructed: boolean;
  iceInstructed: boolean;
  returnPrecautions: string[];
  followUp: string;
  notes: string;
}

const bodyParts = [
  'Thumb spica', 'Volar wrist', 'Sugar tong (forearm)', 'Long arm', 'Ulnar gutter',
  'Radial gutter', 'Posterior ankle', 'Stirrup ankle', 'Short leg', 'Long leg',
  'Knee immobilizer', 'Shoulder sling', 'Clavicle strap', 'Finger splint'
];

const indications = [
  'Fracture immobilization', 'Post-reduction', 'Soft tissue injury', 'Tendon injury',
  'Ligament sprain', 'Joint protection', 'Post-operative', 'Pain management'
];

const returnPrecautionsList = [
  'Increased pain', 'Numbness or tingling', 'Pale or blue fingers/toes',
  'Swelling beyond splint', 'Inability to move fingers/toes', 'Splint feels too tight',
  'Foul odor', 'Fever', 'Cast breakdown/damage'
];

const SplintPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [records, setRecords] = useState<SplintRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [type, setType] = useState<ImmobilizationType>('splint');
  const [material, setMaterial] = useState<Material>('fiberglass');
  const [bodyPart, setBodyPart] = useState('');
  const [side, setSide] = useState<'left' | 'right' | 'bilateral'>('right');
  const [indication, setIndication] = useState('');
  const [fractureSite, setFractureSite] = useState('');
  const [preNV, setPreNV] = useState({ intact: true, notes: '' });
  const [postNV, setPostNV] = useState({ intact: true, notes: '' });
  const [paddingAdequate, setPaddingAdequate] = useState(true);
  const [edgesSmooth, setEdgesSmooth] = useState(true);
  const [patientInstructions, setPatientInstructions] = useState(true);
  const [weightBearing, setWeightBearing] = useState<'non' | 'touch' | 'partial' | 'full'>('non');
  const [elevationInstructed, setElevationInstructed] = useState(true);
  const [iceInstructed, setIceInstructed] = useState(true);
  const [selectedPrecautions, setSelectedPrecautions] = useState<string[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const pts = await getPatients();
        setPatients(pts);
      } catch (err) {
        console.error('Failed to load patients:', err);
      }
    };
    loadData();
  }, []);

  // NV check warning
  const nvWarning = !preNV.intact || !postNV.intact;

  const handleSubmit = () => {
    if (!selectedPatient || !bodyPart) {
      showWarning('Please select a patient and body part');
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const record: SplintRecord = {
      id: `SPL-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      appliedBy: user?.username || 'Unknown',
      appliedAt: new Date().toISOString(),
      type, material, bodyPart, side, indication, fractureSite,
      preApplicationNV: preNV, postApplicationNV: postNV,
      paddingAdequate, edgesSmooth, patientInstructions,
      weightBearing, elevationInstructed, iceInstructed,
      returnPrecautions: selectedPrecautions, followUp, notes
    };
    setRecords([record, ...records]);
    showSuccess('Splint/Cast record saved!');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-500 text-white p-6">
        <div className="flex items-center gap-3">
          <Bone className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">Splint & Cast Documentation</h1>
            <p className="text-blue-100">Immobilization and orthopedic care</p>
          </div>
        </div>
      </div>

      {/* NV Warning */}
      {nvWarning && (
        <div className="bg-red-600 text-white p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6" />
          <span className="font-semibold">Neurovascular compromise detected - reassess immediately!</span>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {['new', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'new' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'new' ? 'New Application' : 'History'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <div className="space-y-6">
            {/* Patient & Type */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> Patient & Device
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="splint-patient" className="text-sm text-gray-600">Patient</label>
                  <select
                    id="splint-patient"
                    value={selectedPatient}
                    onChange={e => setSelectedPatient(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">Select...</option>
                    {patients.map(p => (
                      <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-type" className="text-sm text-gray-600">Type</label>
                  <select
                    id="splint-type"
                    value={type}
                    onChange={e => setType(e.target.value as ImmobilizationType)}
                    className="w-full border rounded p-2"
                  >
                    <option value="splint">Splint</option>
                    <option value="cast">Cast</option>
                    <option value="sling">Sling</option>
                    <option value="brace">Brace</option>
                    <option value="boot">Walking boot</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-material" className="text-sm text-gray-600">Material</label>
                  <select
                    id="splint-material"
                    value={material}
                    onChange={e => setMaterial(e.target.value as Material)}
                    className="w-full border rounded p-2"
                  >
                    <option value="fiberglass">Fiberglass</option>
                    <option value="plaster">Plaster</option>
                    <option value="prefab">Prefabricated</option>
                    <option value="aluminum">Aluminum</option>
                    <option value="soft">Soft</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-side" className="text-sm text-gray-600">Side</label>
                  <select
                    id="splint-side"
                    value={side}
                    onChange={e => setSide(e.target.value as 'left' | 'right' | 'bilateral')}
                    className="w-full border rounded p-2"
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="bilateral">Bilateral</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Body Part & Indication */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Location & Indication</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="splint-body-part" className="text-sm text-gray-600">Body Part / Splint Type</label>
                  <select
                    id="splint-body-part"
                    value={bodyPart}
                    onChange={e => setBodyPart(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">Select...</option>
                    {bodyParts.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-indication" className="text-sm text-gray-600">Indication</label>
                  <select
                    id="splint-indication"
                    value={indication}
                    onChange={e => setIndication(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">Select...</option>
                    {indications.map(i => (
                      <option key={i} value={i}>{i}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="splint-fracture-site" className="text-sm text-gray-600">Fracture Site (if applicable)</label>
                  <input
                    id="splint-fracture-site"
                    type="text"
                    value={fractureSite}
                    onChange={e => setFractureSite(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., Distal radius"
                  />
                </div>
              </div>
            </div>

            {/* NV Checks */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" /> Neurovascular Assessment
              </h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="p-3 bg-gray-50 rounded">
                  <h3 className="font-medium mb-2">Pre-Application</h3>
                  <label htmlFor="splint-pre-nv-intact" className="flex items-center gap-2 mb-2">
                    <input
                      id="splint-pre-nv-intact"
                      type="checkbox"
                      checked={preNV.intact}
                      onChange={e => setPreNV({ ...preNV, intact: e.target.checked })}
                    />
                    <span className={preNV.intact ? 'text-green-600' : 'text-red-600 font-semibold'}>
                      NV status intact
                    </span>
                  </label>
                  <input
                    type="text"
                    value={preNV.notes}
                    onChange={e => setPreNV({ ...preNV, notes: e.target.value })}
                    className="w-full border rounded p-2"
                    placeholder="Notes (pulses, sensation, movement)"
                  />
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <h3 className="font-medium mb-2">Post-Application</h3>
                  <label htmlFor="splint-post-nv-intact" className="flex items-center gap-2 mb-2">
                    <input
                      id="splint-post-nv-intact"
                      type="checkbox"
                      checked={postNV.intact}
                      onChange={e => setPostNV({ ...postNV, intact: e.target.checked })}
                    />
                    <span className={postNV.intact ? 'text-green-600' : 'text-red-600 font-semibold'}>
                      NV status intact
                    </span>
                  </label>
                  <input
                    type="text"
                    value={postNV.notes}
                    onChange={e => setPostNV({ ...postNV, notes: e.target.value })}
                    className="w-full border rounded p-2"
                    placeholder="Notes (pulses, sensation, movement)"
                  />
                </div>
              </div>
            </div>

            {/* Quality Checklist */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Application Checklist</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <label htmlFor="splint-padding-adequate" className="flex items-center gap-2">
                  <input
                    id="splint-padding-adequate"
                    type="checkbox"
                    checked={paddingAdequate}
                    onChange={e => setPaddingAdequate(e.target.checked)}
                  />
                  Adequate padding applied
                </label>
                <label htmlFor="splint-edges-smooth" className="flex items-center gap-2">
                  <input
                    id="splint-edges-smooth"
                    type="checkbox"
                    checked={edgesSmooth}
                    onChange={e => setEdgesSmooth(e.target.checked)}
                  />
                  Edges smooth / rolled
                </label>
                <label htmlFor="splint-patient-instructions" className="flex items-center gap-2">
                  <input
                    id="splint-patient-instructions"
                    type="checkbox"
                    checked={patientInstructions}
                    onChange={e => setPatientInstructions(e.target.checked)}
                  />
                  Instructions given to patient
                </label>
              </div>
            </div>

            {/* Activity Restrictions */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Activity & Instructions</h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="splint-weight-bearing" className="text-sm text-gray-600">Weight Bearing</label>
                  <select
                    id="splint-weight-bearing"
                    value={weightBearing}
                    onChange={e => setWeightBearing(e.target.value as 'non' | 'touch' | 'partial' | 'full')}
                    className="w-full border rounded p-2"
                  >
                    <option value="non">Non-weight bearing</option>
                    <option value="touch">Touch down / Toe touch</option>
                    <option value="partial">Partial weight bearing</option>
                    <option value="full">Full weight bearing</option>
                  </select>
                </div>
                <label htmlFor="splint-elevation-instructed" className="flex items-center gap-2">
                  <input
                    id="splint-elevation-instructed"
                    type="checkbox"
                    checked={elevationInstructed}
                    onChange={e => setElevationInstructed(e.target.checked)}
                  />
                  Elevation instructed
                </label>
                <label htmlFor="splint-ice-instructed" className="flex items-center gap-2">
                  <input
                    id="splint-ice-instructed"
                    type="checkbox"
                    checked={iceInstructed}
                    onChange={e => setIceInstructed(e.target.checked)}
                  />
                  Ice application instructed
                </label>
                <div>
                  <label htmlFor="splint-follow-up" className="text-sm text-gray-600">Follow-up</label>
                  <input
                    id="splint-follow-up"
                    type="text"
                    value={followUp}
                    onChange={e => setFollowUp(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., Ortho in 1 week"
                  />
                </div>
              </div>
            </div>

            {/* Return Precautions */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> Return Precautions Given
              </h2>
              <div className="flex flex-wrap gap-2">
                {returnPrecautionsList.map(p => (
                  <label key={p} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedPrecautions.includes(p) ? 'bg-yellow-100 border-yellow-300' : 'bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={selectedPrecautions.includes(p)}
                      onChange={e => {
                        if (e.target.checked) setSelectedPrecautions([...selectedPrecautions, p]);
                        else setSelectedPrecautions(selectedPrecautions.filter(x => x !== p));
                      }}
                      className="mr-1"
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Notes</h2>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder="Additional notes..."
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
            >
              Save Splint/Cast Record
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {records.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No records yet</div>
            ) : (
              records.map(r => (
                <div key={r.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{r.patientName}</h3>
                      <p className="text-sm text-gray-500">{new Date(r.appliedAt).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-700 capitalize">{r.type}</span>
                      <span className={`px-2 py-1 text-xs rounded ${r.postApplicationNV.intact ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        NV {r.postApplicationNV.intact ? 'Intact' : 'Compromised'}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm">
                    <p><strong>{r.bodyPart}</strong> - {r.side} side</p>
                    <p className="text-gray-600">{r.indication}</p>
                    {r.followUp && <p className="text-blue-600">Follow-up: {r.followUp}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SplintPage;
